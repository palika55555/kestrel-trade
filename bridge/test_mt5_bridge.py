"""Tests for mt5_bridge.py with a fake MetaTrader5 API (no terminal needed).

Run:  python -m unittest discover -s bridge
"""

from __future__ import annotations

import json
import threading
import unittest
import urllib.error
import urllib.request
from types import SimpleNamespace
from typing import Any

import mt5_bridge as bridge

SECRET = "test-secret-0123456789"


class FakeMt5:
    TRADE_ACTION_DEAL = 1
    TRADE_ACTION_SLTP = 6
    ORDER_TYPE_BUY = 0
    ORDER_TYPE_SELL = 1
    POSITION_TYPE_BUY = 0
    ORDER_TIME_GTC = 0
    DEAL_TYPE_BUY = 0
    DEAL_TYPE_SELL = 1
    TIMEFRAME_M1 = 1
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_H1 = 16385
    TIMEFRAME_H4 = 16388
    TIMEFRAME_D1 = 16408

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.retcode = bridge.TRADE_RETCODE_DONE
        self.positions = [SimpleNamespace(ticket=555, symbol="XAUUSD", volume=0.10, type=0, sl=2390.0, tp=2420.0)]

    def history_deals_get(self, _start: Any, _end: Any) -> tuple[Any, ...]:
        return (
            SimpleNamespace(type=0, profit=30.0, commission=-1.0, swap=0.0, fee=0.0),
            SimpleNamespace(type=1, profit=-10.0, commission=-1.0, swap=-0.5, fee=0.0),
            SimpleNamespace(type=2, profit=5000.0, commission=0.0, swap=0.0, fee=0.0),  # deposit: ignored
        )

    def terminal_info(self) -> Any:
        return SimpleNamespace(trade_allowed=True)

    def initialize(self, *_args: Any) -> bool:
        return True

    def last_error(self) -> tuple[int, str]:
        return (1, "fake")

    def account_info(self) -> Any:
        return SimpleNamespace(
            login=633110, server="BlueGuardian-Server", company="Blue Guardian", currency="USD",
            balance=4999.4, equity=5048.48, margin=12.5, profit=49.08, trade_expert=True,
        )

    def positions_get(self, ticket: int | None = None) -> tuple[Any, ...]:
        if ticket is None:
            return tuple(self.positions)
        return tuple(p for p in self.positions if p.ticket == ticket)

    def symbol_info(self, symbol: str) -> Any:
        if symbol != "XAUUSD":
            return None
        return SimpleNamespace(visible=True, volume_min=0.01, volume_max=50.0, volume_step=0.01, digits=2, filling_mode=2)

    def symbol_select(self, _symbol: str, _enable: bool) -> bool:
        return True

    def symbol_info_tick(self, _symbol: str) -> Any:
        return SimpleNamespace(bid=2400.10, ask=2400.40, last=2400.25, time=0)

    def copy_rates_from_pos(self, _symbol: str, _tf: int, _start: int, count: int) -> list[dict[str, Any]]:
        base = 1700000000
        return [
            {
                "time": base + i * 900,
                "open": 2398.0 + i * 0.5,
                "high": 2401.0 + i * 0.5,
                "low": 2397.5 + i * 0.5,
                "close": 2400.0 + i * 0.5,
                "tick_volume": 120 + i,
            }
            for i in range(min(count, 12))
        ]

    def order_send(self, request: dict[str, Any]) -> Any:
        self.sent.append(request)
        return SimpleNamespace(retcode=self.retcode, comment="Done", order=777, price=2400.45, volume=request.get("volume", 0.0))


class HelperTests(unittest.TestCase):
    def test_normalize_volume_snaps_down_to_step(self) -> None:
        self.assertEqual(bridge.normalize_volume(0.127, 0.01, 50, 0.01), 0.12)

    def test_normalize_volume_rejects_below_minimum_and_invalid(self) -> None:
        self.assertIsNone(bridge.normalize_volume(0.004, 0.01, 50, 0.01))
        self.assertIsNone(bridge.normalize_volume(float("nan"), 0.01, 50, 0.01))
        self.assertIsNone(bridge.normalize_volume(-1, 0.01, 50, 0.01))

    def test_normalize_volume_clamps_to_maximum(self) -> None:
        self.assertEqual(bridge.normalize_volume(80, 0.01, 50, 0.01), 50)

    def test_partial_close_closes_all_when_remainder_unclosable(self) -> None:
        self.assertEqual(bridge.partial_close_volume(0.10, 0.5, 0.01, 0.01), 0.05)
        self.assertEqual(bridge.partial_close_volume(0.01, 0.5, 0.01, 0.01), 0.01)
        self.assertEqual(bridge.partial_close_volume(0.10, 1.0, 0.01, 0.01), 0.10)

    def test_pick_filling_mode_prefers_fok_then_ioc_then_return(self) -> None:
        self.assertEqual(bridge.pick_filling_mode(3), 0)
        self.assertEqual(bridge.pick_filling_mode(2), 1)
        self.assertEqual(bridge.pick_filling_mode(0), 2)

    def test_check_auth_requires_exact_bearer_secret(self) -> None:
        self.assertTrue(bridge.check_auth(f"Bearer {SECRET}", SECRET))
        self.assertFalse(bridge.check_auth("Bearer wrong", SECRET))
        self.assertFalse(bridge.check_auth(None, SECRET))


class EnvFileTests(unittest.TestCase):
    def test_parse_env_file_handles_quotes_comments_and_blanks(self) -> None:
        text = "\n".join(["# c", "", 'A="x y"   # note', "B=plain # note", "C='q'", "bad line", ""])
        self.assertEqual(bridge.parse_env_file(text), {"A": "x y", "B": "plain", "C": "q"})


class GatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        self.api = FakeMt5()
        self.gw = bridge.Mt5Gateway(self.api, magic=42, deviation=20, terminal_path=None)

    def test_open_market_buy_sends_deal_at_ask_and_returns_ticket(self) -> None:
        fill = self.gw.open_market({"symbol": "XAUUSD", "side": "BUY", "lots": 0.057, "stopLoss": 2390.123, "takeProfit": 2420})
        self.assertEqual(fill, {"ticket": 777, "price": 2400.45, "volume": 0.05})
        req = self.api.sent[0]
        self.assertEqual(req["type"], FakeMt5.ORDER_TYPE_BUY)
        self.assertEqual(req["price"], 2400.40)
        self.assertEqual(req["sl"], 2390.12)
        self.assertEqual(req["magic"], 42)
        self.assertEqual(req["type_filling"], 1)

    def test_open_market_rejects_unknown_symbol_and_bad_side(self) -> None:
        with self.assertRaises(bridge.BridgeError) as ctx:
            self.gw.open_market({"symbol": "GOLD", "side": "BUY", "lots": 0.1, "stopLoss": 1, "takeProfit": 2})
        self.assertEqual(ctx.exception.status, 400)
        with self.assertRaises(bridge.BridgeError):
            self.gw.open_market({"symbol": "XAUUSD", "side": "HOLD", "lots": 0.1, "stopLoss": 1, "takeProfit": 2})

    def test_open_market_surfaces_broker_rejection(self) -> None:
        self.api.retcode = 10019  # no money
        with self.assertRaises(bridge.BridgeError) as ctx:
            self.gw.open_market({"symbol": "XAUUSD", "side": "SELL", "lots": 0.1, "stopLoss": 2410, "takeProfit": 2380})
        self.assertEqual(ctx.exception.status, 422)

    def test_close_partial_sends_opposite_deal_for_position(self) -> None:
        out = self.gw.close_position({"ticket": 555, "fraction": 0.5})
        req = self.api.sent[0]
        self.assertEqual(req["type"], FakeMt5.ORDER_TYPE_SELL)
        self.assertEqual(req["position"], 555)
        self.assertEqual(req["price"], 2400.10)
        self.assertEqual(out["closedVolume"], 0.05)

    def test_close_unknown_ticket_is_404(self) -> None:
        with self.assertRaises(bridge.BridgeError) as ctx:
            self.gw.close_position({"ticket": 999, "fraction": 1})
        self.assertEqual(ctx.exception.status, 404)

    def test_modify_keeps_existing_level_when_null(self) -> None:
        out = self.gw.modify_position({"ticket": 555, "stopLoss": 2395.5649, "takeProfit": None})
        self.assertEqual(out, {"ticket": 555, "stopLoss": 2395.56, "takeProfit": 2420.0})
        self.assertEqual(self.api.sent[0]["action"], FakeMt5.TRADE_ACTION_SLTP)

    def test_account_reports_balance_and_positions(self) -> None:
        acc = self.gw.account()
        self.assertEqual(acc["login"], 633110)
        self.assertEqual(acc["openPositions"], 1)
        self.assertTrue(acc["tradeAllowed"])
        # realized 17.5 (deposit excluded) + floating 49.08
        self.assertEqual(acc["dayPnl"], 66.58)

    def test_day_pnl_is_none_when_history_unavailable(self) -> None:
        self.api.history_deals_get = lambda *_a: None  # type: ignore[method-assign]
        self.assertIsNone(self.gw.account()["dayPnl"])

    def test_quote_returns_bid_ask_and_spread(self) -> None:
        q = self.gw.quote({"symbol": ["XAUUSD"]})
        self.assertEqual(q["symbol"], "XAUUSD")
        self.assertEqual(q["bid"], 2400.10)
        self.assertEqual(q["ask"], 2400.40)
        self.assertEqual(q["spread"], 0.30)

    def test_candles_normalizes_bars_and_rejects_bad_timeframe(self) -> None:
        res = self.gw.candles({"symbol": ["XAUUSD"], "timeframe": ["15m"], "count": ["12"]})
        self.assertEqual(res["timeframe"], "15m")
        self.assertEqual(len(res["candles"]), 12)
        self.assertEqual(res["candles"][0], {
            "time": 1700000000,
            "open": 2398.0,
            "high": 2401.0,
            "low": 2397.5,
            "close": 2400.0,
            "volume": 120,
        })
        with self.assertRaises(bridge.BridgeError) as ctx:
            self.gw.candles({"symbol": ["XAUUSD"], "timeframe": ["2H"]})
        self.assertEqual(ctx.exception.status, 400)


class HttpTests(unittest.TestCase):
    def setUp(self) -> None:
        gateway = bridge.Mt5Gateway(FakeMt5(), magic=1, deviation=20, terminal_path=None)
        self.server = bridge.LoopbackServer(("127.0.0.1", 0), bridge.make_handler(gateway, SECRET))
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def _call(self, path: str, body: dict[str, Any] | None = None, token: str = SECRET) -> tuple[int, dict[str, Any]]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method="POST" if data else "GET")
        req.add_header("Authorization", f"Bearer {token}")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def test_health_is_public_and_reveals_no_account_data(self) -> None:
        status, body = self._call("/", token="nope")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"ok": True, "service": "kestrel-mt5-bridge"})

    def test_rejects_wrong_secret(self) -> None:
        status, body = self._call("/account", token="nope")
        self.assertEqual(status, 401)
        self.assertEqual(body["error"], "Unauthorized")

    def test_account_and_open_roundtrip(self) -> None:
        self.assertEqual(self._call("/account")[0], 200)
        status, body = self._call("/orders/open", {"symbol": "XAUUSD", "side": "BUY", "lots": 0.1, "stopLoss": 2390, "takeProfit": 2420})
        self.assertEqual(status, 200)
        self.assertEqual(body["ticket"], 777)

    def test_validation_error_is_400_json(self) -> None:
        status, body = self._call("/orders/open", {"symbol": "XAUUSD", "side": "BUY", "lots": "lots", "stopLoss": 1, "takeProfit": 2})
        self.assertEqual(status, 400)
        self.assertIn("lots", body["error"])

    def test_quote_and_candles_http_roundtrip(self) -> None:
        qs, qbody = self._call("/quote?symbol=XAUUSD")
        self.assertEqual(qs, 200)
        self.assertEqual(qbody["bid"], 2400.10)
        cs, cbody = self._call("/candles?symbol=XAUUSD&timeframe=5m&count=10")
        self.assertEqual(cs, 200)
        self.assertEqual(cbody["timeframe"], "5m")
        self.assertEqual(len(cbody["candles"]), 10)


if __name__ == "__main__":
    unittest.main()
