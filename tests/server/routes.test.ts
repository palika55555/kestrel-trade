import express from 'express';
import fs from 'fs';
import type {AddressInfo} from 'net';
import os from 'os';
import path from 'path';
import type {Server} from 'http';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AuditLog} from '../../server/auditLog.ts';
import type {LiveMarketEngine} from '../../server/marketEngine.ts';
import {createApiRouter} from '../../server/routes.ts';

function makeFakeEngine() {
  const state = {
    enabled: false,
    config: {lotSize: 0.1, strategy: 'ORB_VWAP', maxConcurrentPositions: 3},
    positions: [{id: 'p1', stopLoss: 2380, takeProfit: 2420}],
  };
  let broker = {provider: 'OANDA', environment: 'practice', routingArmed: false, configured: true};
  return {
    getServerBotState: vi.fn(() => structuredClone(state)),
    updateServerBotConfig: vi.fn((update: Record<string, unknown>) => {
      if (typeof update.enabled === 'boolean') state.enabled = update.enabled;
      const {enabled: _e, ...rest} = update;
      state.config = {...state.config, ...rest} as typeof state.config;
      return structuredClone(state);
    }),
    closeAllServerBotPositions: vi.fn(() => ({...state, positions: []})),
    closeServerBotPosition: vi.fn(() => state),
    updateServerBotPositionRisk: vi.fn(() => state),
    resetServerBotState: vi.fn(() => state),
    getBrokerStatus: vi.fn(() => ({...broker})),
    setBrokerRoutingArmed: vi.fn((armed: boolean) => {
      broker = {...broker, routingArmed: armed && broker.configured};
      return {...broker};
    }),
    syncBrokerAccount: vi.fn(async () => ({...broker})),
    getEconomicCalendar: vi.fn((before: number, after: number) => ({before, after})),
    getMarkets: vi.fn(() => [{symbol: 'XAU/USD', price: 2400}]),
    getOrderFlow: vi.fn((symbol: string) => ({symbol})),
    getDomLevel2: vi.fn((symbol: string, step?: number) =>
      symbol === 'XAU/USD' ? {symbol, stepSize: step ?? 0.5, isRealL2: true} : null,
    ),
    getGoldMacro: vi.fn(() => ({macroScore: 0})),
    fetchLiveCandles: vi.fn(async (symbol: string) => (symbol === 'XAU/USD' ? [{time: 1, close: 2400}] : [])),
    addSubscriber: vi.fn(),
    removeSubscriber: vi.fn(),
  };
}

describe('API routes', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let engine: ReturnType<typeof makeFakeEngine>;
  let audit: AuditLog;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-routes-'));
    engine = makeFakeEngine();
    audit = new AuditLog(path.join(dir, 'audit.jsonl'));
    const app = express();
    app.use('/api', createApiRouter(engine as unknown as LiveMarketEngine, audit));
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, {recursive: true, force: true});
  });

  const post = (url: string, body: unknown) =>
    fetch(`${base}${url}`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });

  it('rejects an invalid bot config with 400 and does not touch the engine', async () => {
    const res = await post('/bot/config', {maxConcurrentPositions: 9999});
    expect(res.status).toBe(400);
    expect((await res.json()).details[0]).toContain('maxConcurrentPositions');
    expect(engine.updateServerBotConfig).not.toHaveBeenCalled();
    expect(audit.list()[0].action).toBe('REQUEST_REJECTED');
  });

  it('applies a valid config and audits enable + field changes', async () => {
    const res = await post('/bot/config', {enabled: true, lotSize: 0.5});
    expect(res.status).toBe(200);
    expect(engine.updateServerBotConfig).toHaveBeenCalledWith({enabled: true, lotSize: 0.5});
    const actions = audit.list().map((e) => e.action);
    expect(actions).toEqual(['BOT_CONFIG_UPDATE', 'BOT_ENABLED']);
    expect(audit.list()[0].changes).toEqual({lotSize: {from: 0.1, to: 0.5}});
  });

  it('does not write a config audit entry when nothing changed', async () => {
    await post('/bot/config', {lotSize: 0.1});
    expect(audit.list()).toHaveLength(0);
  });

  it('requires a boolean to arm broker routing and audits the switch', async () => {
    expect((await post('/broker/mode', {routingArmed: 'yes'})).status).toBe(400);
    expect(engine.setBrokerRoutingArmed).not.toHaveBeenCalled();

    const res = await post('/broker/mode', {routingArmed: true});
    expect((await res.json()).routingArmed).toBe(true);
    expect(audit.list()[0]).toMatchObject({
      action: 'BROKER_ROUTING_ARMED',
      changes: {routingArmed: {from: false, to: true}},
      ip: '127.0.0.1',
    });
  });

  it('validates close fractions and audits closes', async () => {
    expect((await post('/bot/close/p1', {fraction: 2})).status).toBe(400);
    expect((await post('/bot/close/p1', {fraction: 0.5})).status).toBe(200);
    expect(engine.closeServerBotPosition).toHaveBeenCalledWith('p1', 0.5);
    expect(audit.list()[0].summary).toBe('Closed 50% of position p1');

    await post('/bot/close-all', {});
    expect(audit.list()[0]).toMatchObject({action: 'BOT_CLOSE_ALL', summary: 'Closed all bot positions (1)'});
  });

  it('returns DOM Level 2 snapshot for valid symbol and 404 when unavailable', async () => {
    const okRes = await fetch(`${base}/dom/XAU%2FUSD?step=1`);
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toMatchObject({symbol: 'XAU/USD', stepSize: 1, isRealL2: true});

    const missRes = await fetch(`${base}/dom/UNKNOWN`);
    expect(missRes.status).toBe(404);
  });

  it('records old and new SL/TP when risk is updated', async () => {
    await post('/bot/risk/p1', {stopLoss: 2390, takeProfit: null});
    expect(engine.updateServerBotPositionRisk).toHaveBeenCalledWith('p1', 2390, null);
    expect(audit.list()[0].changes).toEqual({
      stopLoss: {from: 2380, to: 2390},
      takeProfit: {from: 2420, to: null},
    });
  });

  it('answers malformed JSON with a JSON 400 instead of an HTML error', async () => {
    const res = await post('/bot/config', '{broken');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({error: 'Malformed JSON body', details: []});
  });

  it('serves the audit trail newest first and 404s unknown endpoints', async () => {
    await post('/bot/reset', {});
    const res = await fetch(`${base}/audit?limit=5`);
    expect((await res.json()).entries[0].action).toBe('BOT_RESET');
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it('clamps calendar window query params', async () => {
    const res = await fetch(`${base}/calendar?before=30&after=-4`);
    expect(await res.json()).toEqual({before: 30, after: 15});
  });

  it('serves read-only market endpoints', async () => {
    expect((await (await fetch(`${base}/health`)).json()).status).toBe('ok');
    expect((await (await fetch(`${base}/markets`)).json()).instruments).toHaveLength(1);
    expect(await (await fetch(`${base}/orderflow/XAU%2FUSD`)).json()).toEqual({symbol: 'XAU/USD'});
    expect(await (await fetch(`${base}/macro/gold`)).json()).toEqual({macroScore: 0});
    expect((await (await fetch(`${base}/broker/status`)).json()).provider).toBe('OANDA');
    expect((await (await fetch(`${base}/bot/state`)).json()).positions).toHaveLength(1);
  });

  it('falls back to 15m for unknown timeframes and 404s unknown instruments', async () => {
    await fetch(`${base}/candles/XAU%2FUSD?timeframe=7m`);
    expect(engine.fetchLiveCandles).toHaveBeenLastCalledWith('XAU/USD', '15m');
    const ok = await (await fetch(`${base}/candles/XAU%2FUSD?timeframe=1H`)).json();
    expect(ok.timeframe).toBe('1H');
    expect((await fetch(`${base}/candles/NOPE`)).status).toBe(404);
  });

  it('audits broker sync and refused arming without credentials', async () => {
    await post('/broker/sync', {});
    expect(audit.list()[0].action).toBe('BROKER_SYNC');
    engine.setBrokerRoutingArmed.mockImplementationOnce(() => ({
      provider: 'NONE', environment: 'practice', routingArmed: false, configured: false,
    }));
    await post('/broker/mode', {routingArmed: true});
    expect(audit.list()[0]).toMatchObject({
      action: 'BROKER_ARM_REFUSED',
      summary: expect.stringContaining('refused'),
    });
  });

  it('streams an initial tick over SSE and unsubscribes on disconnect', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/stream`, {signal: controller.signal});
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const {value} = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"type":"TICK"');
    expect(engine.addSubscriber).toHaveBeenCalledTimes(1);
    controller.abort();
    await vi.waitFor(() => expect(engine.removeSubscriber).toHaveBeenCalled());
  });

  it('returns 404 without an audit entry for unknown positions', async () => {
    expect((await post('/bot/close/ghost', {fraction: 1})).status).toBe(404);
    expect((await post('/bot/risk/ghost', {stopLoss: 1, takeProfit: null})).status).toBe(404);
    expect(engine.closeServerBotPosition).not.toHaveBeenCalled();
    expect(audit.list()).toHaveLength(0);
  });

  it('blocks cross-site POSTs and audits them', async () => {
    const res = await fetch(`${base}/bot/reset`, {method: 'POST', headers: {Origin: 'https://evil.example'}});
    expect(res.status).toBe(403);
    expect(engine.resetServerBotState).not.toHaveBeenCalled();
    expect(audit.list()[0]).toMatchObject({action: 'REQUEST_REJECTED', summary: expect.stringContaining('cross-origin')});
  });

  it('allows same-origin POSTs from the app itself', async () => {
    const res = await fetch(`${base}/bot/reset`, {method: 'POST', headers: {Origin: base.replace('/api', '')}});
    expect(res.status).toBe(200);
  });

  it('explains how to configure cTrader when credentials are missing', async () => {
    const res = await fetch(`${base}/ctrader/connect`, {redirect: 'manual'});
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('CTRADER_CLIENT_ID');
  });

  it('redirects /ctrader/connect to the cTrader consent page when configured', async () => {
    (engine as Record<string, unknown>).getCTraderService = () => ({
      createAuthorizeUrl: () => 'https://id.ctrader.com/my/settings/openapi/grantingaccess/?state=x',
    });
    const res = await fetch(`${base}/ctrader/connect`, {redirect: 'manual'});
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('id.ctrader.com');
    expect(audit.list()[0].action).toBe('BROKER_CONNECT_START');
  });

  it('rejects a cTrader callback without code/state and audits it', async () => {
    const res = await fetch(`${base}/ctrader/callback?code=abc`);
    expect(res.status).toBe(400);
    expect(audit.list()[0].action).toBe('BROKER_CONNECT_FAILED');
  });

  it('escapes broker text in the cTrader callback page', async () => {
    (engine as Record<string, unknown>).getCTraderService = () => ({
      config: {env: 'demo'},
      completeAuthorization: vi.fn(async () => undefined),
    });
    engine.syncBrokerAccount.mockResolvedValueOnce({accountLabel: '<script>x</script>', lastError: null} as never);
    const res = await fetch(`${base}/ctrader/callback?code=abc&state=s`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).not.toContain('<script>');
    expect(audit.list().map((e) => e.action)).toContain('BROKER_CONNECTED');
  });
});
