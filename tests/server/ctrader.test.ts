import fs from 'fs';
import os from 'os';
import path from 'path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {CTraderClient, type SocketLike} from '../../server/broker/ctrader/client.ts';
import {
  CTraderTokenStore,
  buildAuthorizeUrl,
  needsRefresh,
  parseTokenResponse,
} from '../../server/broker/ctrader/oauth.ts';
import {
  PT,
  lotsToVolume,
  parseMessage,
  relativeDistance,
  scaleMoney,
  type SymbolSpec,
} from '../../server/broker/ctrader/protocol.ts';
import {CTraderService, readCTraderConfig} from '../../server/broker/ctrader/service.ts';

const XAU: SymbolSpec = {
  symbolId: 41,
  symbolName: 'XAUUSD',
  digits: 2,
  lotSize: 10_000, // 100 oz in 1/100 units
  minVolume: 100, // 0.01 lot
  maxVolume: 10_000_000,
  stepVolume: 100,
};

describe('cTrader protocol helpers', () => {
  it('converts lots to volume snapped to the symbol step', () => {
    expect(lotsToVolume(0.1, XAU)).toBe(1000);
    expect(lotsToVolume(0.123, XAU)).toBe(1200);
  });

  it('refuses volumes below the minimum instead of rounding up', () => {
    expect(lotsToVolume(0.005, XAU)).toBeNull();
    expect(lotsToVolume(0, XAU)).toBeNull();
    expect(lotsToVolume(Number.NaN, XAU)).toBeNull();
  });

  it('clamps to maxVolume', () => {
    expect(lotsToVolume(5000, XAU)).toBe(10_000_000);
  });

  it('computes relative SL/TP distance in 1/100000 price units', () => {
    expect(relativeDistance(2400, 2390.5)).toBe(950_000);
    expect(relativeDistance(2400, 2400)).toBeNull();
  });

  it('scales money by moneyDigits', () => {
    expect(scaleMoney(10053099944, 8)).toBe(100.53);
    expect(scaleMoney(123456, 2)).toBe(1234.56);
    expect(scaleMoney(undefined, 2)).toBeNull();
  });

  it('parses only well-formed messages', () => {
    expect(parseMessage('{"payloadType":51}')?.payloadType).toBe(51);
    expect(parseMessage('not json')).toBeNull();
    expect(parseMessage('{"foo":1}')).toBeNull();
  });
});

describe('cTrader OAuth', () => {
  const app = {clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:3000/api/ctrader/callback'};

  it('builds an authorize URL with trading scope and state but without the secret', () => {
    const url = new URL(buildAuthorizeUrl(app, 'st4te'));
    expect(url.host).toBe('id.ctrader.com');
    expect(url.searchParams.get('scope')).toBe('trading');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('redirect_uri')).toBe(app.redirectUri);
    expect(url.toString()).not.toContain('secret');
  });

  it('parses token responses and computes expiry', () => {
    const tokens = parseTokenResponse({accessToken: 'a', refreshToken: 'r', expiresIn: 100}, 1000);
    expect(tokens).toEqual({accessToken: 'a', refreshToken: 'r', expiresAt: 101_000});
  });

  it('throws on token error responses', () => {
    expect(() => parseTokenResponse({errorCode: 'ACCESS_DENIED', description: 'nope'})).toThrow(/ACCESS_DENIED/);
    expect(() => parseTokenResponse({accessToken: 'a'})).toThrow(/missing/);
  });

  it('flags tokens close to expiry for refresh', () => {
    const now = Date.now();
    expect(needsRefresh({accessToken: 'a', refreshToken: 'r', expiresAt: now + 60_000}, now)).toBe(true);
    expect(needsRefresh({accessToken: 'a', refreshToken: 'r', expiresAt: now + 20 * 86_400_000}, now)).toBe(false);
    expect(needsRefresh({accessToken: 'a', refreshToken: 'r', expiresAt: null}, now)).toBe(false);
  });

  describe('token store', () => {
    let dir: string;
    afterEach(() => fs.rmSync(dir, {recursive: true, force: true}));

    it('round-trips tokens and returns null when missing', () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-ct-'));
      const store = new CTraderTokenStore(path.join(dir, 'tokens.json'));
      expect(store.load()).toBeNull();
      store.save({accessToken: 'a', refreshToken: 'r', expiresAt: 5});
      expect(store.load()).toEqual({accessToken: 'a', refreshToken: 'r', expiresAt: 5});
    });
  });
});

describe('cTrader service config + OAuth state', () => {
  it('returns null without client credentials', () => {
    expect(readCTraderConfig({})).toBeNull();
  });

  it('reads defaults for demo + XAUUSD', () => {
    const cfg = readCTraderConfig({CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 's'});
    expect(cfg?.env).toBe('demo');
    expect(cfg?.symbolName).toBe('XAUUSD');
    expect(cfg?.app.redirectUri).toBe('http://localhost:3000/api/ctrader/callback');
    expect(cfg?.envTokens).toBeNull();
  });

  it('rejects a callback with an unknown state and accepts a fresh one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-ct-'));
    try {
      const cfg = readCTraderConfig({CTRADER_CLIENT_ID: 'id', CTRADER_CLIENT_SECRET: 's'})!;
      const service = new CTraderService(cfg, new CTraderTokenStore(path.join(dir, 't.json')));
      expect(service.isAuthorized()).toBe(false);
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({accessToken: 'acc', refreshToken: 'ref', expiresIn: 3600}), {status: 200}),
      ) as unknown as typeof fetch;

      await expect(service.completeAuthorization('code', 'forged', fetchFn)).rejects.toThrow(/state/);
      expect(fetchFn).not.toHaveBeenCalled();

      const state = new URL(service.createAuthorizeUrl()).searchParams.get('state')!;
      await service.completeAuthorization('code', state, fetchFn);
      expect(service.isAuthorized()).toBe(true);
      // State is single-use.
      await expect(service.completeAuthorization('code', state, fetchFn)).rejects.toThrow(/state/);
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});

// Scripted fake of the cTrader server: answers each request by payloadType.
class FakeSocket implements SocketLike {
  sent: Array<{clientMsgId?: string; payloadType: number; payload: Record<string, unknown>}> = [];
  private listeners: Record<string, Array<(ev: {data?: unknown}) => void>> = {};
  constructor(private respond: (req: FakeSocket['sent'][number]) => object[]) {
    setTimeout(() => this.emit('open', {}), 0);
  }
  addEventListener(type: string, listener: (ev: {data?: unknown}) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string) {
    const req = JSON.parse(data);
    this.sent.push(req);
    for (const res of this.respond(req)) {
      setTimeout(() => this.emit('message', {data: JSON.stringify(res)}), 0);
    }
  }
  close() {
    this.emit('close', {});
  }
  private emit(type: string, ev: {data?: unknown}) {
    for (const l of this.listeners[type] ?? []) l(ev);
  }
}

function makeServer(overrides: Partial<Record<number, (req: FakeSocket['sent'][number]) => object[]>> = {}) {
  const reply = (req: {clientMsgId?: string}, payloadType: number, payload: object = {}) => ({
    clientMsgId: req.clientMsgId,
    payloadType,
    payload,
  });
  const handlers: Record<number, (req: FakeSocket['sent'][number]) => object[]> = {
    [PT.APPLICATION_AUTH_REQ]: (r) => [reply(r, PT.APPLICATION_AUTH_RES)],
    [PT.GET_ACCOUNTS_BY_TOKEN_REQ]: (r) => [
      reply(r, PT.GET_ACCOUNTS_BY_TOKEN_RES, {
        ctidTraderAccount: [
          {ctidTraderAccountId: 111, isLive: false, traderLogin: 9001},
          {ctidTraderAccountId: 222, isLive: true, traderLogin: 9002},
        ],
      }),
    ],
    [PT.ACCOUNT_AUTH_REQ]: (r) => [reply(r, PT.ACCOUNT_AUTH_RES)],
    [PT.SYMBOLS_LIST_REQ]: (r) => [reply(r, PT.SYMBOLS_LIST_RES, {symbol: [{symbolId: 41, symbolName: 'XAUUSD'}]})],
    [PT.SYMBOL_BY_ID_REQ]: (r) => [reply(r, PT.SYMBOL_BY_ID_RES, {symbol: [{...XAU, symbolName: undefined}]})],
    [PT.NEW_ORDER_REQ]: (r) => [
      reply(r, PT.EXECUTION_EVENT, {executionType: 2, order: {orderId: 77}}),
      {payloadType: PT.EXECUTION_EVENT, payload: {executionType: 3, order: {orderId: 77}, position: {positionId: 555}, deal: {executionPrice: 2401.25}}},
    ],
    [PT.RECONCILE_REQ]: (r) => [reply(r, PT.RECONCILE_RES, {position: [{positionId: 555, tradeData: {volume: 1000}, usedMargin: 5000, moneyDigits: 2}]})],
    [PT.CLOSE_POSITION_REQ]: (r) => [reply(r, PT.EXECUTION_EVENT, {executionType: 3})],
    [PT.TRADER_REQ]: (r) => [reply(r, PT.TRADER_RES, {trader: {balance: 1_000_000, moneyDigits: 2, traderLogin: 9001}})],
    [PT.POSITION_UNREALIZED_PNL_REQ]: (r) => [reply(r, PT.POSITION_UNREALIZED_PNL_RES, {moneyDigits: 2, positionUnrealizedPnL: [{positionId: 555, netUnrealizedPnL: -1250}]})],
    ...overrides,
  };
  let socket: FakeSocket | null = null;
  const factory = () => {
    socket = new FakeSocket((req) => handlers[req.payloadType]?.(req) ?? []);
    return socket;
  };
  return {factory, sent: () => socket?.sent ?? []};
}

function makeClient(server: ReturnType<typeof makeServer>, accountId: number | null = null) {
  return new CTraderClient({
    env: 'demo',
    clientId: 'id',
    clientSecret: 's',
    accountId,
    symbolName: 'XAUUSD',
    getAccessToken: async () => 'token',
    onTokenRejected: vi.fn(),
    socketFactory: server.factory,
  });
}

describe('CTraderClient', () => {
  it('authenticates, picks the single demo account and loads the symbol', async () => {
    const server = makeServer();
    const client = makeClient(server);
    await client.ensureReady();
    const types = server.sent().map((m) => m.payloadType);
    expect(types.slice(0, 5)).toEqual([
      PT.APPLICATION_AUTH_REQ,
      PT.GET_ACCOUNTS_BY_TOKEN_REQ,
      PT.ACCOUNT_AUTH_REQ,
      PT.SYMBOLS_LIST_REQ,
      PT.SYMBOL_BY_ID_REQ,
    ]);
    expect(server.sent()[2].payload.ctidTraderAccountId).toBe(111);
    expect(client.getSymbol()?.lotSize).toBe(10_000);
    client.close();
  });

  it('refuses a live account when running in demo mode', async () => {
    const client = makeClient(makeServer(), 222);
    await expect(client.ensureReady()).rejects.toThrow(/live but CTRADER_ENV=demo/);
  });

  it('places a market order with relative SL/TP and returns the filled position', async () => {
    const server = makeServer();
    const client = makeClient(server);
    const fill = await client.placeMarketOrder({side: 'SELL', lots: 0.1, stopLoss: 2410, takeProfit: 2380, estimatedPrice: 2400});
    expect(fill).toEqual({positionId: '555', fillPrice: 2401.25});
    const order = server.sent().find((m) => m.payloadType === PT.NEW_ORDER_REQ)!;
    expect(order.payload).toMatchObject({
      ctidTraderAccountId: 111,
      symbolId: 41,
      orderType: 1,
      tradeSide: 2,
      volume: 1000,
      relativeStopLoss: 1_000_000,
      relativeTakeProfit: 2_000_000,
    });
    expect(order.payload.stopLoss).toBeUndefined();
    client.close();
  });

  it('rejects the order when the server sends an order error', async () => {
    const server = makeServer({
      [PT.NEW_ORDER_REQ]: (r) => [{clientMsgId: r.clientMsgId, payloadType: PT.ORDER_ERROR_EVENT, payload: {errorCode: 'NOT_ENOUGH_MONEY'}}],
    });
    const client = makeClient(server);
    await expect(
      client.placeMarketOrder({side: 'BUY', lots: 0.1, stopLoss: 2390, takeProfit: 2420, estimatedPrice: 2400}),
    ).rejects.toThrow(/NOT_ENOUGH_MONEY/);
    client.close();
  });

  it('refuses lot sizes below the broker minimum without sending anything', async () => {
    const server = makeServer();
    const client = makeClient(server);
    await expect(
      client.placeMarketOrder({side: 'BUY', lots: 0.001, stopLoss: 2390, takeProfit: 2420, estimatedPrice: 2400}),
    ).rejects.toThrow(/below the broker minimum/);
    expect(server.sent().some((m) => m.payloadType === PT.NEW_ORDER_REQ)).toBe(false);
    client.close();
  });

  it('closes the full broker-reported volume on a full close', async () => {
    const server = makeServer();
    const client = makeClient(server);
    await client.closePosition('555', 1);
    const close = server.sent().find((m) => m.payloadType === PT.CLOSE_POSITION_REQ)!;
    expect(close.payload).toMatchObject({positionId: 555, volume: 1000});
    client.close();
  });

  it('closes half of the position on a partial close', async () => {
    const server = makeServer();
    const client = makeClient(server);
    await client.closePosition('555', 0.5);
    const close = server.sent().find((m) => m.payloadType === PT.CLOSE_POSITION_REQ)!;
    expect(close.payload.volume).toBe(500);
    client.close();
  });

  it('summarizes balance, equity and margin', async () => {
    const client = makeClient(makeServer());
    const summary = await client.getAccountSummary();
    expect(summary).toMatchObject({
      accountId: 111,
      traderLogin: 9001,
      balance: 10_000,
      unrealizedPnl: -12.5,
      equity: 9987.5,
      marginUsed: 50,
      openPositions: 1,
    });
    client.close();
  });
});
