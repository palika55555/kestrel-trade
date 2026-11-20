import express from 'express';
import type {Timeframe} from '../src/types/trading.ts';
import {AuditLog, diffChanges, type AuditRequestInfo} from './auditLog.ts';
import type {LiveMarketEngine} from './marketEngine.ts';
import {allowedHostsFromEnv, createRequestGuard} from './requestGuard.ts';
import {
  botConfigUpdateSchema,
  brokerModeSchema,
  calendarQuerySchema,
  closePositionSchema,
  parseInput,
  positionRiskSchema,
  type ParseResult,
} from './validation.ts';

const VALID_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1H', '4H', '1D'];
const SSE_HEARTBEAT_MS = 15_000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function requestInfo(req: express.Request): AuditRequestInfo {
  return {
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}

export interface ApiRouterOptions {
  allowedHosts?: string[];
}

export function createApiRouter(
  engine: LiveMarketEngine,
  audit: AuditLog,
  options: ApiRouterOptions = {},
): express.Router {
  const router = express.Router();
  router.use(
    createRequestGuard(options.allowedHosts ?? allowedHostsFromEnv(), (req, reason) => {
      audit.record('REQUEST_REJECTED', `${req.method} ${req.originalUrl}: ${reason}`, requestInfo(req));
    }),
  );
  router.use(express.json({limit: '256kb'}));

  function positionExists(id: string): boolean {
    return engine.getServerBotState().positions.some((p) => p.id === id);
  }

  // Sends 400 and records the rejected attempt; returns the parsed data or null.
  function validated<T>(req: express.Request, res: express.Response, result: ParseResult<T>): T | null {
    if (result.ok) return result.data;
    audit.record(
      'REQUEST_REJECTED',
      `${req.method} ${req.originalUrl}: ${result.failure.details.join('; ')}`,
      requestInfo(req),
    );
    res.status(400).json(result.failure);
    return null;
  }

  router.get('/health', (_req, res) => {
    res.json({status: 'ok', timestamp: Date.now()});
  });

  router.get('/markets', (_req, res) => {
    res.json({timestamp: Date.now(), instruments: engine.getMarkets()});
  });

  router.get('/orderflow/:symbol', (req, res) => {
    res.json(engine.getOrderFlow(decodeURIComponent(req.params.symbol)));
  });

  router.get('/dom/:symbol', (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    const stepParam = typeof req.query.step === 'string' ? parseFloat(req.query.step) : undefined;
    const step = stepParam && Number.isFinite(stepParam) && stepParam > 0 ? stepParam : undefined;
    const snap = engine.getDomLevel2?.(symbol, step) ?? null;
    if (!snap) {
      res.status(404).json({error: 'DOM unavailable for symbol'});
      return;
    }
    res.json(snap);
  });

  router.get('/macro/gold', (_req, res) => {
    res.json(engine.getGoldMacro());
  });

  router.get('/institutional/gold', (_req, res) => {
    res.json(engine.getInstitutionalGold());
  });

  router.get('/calendar', (req, res) => {
    const query = calendarQuerySchema.parse(req.query);
    res.json(engine.getEconomicCalendar(query.before, query.after));
  });

  router.get('/bot/state', (_req, res) => {
    res.json(engine.getServerBotState());
  });

  router.post('/bot/config', (req, res) => {
    const update = validated(req, res, parseInput(botConfigUpdateSchema, req.body));
    if (!update) return;
    const before = engine.getServerBotState();
    const after = engine.updateServerBotConfig(update);
    const {enabled: _enabled, ...configFields} = update;
    const changes = diffChanges(before.config, configFields);
    const info = requestInfo(req);
    if (before.enabled !== after.enabled) {
      audit.record(
        after.enabled ? 'BOT_ENABLED' : 'BOT_DISABLED',
        after.enabled ? '24/7 server bot started' : '24/7 server bot paused',
        info,
      );
    }
    if (Object.keys(changes).length > 0) {
      audit.record('BOT_CONFIG_UPDATE', `Bot config changed: ${Object.keys(changes).join(', ')}`, info, changes);
    }
    res.json(after);
  });

  router.post('/bot/close-all', (req, res) => {
    const count = engine.getServerBotState().positions.length;
    const state = engine.closeAllServerBotPositions();
    audit.record('BOT_CLOSE_ALL', `Closed all bot positions (${count})`, requestInfo(req));
    res.json(state);
  });

  router.post('/bot/close/:id', (req, res) => {
    const body = validated(req, res, parseInput(closePositionSchema, req.body));
    if (!body) return;
    const id = req.params.id;
    if (!positionExists(id)) {
      res.status(404).json({error: 'Position not found', details: [id]});
      return;
    }
    const state = engine.closeServerBotPosition(id, body.fraction);
    audit.record(
      'BOT_CLOSE_POSITION',
      `Closed ${Math.round(body.fraction * 100)}% of position ${id}`,
      requestInfo(req),
    );
    res.json(state);
  });

  router.post('/bot/risk/:id', (req, res) => {
    const body = validated(req, res, parseInput(positionRiskSchema, req.body));
    if (!body) return;
    const id = req.params.id;
    const prev = engine.getServerBotState().positions.find((p) => p.id === id);
    if (!prev) {
      res.status(404).json({error: 'Position not found', details: [id]});
      return;
    }
    const state = engine.updateServerBotPositionRisk(id, body.stopLoss, body.takeProfit);
    audit.record('BOT_POSITION_RISK', `Updated SL/TP of position ${id}`, requestInfo(req), {
      stopLoss: {from: prev.stopLoss ?? null, to: body.stopLoss},
      takeProfit: {from: prev.takeProfit ?? null, to: body.takeProfit},
    });
    res.json(state);
  });

  router.post('/bot/reset', (req, res) => {
    const state = engine.resetServerBotState();
    audit.record('BOT_RESET', 'Bot state reset (positions closed, history cleared)', requestInfo(req));
    res.json(state);
  });

  router.get('/broker/status', (_req, res) => {
    res.json(engine.getBrokerStatus());
  });

  router.post('/broker/sync', async (req, res) => {
    const status = await engine.syncBrokerAccount();
    audit.record('BROKER_SYNC', `Broker account synced (${status.provider})`, requestInfo(req));
    res.json(status);
  });

  router.post('/broker/mode', (req, res) => {
    const body = validated(req, res, parseInput(brokerModeSchema, req.body));
    if (!body) return;
    const before = engine.getBrokerStatus();
    const after = engine.setBrokerRoutingArmed(body.routingArmed);
    const info = requestInfo(req);
    const change = {routingArmed: {from: before.routingArmed, to: after.routingArmed}};
    if (body.routingArmed && !after.routingArmed) {
      audit.record('BROKER_ARM_REFUSED', 'Attempt to arm real broker routing refused: no broker credentials configured', info);
    } else if (before.routingArmed !== after.routingArmed) {
      audit.record(
        after.routingArmed ? 'BROKER_ROUTING_ARMED' : 'BROKER_ROUTING_DISARMED',
        after.routingArmed
          ? `Real broker routing ARMED (${after.provider} · ${after.environment})`
          : 'Real broker routing disarmed (paper mode)',
        info,
        change,
      );
    }
    res.json(after);
  });

  // cTrader OAuth: /connect sends the browser to id.ctrader.com, which redirects back to /callback.
  router.get('/ctrader/connect', (req, res) => {
    const ctrader = engine.getCTraderService?.() ?? null;
    if (!ctrader) {
      res.status(400).type('text/plain').send('cTrader is not configured: set CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET in .env and restart.');
      return;
    }
    audit.record('BROKER_CONNECT_START', 'cTrader OAuth authorization started', requestInfo(req));
    res.redirect(ctrader.createAuthorizeUrl());
  });

  router.get('/ctrader/callback', async (req, res) => {
    const ctrader = engine.getCTraderService?.() ?? null;
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const info = requestInfo(req);
    if (!ctrader || !code || !state) {
      audit.record('BROKER_CONNECT_FAILED', 'cTrader callback without code/state or cTrader not configured', info);
      res.status(400).type('text/plain').send('cTrader authorization failed: missing code or state.');
      return;
    }
    try {
      await ctrader.completeAuthorization(code, state);
      audit.record('BROKER_CONNECTED', `cTrader ${ctrader.config.env} account authorized`, info);
      const status = await engine.syncBrokerAccount();
      res
        .type('text/html')
        .send(
          `<!doctype html><meta charset="utf-8"><title>cTrader connected</title>` +
            `<p>cTrader connected (${escapeHtml(status.accountLabel)}). You can close this tab.</p>` +
            (status.lastError ? `<p>Account sync warning: ${escapeHtml(status.lastError)}</p>` : '') +
            `<p><a href="/">Back to Kestrel</a></p>`,
        );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      audit.record('BROKER_CONNECT_FAILED', `cTrader authorization failed: ${message}`, info);
      res.status(502).type('text/plain').send(`cTrader authorization failed: ${message}`);
    }
  });

  router.get('/candles/:symbol', async (req, res) => {
    const symbol = decodeURIComponent(req.params.symbol);
    const requested = req.query.timeframe as Timeframe;
    const tf = VALID_TIMEFRAMES.includes(requested) ? requested : '15m';
    const candles = await engine.fetchLiveCandles(symbol, tf);
    if (!candles.length) {
      res.status(404).json({error: 'Instrument not found'});
      return;
    }
    res.json({symbol, timeframe: tf, candles});
  });

  router.get('/audit', (req, res) => {
    const limit = Number(req.query.limit) || 100;
    res.json({entries: audit.list(limit)});
  });

  router.get('/stream', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    req.setTimeout(0);
    res.setTimeout(0);
    req.socket?.setTimeout(0);
    req.socket?.setNoDelay?.(true);
    res.flushHeaders?.();

    const initial = JSON.stringify({
      type: 'TICK',
      timestamp: Date.now(),
      instruments: engine.getMarkets(),
    });
    res.write(`retry: 3000\ndata: ${initial}\n\n`);

    engine.addSubscriber(res);
    const heartbeat = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(heartbeat);
        engine.removeSubscriber(res);
        return;
      }
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        engine.removeSubscriber(res);
      }
    }, SSE_HEARTBEAT_MS);

    req.on('close', () => {
      clearInterval(heartbeat);
      engine.removeSubscriber(res);
    });
  });

  router.use((_req, res) => {
    res.status(404).json({error: 'Unknown API endpoint'});
  });

  // Malformed JSON bodies and unexpected handler errors come back as JSON, not an HTML stack trace.
  router.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const isBadJson = err instanceof SyntaxError && 'body' in err;
    if (isBadJson) {
      audit.record('REQUEST_REJECTED', `${req.method} ${req.originalUrl}: malformed JSON body`, requestInfo(req));
      res.status(400).json({error: 'Malformed JSON body', details: []});
      return;
    }
    console.error(`[api] ${req.method} ${req.originalUrl} failed:`, err);
    res.status(500).json({error: 'Internal server error', details: []});
  });

  return router;
}
