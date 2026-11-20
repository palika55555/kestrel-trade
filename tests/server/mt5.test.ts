import {afterEach, describe, expect, it, vi} from 'vitest';
import {BrokerBridge, type BrokerBridgeHost} from '../../server/broker/brokerBridge.ts';
import {type FetchLike, Mt5BridgeClient, readMt5Config} from '../../server/broker/mt5/client.ts';
import type {Position} from '../../src/types/trading.ts';

const BROKER_ENV_KEYS = [
  'BROKER_PROVIDER',
  'OANDA_API_TOKEN',
  'OANDA_ACCOUNT_ID',
  'METAAPI_TOKEN',
  'METAAPI_ACCOUNT_ID',
  'CTRADER_CLIENT_ID',
  'CTRADER_CLIENT_SECRET',
  'CTRADER_ACCESS_TOKEN',
  'CTRADER_ACCOUNT_ID',
  'MT5_BRIDGE_URL',
  'MT5_BRIDGE_SECRET',
  'MT5_SYMBOL_XAU',
  'BROKER_WEBHOOK_URL',
];

const ACCOUNT = {
  login: 633110,
  server: 'BlueGuardian-Server',
  company: 'Blue Guardian',
  currency: 'USD',
  balance: 4999.4,
  equity: 5048.48,
  margin: 12.5,
  profit: 49.08,
  openPositions: 1,
  tradeAllowed: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function setEnv(values: Record<string, string>) {
  for (const key of BROKER_ENV_KEYS) vi.stubEnv(key, '');
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function makeHost(armed = true): BrokerBridgeHost {
  return {isRoutingArmed: () => armed, setRoutingArmed: vi.fn(), persist: vi.fn(), log: vi.fn()};
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readMt5Config', () => {
  it('returns null without a bridge secret', () => {
    expect(readMt5Config({})).toBeNull();
  });

  it('defaults to the loopback bridge and XAUUSD', () => {
    expect(readMt5Config({MT5_BRIDGE_SECRET: 's3cret'})).toEqual({
      baseUrl: 'http://127.0.0.1:8765',
      secret: 's3cret',
      symbol: 'XAUUSD',
    });
  });

  it('rejects malformed or non-http URLs', () => {
    expect(() => readMt5Config({MT5_BRIDGE_SECRET: 's', MT5_BRIDGE_URL: 'not a url'})).toThrow(/valid URL/);
    expect(() => readMt5Config({MT5_BRIDGE_SECRET: 's', MT5_BRIDGE_URL: 'file:///etc'})).toThrow(/http/);
  });
});

describe('Mt5BridgeClient', () => {
  const config = {baseUrl: 'http://127.0.0.1:8765', secret: 'tok', symbol: 'XAUUSD.x'};

  it('sends an authenticated open order and returns the ticket as string', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, {ticket: 777, price: 2400.45, volume: 0.05}));
    const client = new Mt5BridgeClient(config, fetchMock);

    const fill = await client.openMarket({side: 'BUY', lots: 0.05, stopLoss: 2390, takeProfit: 2420});

    expect(fill).toEqual({ticket: '777', price: 2400.45, volume: 0.05});
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8765/orders/open');
    expect(init?.headers).toMatchObject({Authorization: 'Bearer tok'});
    expect(JSON.parse(String(init?.body))).toEqual({
      symbol: 'XAUUSD.x',
      side: 'BUY',
      lots: 0.05,
      stopLoss: 2390,
      takeProfit: 2420,
    });
  });

  it('surfaces the bridge error message on HTTP failure', async () => {
    const client = new Mt5BridgeClient(config, async () => jsonResponse(422, {error: 'MT5 rejected the order'}));
    await expect(client.closePosition('555', 1)).rejects.toThrow('MT5 bridge HTTP 422: MT5 rejected the order');
  });

  it('explains when the bridge is not running', async () => {
    const client = new Mt5BridgeClient(config, async () => {
      throw new TypeError('fetch failed');
    });
    await expect(client.getAccount()).rejects.toThrow(/is mt5_bridge.py running/);
  });

  it('rejects malformed account payloads', async () => {
    const client = new Mt5BridgeClient(config, async () => jsonResponse(200, {balance: 'lots'}));
    await expect(client.getAccount()).rejects.toThrow();
  });

  it('sends numeric tickets for close and modify', async () => {
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, {}));
    const client = new Mt5BridgeClient(config, fetchMock);

    await client.closePosition('555', 0.5);
    await client.modifyPosition('555', 2395, null);

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ticket: 555, fraction: 0.5});
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ticket: 555, stopLoss: 2395, takeProfit: null});
  });

  it('fetches live quote and OHLCV candles from the MT5 bridge', async () => {
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (url.includes('/quote')) {
        return jsonResponse(200, {symbol: 'XAUUSD.x', bid: 3520.1, ask: 3520.45, spread: 0.35, digits: 2});
      }
      return jsonResponse(200, {
        symbol: 'XAUUSD.x',
        timeframe: '15m',
        candles: [{time: 1700000000, open: 3518, high: 3522, low: 3517, close: 3520.2, volume: 210}],
      });
    });
    const client = new Mt5BridgeClient(config, fetchMock);

    const q = await client.getQuote();
    const bars = await client.getCandles('15m', 120);

    expect(q).toMatchObject({symbol: 'XAUUSD.x', bid: 3520.1, ask: 3520.45});
    expect(bars).toHaveLength(1);
    expect(bars[0].close).toBe(3520.2);
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8765/quote?symbol=XAUUSD.x');
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:8765/candles?symbol=XAUUSD.x&timeframe=15m&count=120');
  });
});

describe('BrokerBridge provider selection', () => {
  it('BROKER_PROVIDER picks MT5 even when MetaApi is also configured', () => {
    setEnv({BROKER_PROVIDER: 'mt5', MT5_BRIDGE_SECRET: 'x', METAAPI_TOKEN: 't', METAAPI_ACCOUNT_ID: 'a'});
    const status = new BrokerBridge(makeHost()).getBrokerStatus();
    expect(status.provider).toBe('MT5');
    expect(status.configured).toBe(true);
  });

  it('falls back to simulation with an error when the selected broker has no credentials', () => {
    setEnv({BROKER_PROVIDER: 'MT5', METAAPI_TOKEN: 't', METAAPI_ACCOUNT_ID: 'a'});
    const status = new BrokerBridge(makeHost()).getBrokerStatus();
    expect(status.provider).toBe('SIMULATION');
    expect(status.configured).toBe(false);
    expect(status.lastError).toMatch(/MT5 is selected but its credentials are missing/);
  });

  it('reports unsupported BROKER_PROVIDER values', () => {
    setEnv({BROKER_PROVIDER: 'FTX'});
    expect(new BrokerBridge(makeHost()).getBrokerStatus().lastError).toMatch(/not supported/);
  });

  it('keeps the legacy priority order when BROKER_PROVIDER is unset', () => {
    setEnv({MT5_BRIDGE_SECRET: 'x', METAAPI_TOKEN: 't', METAAPI_ACCOUNT_ID: 'a'});
    expect(new BrokerBridge(makeHost()).getBrokerStatus().provider).toBe('METAAPI');
  });

  it('turns an invalid bridge URL into a status error instead of crashing', () => {
    setEnv({BROKER_PROVIDER: 'MT5', MT5_BRIDGE_SECRET: 'x', MT5_BRIDGE_URL: 'nope'});
    const status = new BrokerBridge(makeHost()).getBrokerStatus();
    expect(status.provider).toBe('SIMULATION');
    expect(status.lastError).toMatch(/valid URL/);
  });
});

describe('BrokerBridge MT5 routing', () => {
  function bridgeWith(fetchMock: FetchLike) {
    setEnv({BROKER_PROVIDER: 'MT5', MT5_BRIDGE_SECRET: 'x'});
    return new BrokerBridge(makeHost(), fetchMock);
  }

  it('syncs balance and equity from the terminal account', async () => {
    const status = await bridgeWith(async () => jsonResponse(200, ACCOUNT)).syncBrokerAccount();
    expect(status.accountLabel).toBe('Blue Guardian #633110 (BlueGuardian-Server)');
    expect(status.balance).toBe(4999.4);
    expect(status.equity).toBe(5048.48);
    expect(status.openPositionsCount).toBe(1);
    expect(status.dayPnl).toBeNull();
    expect(status.lastError).toBeNull();
  });

  it('exposes day P&L and routed equity only while live routing is armed', async () => {
    setEnv({BROKER_PROVIDER: 'MT5', MT5_BRIDGE_SECRET: 'x'});
    const fetchMock: FetchLike = async () => jsonResponse(200, {...ACCOUNT, dayPnl: 66.58});
    const armed = new BrokerBridge(makeHost(true), fetchMock);
    expect(armed.getRoutedEquity()).toBeNull(); // not synced yet
    await armed.refreshIfRouting();
    expect(armed.getBrokerStatus().dayPnl).toBe(66.58);
    expect(armed.getRoutedEquity()).toBe(5048.48);

    const disarmed = new BrokerBridge(makeHost(false), fetchMock);
    await disarmed.refreshIfRouting();
    expect(disarmed.getRoutedEquity()).toBeNull();
  });

  it('does not start overlapping refreshes', async () => {
    setEnv({BROKER_PROVIDER: 'MT5', MT5_BRIDGE_SECRET: 'x'});
    const fetchMock = vi.fn<FetchLike>(async () => jsonResponse(200, ACCOUNT));
    const bridge = new BrokerBridge(makeHost(true), fetchMock);
    await Promise.all([bridge.refreshIfRouting(), bridge.refreshIfRouting()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns when Algo Trading is disabled in the terminal', async () => {
    const status = await bridgeWith(async () => jsonResponse(200, {...ACCOUNT, tradeAllowed: false})).syncBrokerAccount();
    expect(status.lastError).toMatch(/Algo Trading is disabled/);
  });

  it('stores the real MT5 ticket and fill price for opened orders', async () => {
    const bridge = bridgeWith(async () => jsonResponse(200, {ticket: 777, price: 2400.45, volume: 0.05}));
    const res = await bridge.routeBrokerOpenOrder({
      side: 'SELL',
      lotSize: 0.05,
      stopLoss: 2410,
      takeProfit: 2380,
      estimatedPrice: 2400,
    });
    expect(res).toEqual({ok: true, provider: 'MT5', brokerTradeId: '777', fillPrice: 2400.45});
  });

  it('reports order rejections without throwing', async () => {
    const bridge = bridgeWith(async () => jsonResponse(422, {error: 'retcode 10019: No money'}));
    const res = await bridge.routeBrokerOpenOrder({
      side: 'BUY',
      lotSize: 1,
      stopLoss: 2390,
      takeProfit: 2420,
      estimatedPrice: 2400,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No money/);
  });

  it('records a failed close in lastError', async () => {
    const bridge = bridgeWith(async () => jsonResponse(404, {error: 'Position #777 is not open'}));
    await bridge.routeBrokerCloseOrder({brokerOrderId: '777'} as Position, 1);
    expect(bridge.getBrokerStatus().lastError).toMatch(/not open/);
  });

  it('fetches MT5 quotes & candles when configured, backs off on error, and resets backoff on sync', async () => {
    let fail = true;
    const fetchMock = vi.fn<FetchLike>(async (url) => {
      if (url.includes('/account')) return jsonResponse(200, ACCOUNT);
      if (fail) throw new TypeError('connect ECONNREFUSED');
      if (url.includes('/quote')) return jsonResponse(200, {symbol: 'XAUUSD', bid: 3510.2, ask: 3510.5});
      return jsonResponse(200, {
        symbol: 'XAUUSD',
        timeframe: '5m',
        candles: [{time: 1700000300, open: 3509, high: 3511, low: 3508.5, close: 3510.3, volume: 90}],
      });
    });
    const bridge = bridgeWith(fetchMock);
    expect(bridge.isMt5Configured()).toBe(true);
    expect(await bridge.fetchMt5Quote()).toBeNull();
    fail = false;
    // Backoff prevents immediate retry until syncBrokerAccount resets it
    expect(await bridge.fetchMt5Quote()).toBeNull();
    await bridge.syncBrokerAccount();
    const q = await bridge.fetchMt5Quote();
    const c = await bridge.fetchMt5Candles('5m', 200);
    expect(q?.bid).toBe(3510.2);
    expect(c?.[0].close).toBe(3510.3);
  });
});
