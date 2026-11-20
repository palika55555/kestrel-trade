"""Local HTTP bridge between Kestrel Trade and a MetaTrader 5 terminal.

Uses the official MetaTrader5 Python package, so no MetaApi subscription is needed.
The MT5 terminal must be installed, running and logged in to the trading account
(for example a Blue Guardian MT5 account), with "Algo Trading" enabled.
Account passwords never pass through this bridge: you log in inside the terminal.

Run:   python bridge/mt5_bridge.py
Settings are read from the environment, falling back to the project's .env file.
Env:   MT5_BRIDGE_SECRET  (required, shared with the Kestrel server)
       MT5_BRIDGE_PORT    (default 8765)
       MT5_MAGIC          (default 20261120, tags the bot's orders)
       MT5_DEVIATION      (default 20 points of allowed slippage)
       MT5_TERMINAL_PATH  (optional path to terminal64.exe)
"""

from __future__ import annotations

import hmac
import json
import logging
import math
import os
import sys
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

try:
    import MetaTrader5 as mt5  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover - handled in main()
    mt5 = None

ENV_FILE = Path(__file__).resolve().parent.parent / ".env"
HOST = "127.0.0.1"  # loopback only: the bridge must never be reachable from the network
MAX_BODY_BYTES = 16 * 1024
TRADE_RETCODE_DONE = 10009
TRADE_RETCODE_PLACED = 10008
TRADE_RETCODE_DONE_PARTIAL = 10010
OK_RETCODES = {TRADE_RETCODE_DONE, TRADE_RETCODE_PLACED, TRADE_RETCODE_DONE_PARTIAL}
SYMBOL_FILLING_FOK = 1
SYMBOL_FILLING_IOC = 2

log = logging.getLogger("mt5_bridge")


class BridgeError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- pure helpers


def normalize_volume(lots: float, vol_min: float, vol_max: float, vol_step: float) -> float | None:
    """Snap volume down to the symbol step; None when it falls below the minimum."""
    if not math.isfinite(lots) or lots <= 0 or vol_step <= 0:
        return None
    steps = math.floor(lots / vol_step + 1e-9)
    volume = round(steps * vol_step, 8)
    if volume < vol_min - 1e-9:
        return None
    return min(volume, vol_max)


def partial_close_volume(position_volume: float, fraction: float, vol_min: float, vol_step: float) -> float:
    """Volume to close for a fraction; closes everything when the rest would be unclosable."""
    if fraction >= 0.999:
        return position_volume
    part = normalize_volume(position_volume * fraction, vol_min, position_volume, vol_step)
    if part is None:
        return position_volume
    if position_volume - part < vol_min - 1e-9:
        return position_volume
    return part


def pick_filling_mode(filling_flags: int) -> int:
    """Map SYMBOL_FILLING_* flags to an ORDER_FILLING_* constant (FOK=0, IOC=1, RETURN=2)."""
    if filling_flags & SYMBOL_FILLING_FOK:
        return 0
    if filling_flags & SYMBOL_FILLING_IOC:
        return 1
    return 2


def require_number(body: dict[str, Any], key: str, allow_none: bool = False) -> float | None:
    value = body.get(key)
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise BridgeError(400, f"'{key}' must be a finite number")
    return float(value)


def parse_env_file(text: str) -> dict[str, str]:
    """Minimal .env parser: KEY=value, optional quotes, trailing # comments."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, rest = line.partition("=")
        rest = rest.strip()
        if rest[:1] in ('"', "'"):
            end = rest.find(rest[0], 1)
            value = rest[1:end] if end > 0 else rest[1:]
        else:
            value = rest.split(" #", 1)[0].strip()
        values[key.strip()] = value
    return values


def load_env_file(path: Path = ENV_FILE) -> None:
    """Fill missing os.environ keys from the project .env (real env vars win)."""
    if not path.is_file():
        return
    for key, value in parse_env_file(path.read_text(encoding="utf-8")).items():
        os.environ.setdefault(key, value)


def check_auth(header: str | None, secret: str) -> bool:
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[len("Bearer "):].encode(), secret.encode())


# ---------------------------------------------------------------- MT5 operations


class LoopbackServer(HTTPServer):
    # On Windows SO_REUSEADDR lets a second bridge bind the same port and steal requests.
    allow_reuse_address = False


class Mt5Gateway:
    def __init__(self, api: Any, magic: int, deviation: int, terminal_path: str | None) -> None:
        self.api = api
        self.magic = magic
        self.deviation = deviation
        self.terminal_path = terminal_path

    def ensure_connected(self) -> None:
        if self.api.terminal_info() is not None:
            return
        ok = self.api.initialize(self.terminal_path) if self.terminal_path else self.api.initialize()
        if not ok:
            raise BridgeError(503, f"MT5 terminal not available: {self.api.last_error()}")

    def account(self) -> dict[str, Any]:
        self.ensure_connected()
        acc = self.api.account_info()
        if acc is None:
            raise BridgeError(503, "MT5 terminal is not logged in to an account")
        terminal = self.api.terminal_info()
        positions = self.api.positions_get() or ()
        return {
            "login": int(acc.login),
            "server": str(acc.server),
            "company": str(acc.company),
            "currency": str(acc.currency),
            "balance": float(acc.balance),
            "equity": float(acc.equity),
            "margin": float(acc.margin),
            "profit": float(acc.profit),
            "openPositions": len(positions),
            "tradeAllowed": bool(terminal.trade_allowed and acc.trade_expert),
            "dayPnl": self.day_pnl(float(acc.profit)),
        }

    def day_pnl(self, floating_profit: float) -> float | None:
        """Realized result since local midnight (trade deals only, no deposits) plus floating P&L."""
        now = datetime.now()
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        deals = self.api.history_deals_get(start, now + timedelta(days=1))
        if deals is None:
            return None
        trade_types = (self.api.DEAL_TYPE_BUY, self.api.DEAL_TYPE_SELL)
        realized = sum(
            float(d.profit) + float(d.commission) + float(d.swap) + float(getattr(d, "fee", 0.0))
            for d in deals
            if d.type in trade_types
        )
        return round(realized + floating_profit, 2)

    def _symbol(self, symbol: str) -> Any:
        info = self.api.symbol_info(symbol)
        if info is None:
            raise BridgeError(400, f"Symbol '{symbol}' not found in the terminal (check MT5_SYMBOL_XAU)")
        if not info.visible and not self.api.symbol_select(symbol, True):
            raise BridgeError(400, f"Cannot add '{symbol}' to Market Watch")
        return info

    def _send(self, request: dict[str, Any]) -> Any:
        result = self.api.order_send(request)
        if result is None:
            raise BridgeError(502, f"order_send failed: {self.api.last_error()}")
        if result.retcode not in OK_RETCODES:
            raise BridgeError(422, f"MT5 rejected the order (retcode {result.retcode}: {result.comment})")
        return result

    def open_market(self, body: dict[str, Any]) -> dict[str, Any]:
        self.ensure_connected()
        symbol = str(body.get("symbol") or "")
        side = body.get("side")
        if side not in ("BUY", "SELL"):
            raise BridgeError(400, "'side' must be BUY or SELL")
        lots = require_number(body, "lots")
        stop_loss = require_number(body, "stopLoss")
        take_profit = require_number(body, "takeProfit")

        info = self._symbol(symbol)
        volume = normalize_volume(lots, info.volume_min, info.volume_max, info.volume_step)
        if volume is None:
            raise BridgeError(400, f"Lot size {lots} is below the symbol minimum {info.volume_min}")
        tick = self.api.symbol_info_tick(symbol)
        if tick is None:
            raise BridgeError(503, f"No price for '{symbol}' (market closed?)")

        is_buy = side == "BUY"
        result = self._send({
            "action": self.api.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": volume,
            "type": self.api.ORDER_TYPE_BUY if is_buy else self.api.ORDER_TYPE_SELL,
            "price": tick.ask if is_buy else tick.bid,
            "sl": round(stop_loss, info.digits),
            "tp": round(take_profit, info.digits),
            "deviation": self.deviation,
            "magic": self.magic,
            "comment": "kestrel",
            "type_time": self.api.ORDER_TIME_GTC,
            "type_filling": pick_filling_mode(info.filling_mode),
        })
        # For market orders the position ticket equals the opening order ticket.
        return {"ticket": int(result.order), "price": float(result.price), "volume": float(result.volume)}

    def _position(self, body: dict[str, Any]) -> Any:
        ticket = body.get("ticket")
        if isinstance(ticket, bool) or not isinstance(ticket, int) or ticket <= 0:
            raise BridgeError(400, "'ticket' must be a positive integer")
        found = self.api.positions_get(ticket=ticket)
        if not found:
            raise BridgeError(404, f"Position #{ticket} is not open")
        return found[0]

    def close_position(self, body: dict[str, Any]) -> dict[str, Any]:
        self.ensure_connected()
        fraction = require_number(body, "fraction")
        if fraction <= 0 or fraction > 1:
            raise BridgeError(400, "'fraction' must be in (0, 1]")
        pos = self._position(body)
        info = self._symbol(pos.symbol)
        volume = partial_close_volume(pos.volume, fraction, info.volume_min, info.volume_step)
        tick = self.api.symbol_info_tick(pos.symbol)
        if tick is None:
            raise BridgeError(503, f"No price for '{pos.symbol}' (market closed?)")
        closing_buy = pos.type == self.api.POSITION_TYPE_BUY
        result = self._send({
            "action": self.api.TRADE_ACTION_DEAL,
            "symbol": pos.symbol,
            "volume": volume,
            "type": self.api.ORDER_TYPE_SELL if closing_buy else self.api.ORDER_TYPE_BUY,
            "position": pos.ticket,
            "price": tick.bid if closing_buy else tick.ask,
            "deviation": self.deviation,
            "magic": self.magic,
            "comment": "kestrel close",
            "type_time": self.api.ORDER_TIME_GTC,
            "type_filling": pick_filling_mode(info.filling_mode),
        })
        return {"ticket": int(pos.ticket), "closedVolume": volume, "price": float(result.price)}

    def modify_position(self, body: dict[str, Any]) -> dict[str, Any]:
        self.ensure_connected()
        stop_loss = require_number(body, "stopLoss", allow_none=True)
        take_profit = require_number(body, "takeProfit", allow_none=True)
        pos = self._position(body)
        info = self._symbol(pos.symbol)
        sl = pos.sl if stop_loss is None else round(stop_loss, info.digits)
        tp = pos.tp if take_profit is None else round(take_profit, info.digits)
        self._send({
            "action": self.api.TRADE_ACTION_SLTP,
            "symbol": pos.symbol,
            "position": pos.ticket,
            "sl": sl,
            "tp": tp,
            "magic": self.magic,
        })
        return {"ticket": int(pos.ticket), "stopLoss": sl, "takeProfit": tp}


# ---------------------------------------------------------------- HTTP layer


def make_handler(gateway: Mt5Gateway, secret: str) -> type[BaseHTTPRequestHandler]:
    routes_get = {"/account": lambda _body: gateway.account()}
    # Reachable without the key so opening the bridge in a browser shows it is alive (no account data).
    public_get = {"/", "/health"}
    routes_post = {
        "/orders/open": gateway.open_market,
        "/positions/close": gateway.close_position,
        "/positions/modify": gateway.modify_position,
    }

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            log.info("%s %s", self.address_string(), fmt % args)

        def _reply(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _read_body(self) -> dict[str, Any]:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY_BYTES:
                raise BridgeError(413, "Request body too large")
            if length == 0:
                return {}
            try:
                body = json.loads(self.rfile.read(length))
            except json.JSONDecodeError as exc:
                raise BridgeError(400, "Body must be JSON") from exc
            if not isinstance(body, dict):
                raise BridgeError(400, "Body must be a JSON object")
            return body

        def _dispatch(self, routes: dict[str, Any]) -> None:
            if self.command == "GET" and self.path in public_get:
                self._reply(200, {"ok": True, "service": "kestrel-mt5-bridge"})
                return
            try:
                if not check_auth(self.headers.get("Authorization"), secret):
                    raise BridgeError(401, "Unauthorized")
                route = routes.get(self.path)
                if route is None:
                    raise BridgeError(404, "Not found")
                self._reply(200, route(self._read_body()))
            except BridgeError as exc:
                log.warning("%s %s -> %s %s", self.command, self.path, exc.status, exc)
                self._reply(exc.status, {"error": str(exc)})
            except Exception:  # noqa: BLE001 - last-resort guard so the bridge keeps running
                log.exception("Unexpected error on %s %s", self.command, self.path)
                self._reply(500, {"error": "Internal bridge error, see bridge console"})

        def do_GET(self) -> None:  # noqa: N802 - http.server naming
            self._dispatch(routes_get)

        def do_POST(self) -> None:  # noqa: N802 - http.server naming
            self._dispatch(routes_post)

    return Handler


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_env_file()
    if mt5 is None:
        log.error("MetaTrader5 package missing. Install it with:  pip install MetaTrader5")
        return 1
    secret = os.environ.get("MT5_BRIDGE_SECRET", "").strip()
    if len(secret) < 16:
        log.error("Set MT5_BRIDGE_SECRET in .env (at least 16 characters)")
        return 1
    port = int(os.environ.get("MT5_BRIDGE_PORT", "8765"))
    gateway = Mt5Gateway(
        api=mt5,
        magic=int(os.environ.get("MT5_MAGIC", "20261120")),
        deviation=int(os.environ.get("MT5_DEVIATION", "20")),
        terminal_path=os.environ.get("MT5_TERMINAL_PATH") or None,
    )
    try:
        gateway.ensure_connected()
        acc = gateway.account()
        log.info("Connected to MT5 account #%s on %s (%s)", acc["login"], acc["server"], acc["company"])
        if not acc["tradeAllowed"]:
            log.warning("Algo Trading is disabled in the terminal: orders will be rejected until enabled")
    except BridgeError as exc:
        log.warning("%s - the bridge will retry on each request", exc)

    # Single-threaded server on purpose: the MetaTrader5 package is not thread-safe.
    try:
        server = LoopbackServer((HOST, port), make_handler(gateway, secret))
    except OSError as exc:
        log.error("Port %s is busy (is another mt5_bridge.py already running?): %s", port, exc)
        return 1
    log.info("MT5 bridge listening on http://%s:%s", HOST, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Stopping bridge")
    finally:
        server.server_close()
        mt5.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
