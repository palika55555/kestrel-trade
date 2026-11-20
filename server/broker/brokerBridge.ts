import type {
  BrokerProvider,
  BrokerStatus,
  Candle,
  EconomicCalendarSnapshot,
  EconomicEvent,
  Instrument,
  MarketPrint,
  OrderBookLevel,
  Position,
  ServerBotState,
  Timeframe,
  TradeExecution,
  XauBotConfig,
  XauBotLogEntry,
  XauBotTradeRecord,
} from '../../src/types/trading.ts';
import path from 'path';
import {SERVER_DATA_DIR} from '../config.ts';
import {roundToDecimals} from '../marketUtils.ts';
import {CTraderTokenStore} from './ctrader/oauth.ts';
import {CTraderService, readCTraderConfig} from './ctrader/service.ts';
import {type LiveRiskDecision, type LiveRiskInput, evaluateLiveRisk, readLiveRiskLimits} from './liveRiskGuard.ts';
import {type FetchLike, Mt5BridgeClient, type Mt5Quote, readMt5Config} from './mt5/client.ts';

const CTRADER_TOKEN_FILE = path.join(SERVER_DATA_DIR, 'ctrader-tokens.json');

export interface BrokerBridgeHost {
  isRoutingArmed(): boolean;
  setRoutingArmed(armed: boolean): void;
  persist(): void;
  log(level: XauBotLogEntry['level'], message: string): void;
}

// Routes bot orders to a real broker (OANDA, MetaApi, custom webhook) when armed and configured.
export class BrokerBridge {
  private host: BrokerBridgeHost;
  private brokerCache: {
    balance: number | null;
    equity: number | null;
    unrealizedPnl: number | null;
    marginUsed: number | null;
    dayPnl: number | null;
    openPositionsCount: number;
    currency: string;
    accountLabel: string;
    lastSyncedAt: number | null;
    lastOrderSummary: string | null;
    lastError: string | null;
  } = {
    balance: null,
    equity: null,
    unrealizedPnl: null,
    marginUsed: null,
    dayPnl: null,
    openPositionsCount: 0,
    currency: 'USD',
    accountLabel: 'Paper Simulation Ledger',
    lastSyncedAt: null,
    lastOrderSummary: null,
    lastError: null,
  };

  // undefined = not read yet; null = no cTrader credentials in the environment.
  private ctrader: CTraderService | null | undefined;

  private readonly fetchImpl: FetchLike;

  constructor(host: BrokerBridgeHost, fetchImpl: FetchLike = fetch) {
    this.host = host;
    this.fetchImpl = fetchImpl;
  }

  getCTraderService(): CTraderService | null {
    if (this.ctrader === undefined) {
      const config = readCTraderConfig();
      this.ctrader = config ? new CTraderService(config, new CTraderTokenStore(CTRADER_TOKEN_FILE)) : null;
    }
    return this.ctrader;
  }

  private detectOanda() {
    const oandaToken = (process.env.OANDA_API_TOKEN || '').trim();
    const oandaAccount = (process.env.OANDA_ACCOUNT_ID || '').trim();
    if (!oandaToken || !oandaAccount) return null;
    const oandaEnv: 'practice' | 'live' =
      (process.env.OANDA_ENV || 'practice').toLowerCase() === 'live' ? 'live' : 'practice';
    return {
      provider: 'OANDA' as const,
      configured: true as const,
      environment: oandaEnv,
      oandaToken,
      oandaAccount,
      oandaBaseUrl: oandaEnv === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com',
    };
  }

  private detectMetaApi() {
    const metaToken = (process.env.METAAPI_TOKEN || '').trim();
    const metaAccount = (process.env.METAAPI_ACCOUNT_ID || '').trim();
    if (!metaToken || !metaAccount) return null;
    return {
      provider: 'METAAPI' as const,
      configured: true as const,
      environment: 'live' as const,
      metaToken,
      metaAccount,
      metaSymbol: (process.env.METAAPI_SYMBOL_XAU || 'XAUUSD').trim(),
      metaBaseUrl: 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai',
    };
  }

  private detectCTrader() {
    const ctrader = this.getCTraderService();
    if (!ctrader) return null;
    return {
      provider: 'CTRADER' as const,
      // Credentials alone are not enough: the account must be authorized via OAuth (or a pasted token).
      configured: ctrader.isAuthorized(),
      environment: ctrader.config.env === 'live' ? ('live' as const) : ('practice' as const),
      ctrader,
    };
  }

  private detectMt5() {
    const config = readMt5Config();
    if (!config) return null;
    return {
      provider: 'MT5' as const,
      configured: true as const,
      environment: 'live' as const,
      mt5: new Mt5BridgeClient(config, this.fetchImpl),
    };
  }

  private detectWebhook() {
    const webhookUrl = (process.env.BROKER_WEBHOOK_URL || '').trim();
    if (!webhookUrl) return null;
    return {
      provider: 'WEBHOOK' as const,
      configured: true as const,
      environment: 'live' as const,
      webhookUrl,
      webhookSecret: (process.env.BROKER_WEBHOOK_SECRET || '').trim(),
    };
  }

  // BROKER_PROVIDER picks exactly one broker. When it is unset the first configured one wins,
  // in the order OANDA, MetaApi, cTrader, MT5 bridge, webhook.
  private detectBrokerEnv() {
    const simulation = (selectionError: string | null = null) => ({
      provider: 'SIMULATION' as const,
      configured: false as const,
      environment: 'practice' as const,
      selectionError,
    });
    const detectors = {
      OANDA: () => this.detectOanda(),
      METAAPI: () => this.detectMetaApi(),
      CTRADER: () => this.detectCTrader(),
      MT5: () => this.detectMt5(),
      WEBHOOK: () => this.detectWebhook(),
    };

    try {
      const selected = (process.env.BROKER_PROVIDER || '').trim().toUpperCase();
      if (selected === 'SIMULATION') return simulation();
      if (selected) {
        if (!Object.hasOwn(detectors, selected)) {
          return simulation(
            `BROKER_PROVIDER="${selected}" is not supported (use ${Object.keys(detectors).join(', ')} or SIMULATION).`,
          );
        }
        const env = detectors[selected as keyof typeof detectors]();
        return env ?? simulation(`BROKER_PROVIDER=${selected} is selected but its credentials are missing in .env.`);
      }
      for (const detect of Object.values(detectors)) {
        const env = detect();
        if (env) return env;
      }
      return simulation();
    } catch (err) {
      return simulation(err instanceof Error ? err.message : 'Invalid broker configuration');
    }
  }

  shouldRouteRealBroker(): boolean {
    const env = this.detectBrokerEnv();
    return Boolean(this.host.isRoutingArmed() && env.configured);
  }

  getBrokerStatus(): BrokerStatus {
    const env = this.detectBrokerEnv();
    const routingArmed = Boolean(this.host.isRoutingArmed() && env.configured);
    let accountLabel = 'Paper Simulation Ledger';
    if (env.provider === 'OANDA') {
      accountLabel = `OANDA ${env.environment.toUpperCase()} (${env.oandaAccount.slice(0, 6)}...)`;
    } else if (env.provider === 'METAAPI') {
      accountLabel = `MetaApi MT4/MT5 (${env.metaAccount.slice(0, 8)}...)`;
    } else if (env.provider === 'CTRADER') {
      accountLabel = env.configured
        ? `cTrader ${env.ctrader.config.env.toUpperCase()} (${env.ctrader.config.symbolName})`
        : 'cTrader: not connected (open /api/ctrader/connect)';
    } else if (env.provider === 'MT5') {
      accountLabel = `MT5 Local Bridge (${env.mt5.config.symbol})`;
    } else if (env.provider === 'WEBHOOK') {
      accountLabel = 'Custom Broker Webhook Bridge';
    }
    const selectionError = env.provider === 'SIMULATION' ? env.selectionError : null;
    return {
      provider: env.provider,
      configured: env.configured,
      environment: env.environment,
      routingArmed,
      accountLabel: this.brokerCache.lastSyncedAt ? this.brokerCache.accountLabel : accountLabel,
      currency: this.brokerCache.currency,
      balance: this.brokerCache.balance,
      equity: this.brokerCache.equity,
      unrealizedPnl: this.brokerCache.unrealizedPnl,
      marginUsed: this.brokerCache.marginUsed,
      dayPnl: this.brokerCache.dayPnl,
      openPositionsCount: this.brokerCache.openPositionsCount,
      lastSyncedAt: this.brokerCache.lastSyncedAt,
      lastOrderSummary: this.brokerCache.lastOrderSummary,
      lastError: this.brokerCache.lastError ?? selectionError,
    };
  }

  setBrokerRoutingArmed(armed: boolean): BrokerStatus {
    const env = this.detectBrokerEnv();
    if (armed && !env.configured) {
      this.brokerCache.lastError = 'No broker credentials set in server environment variables.';
      this.host.setRoutingArmed(false);
      this.host.persist();
      return this.getBrokerStatus();
    }
    this.host.setRoutingArmed(armed);
    this.brokerCache.lastError = null;
    this.host.log(
      armed ? 'RISK' : 'INFO',
      armed
        ? `Real Broker Routing ARMED (${env.provider} · ${env.environment.toUpperCase()}).`
        : 'Real Broker Routing DISARMED (Paper Simulation active).',
    );
    this.host.persist();
    if (armed) void this.refreshIfRouting();
    return this.getBrokerStatus();
  }

  private syncInFlight = false;
  private mt5FeedBackoffUntil = 0;

  isMt5Configured(): boolean {
    const env = this.detectBrokerEnv();
    return env.provider === 'MT5' && env.configured;
  }

  /** Fetches the latest XAU quote from the local MT5 terminal; returns null with short backoff if offline. */
  async fetchMt5Quote(): Promise<Mt5Quote | null> {
    if (Date.now() < this.mt5FeedBackoffUntil) return null;
    const env = this.detectBrokerEnv();
    if (env.provider !== 'MT5' || !env.configured) return null;
    try {
      const q = await env.mt5.getQuote();
      this.mt5FeedBackoffUntil = 0;
      return q;
    } catch {
      this.mt5FeedBackoffUntil = Date.now() + 8000;
      return null;
    }
  }

  /** Fetches OHLCV candles from the local MT5 terminal; returns null with short backoff if offline. */
  async fetchMt5Candles(timeframe: Timeframe, count = 220): Promise<Candle[] | null> {
    if (Date.now() < this.mt5FeedBackoffUntil) return null;
    const env = this.detectBrokerEnv();
    if (env.provider !== 'MT5' || !env.configured) return null;
    try {
      const candles = await env.mt5.getCandles(timeframe, count);
      if (candles.length > 0) {
        this.mt5FeedBackoffUntil = 0;
        return candles;
      }
      return null;
    } catch {
      this.mt5FeedBackoffUntil = Date.now() + 8000;
      return null;
    }
  }

  /** Keeps the cached broker account fresh while live routing is armed. Never overlaps itself. */
  async refreshIfRouting(): Promise<void> {
    if (this.syncInFlight || !this.shouldRouteRealBroker()) return;
    this.syncInFlight = true;
    try {
      await this.syncBrokerAccount();
    } finally {
      this.syncInFlight = false;
    }
  }

  /** Checks one planned order against the LIVE_* risk limits using the latest broker account data. */
  evaluateLiveOrder(order: Pick<LiveRiskInput, 'lot' | 'stopLossDistance' | 'contractSize' | 'openRisk' | 'openPositions'>): LiveRiskDecision {
    try {
      return evaluateLiveRisk(readLiveRiskLimits(), {
        ...order,
        equity: this.brokerCache.equity,
        dayPnl: this.brokerCache.dayPnl,
      });
    } catch (err) {
      return {allowed: false, reason: err instanceof Error ? err.message : 'Invalid live risk limits'};
    }
  }

  /** Equity of the real broker account for position sizing; null when not routing live. */
  getRoutedEquity(): number | null {
    if (!this.shouldRouteRealBroker()) return null;
    return this.brokerCache.equity;
  }

  async syncBrokerAccount(): Promise<BrokerStatus> {
    this.mt5FeedBackoffUntil = 0;
    const env = this.detectBrokerEnv();
    if (!env.configured) {
      this.brokerCache.lastError = null;
      return this.getBrokerStatus();
    }

    try {
      if (env.provider === 'OANDA') {
        const res = await fetch(`${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/summary`, {
          headers: {Authorization: `Bearer ${env.oandaToken}`},
          signal: AbortSignal.timeout(6500),
        });
        if (!res.ok) {
          throw new Error(`OANDA HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          account?: {
            id?: string;
            alias?: string;
            currency?: string;
            balance?: string;
            NAV?: string;
            unrealizedPL?: string;
            marginUsed?: string;
            openTradeCount?: number;
          };
        };
        const acc = data.account;
        if (acc) {
          this.brokerCache = {
            ...this.brokerCache,
            accountLabel: acc.alias ? `OANDA: ${acc.alias}` : `OANDA ${env.environment.toUpperCase()}`,
            currency: acc.currency || 'USD',
            balance: acc.balance ? Number(parseFloat(acc.balance).toFixed(2)) : null,
            equity: acc.NAV ? Number(parseFloat(acc.NAV).toFixed(2)) : null,
            unrealizedPnl: acc.unrealizedPL ? Number(parseFloat(acc.unrealizedPL).toFixed(2)) : null,
            marginUsed: acc.marginUsed ? Number(parseFloat(acc.marginUsed).toFixed(2)) : null,
            openPositionsCount: Number(acc.openTradeCount || 0),
            lastSyncedAt: Date.now(),
            lastError: null,
          };
        }
      } else if (env.provider === 'METAAPI') {
        const [infoRes, posRes] = await Promise.all([
          fetch(`${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/account-information`, {
            headers: {'auth-token': env.metaToken},
            signal: AbortSignal.timeout(6500),
          }),
          fetch(`${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/positions`, {
            headers: {'auth-token': env.metaToken},
            signal: AbortSignal.timeout(6500),
          }),
        ]);
        if (!infoRes.ok) throw new Error(`MetaApi HTTP ${infoRes.status}`);
        const info = (await infoRes.json()) as {
          broker?: string;
          server?: string;
          currency?: string;
          balance?: number;
          equity?: number;
          margin?: number;
        };
        const posList = posRes.ok ? ((await posRes.json()) as unknown[]) : [];
        const balance = typeof info.balance === 'number' ? Number(info.balance.toFixed(2)) : null;
        const equity = typeof info.equity === 'number' ? Number(info.equity.toFixed(2)) : null;
        this.brokerCache = {
          ...this.brokerCache,
          accountLabel: `${info.broker || 'MT4/MT5'} (${info.server || 'MetaApi'})`,
          currency: info.currency || 'USD',
          balance,
          equity,
          unrealizedPnl: balance !== null && equity !== null ? Number((equity - balance).toFixed(2)) : null,
          marginUsed: typeof info.margin === 'number' ? Number(info.margin.toFixed(2)) : null,
          openPositionsCount: Array.isArray(posList) ? posList.length : 0,
          lastSyncedAt: Date.now(),
          lastError: null,
        };
      } else if (env.provider === 'CTRADER') {
        const summary = await env.ctrader.client.getAccountSummary();
        this.brokerCache = {
          ...this.brokerCache,
          accountLabel: `cTrader ${env.ctrader.config.env.toUpperCase()} #${summary.traderLogin ?? summary.accountId}`,
          balance: summary.balance,
          equity: summary.equity,
          unrealizedPnl: summary.unrealizedPnl,
          marginUsed: summary.marginUsed,
          openPositionsCount: summary.openPositions,
          lastSyncedAt: Date.now(),
          lastError: null,
        };
      } else if (env.provider === 'MT5') {
        const acc = await env.mt5.getAccount();
        this.brokerCache = {
          ...this.brokerCache,
          accountLabel: `${acc.company || 'MT5'} #${acc.login} (${acc.server})`,
          currency: acc.currency,
          balance: roundToDecimals(acc.balance, 2),
          equity: roundToDecimals(acc.equity, 2),
          unrealizedPnl: roundToDecimals(acc.profit, 2),
          marginUsed: roundToDecimals(acc.margin, 2),
          dayPnl: acc.dayPnl,
          openPositionsCount: acc.openPositions,
          lastSyncedAt: Date.now(),
          lastError: acc.tradeAllowed ? null : 'MT5 terminal: Algo Trading is disabled, orders will be rejected.',
        };
      } else if (env.provider === 'WEBHOOK') {
        this.brokerCache.lastSyncedAt = Date.now();
        this.brokerCache.lastError = null;
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker sync failed';
    }
    return this.getBrokerStatus();
  }

  async routeBrokerOpenOrder(params: {
    side: 'BUY' | 'SELL';
    lotSize: number;
    stopLoss: number;
    takeProfit: number;
    estimatedPrice: number;
  }): Promise<{ok: boolean; provider: BrokerProvider; brokerTradeId?: string; fillPrice?: number; error?: string}> {
    const env = this.detectBrokerEnv();
    if (!env.configured) return {ok: false, provider: 'SIMULATION', error: 'No broker configured'};

    try {
      if (env.provider === 'OANDA') {
        const unitsNum = Math.max(1, Math.round(params.lotSize * 100));
        const units = params.side === 'BUY' ? String(unitsNum) : String(-unitsNum);
        const res = await fetch(`${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/orders`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.oandaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            order: {
              type: 'MARKET',
              instrument: 'XAU_USD',
              units,
              timeInForce: 'FOK',
              positionFill: 'DEFAULT',
              stopLossOnFill: {price: params.stopLoss.toFixed(2)},
              takeProfitOnFill: {price: params.takeProfit.toFixed(2)},
            },
          }),
          signal: AbortSignal.timeout(7000),
        });
        const data = (await res.json()) as {
          orderFillTransaction?: {id?: string; price?: string; tradeOpened?: {tradeID?: string}};
          orderCancelTransaction?: {reason?: string};
          errorMessage?: string;
        };
        if (!res.ok || data.orderCancelTransaction) {
          const msg = data.orderCancelTransaction?.reason || data.errorMessage || `OANDA HTTP ${res.status}`;
          this.brokerCache.lastError = msg;
          return {ok: false, provider: 'OANDA', error: msg};
        }
        const tradeId = data.orderFillTransaction?.tradeOpened?.tradeID || data.orderFillTransaction?.id;
        const fillPrice = data.orderFillTransaction?.price ? parseFloat(data.orderFillTransaction.price) : params.estimatedPrice;
        this.brokerCache.lastOrderSummary = `OANDA ${params.side} ${params.lotSize} XAU_USD @ ${fillPrice.toFixed(2)}`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'OANDA', brokerTradeId: tradeId, fillPrice};
      }

      if (env.provider === 'METAAPI') {
        const res = await fetch(
          `${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/trade`,
          {
            method: 'POST',
            headers: {
              'auth-token': env.metaToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              actionType: params.side === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
              symbol: env.metaSymbol,
              volume: params.lotSize,
              stopLoss: params.stopLoss,
              takeProfit: params.takeProfit,
              comment: 'Kestrel 24/7 XAU Bot',
            }),
            signal: AbortSignal.timeout(8000),
          },
        );
        const data = (await res.json()) as {positionId?: string; orderId?: string; stringCode?: string; message?: string};
        if (!res.ok) {
          const msg = data.message || data.stringCode || `MetaApi HTTP ${res.status}`;
          this.brokerCache.lastError = msg;
          return {ok: false, provider: 'METAAPI', error: msg};
        }
        const brokerTradeId = data.positionId || data.orderId;
        this.brokerCache.lastOrderSummary = `MT4/MT5 ${params.side} ${params.lotSize} ${env.metaSymbol}`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'METAAPI', brokerTradeId, fillPrice: params.estimatedPrice};
      }

      if (env.provider === 'CTRADER') {
        const fill = await env.ctrader.client.placeMarketOrder({
          side: params.side,
          lots: params.lotSize,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
          estimatedPrice: params.estimatedPrice,
        });
        const fillPrice = fill.fillPrice ?? params.estimatedPrice;
        this.brokerCache.lastOrderSummary = `cTrader ${params.side} ${params.lotSize} ${env.ctrader.config.symbolName} @ ${fillPrice.toFixed(2)}`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'CTRADER', brokerTradeId: fill.positionId, fillPrice};
      }

      if (env.provider === 'MT5') {
        const fill = await env.mt5.openMarket({
          side: params.side,
          lots: params.lotSize,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
        });
        this.brokerCache.lastOrderSummary = `MT5 ${params.side} ${fill.volume} ${env.mt5.config.symbol} @ ${fill.price.toFixed(2)} (#${fill.ticket})`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'MT5', brokerTradeId: fill.ticket, fillPrice: fill.price};
      }

      if (env.provider === 'WEBHOOK') {
        const res = await fetch(env.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.webhookSecret ? {Authorization: `Bearer ${env.webhookSecret}`} : {}),
          },
          body: JSON.stringify({
            event: 'OPEN',
            symbol: 'XAU/USD',
            side: params.side,
            lotSize: params.lotSize,
            stopLoss: params.stopLoss,
            takeProfit: params.takeProfit,
            timestamp: Date.now(),
          }),
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) {
          const msg = `Webhook HTTP ${res.status}`;
          this.brokerCache.lastError = msg;
          return {ok: false, provider: 'WEBHOOK', error: msg};
        }
        const whId = `wh-${Date.now()}`;
        this.brokerCache.lastOrderSummary = `Webhook ${params.side} ${params.lotSize} XAU/USD`;
        this.brokerCache.lastError = null;
        return {ok: true, provider: 'WEBHOOK', brokerTradeId: whId, fillPrice: params.estimatedPrice};
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Broker request failed';
      this.brokerCache.lastError = msg;
      return {ok: false, provider: env.provider, error: msg};
    }

    return {ok: false, provider: 'SIMULATION', error: 'Unsupported provider'};
  }

  async routeBrokerCloseOrder(pos: Position, fraction = 1) {
    if (!pos.brokerOrderId || !this.shouldRouteRealBroker()) return;
    const env = this.detectBrokerEnv();
    try {
      if (env.provider === 'OANDA') {
        const units =
          fraction >= 0.999 ? 'ALL' : String(Math.max(1, Math.round(pos.quantity * fraction * 100)));
        await fetch(
          `${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/trades/${encodeURIComponent(pos.brokerOrderId)}/close`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${env.oandaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({units}),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'METAAPI') {
        const vol = roundToDecimals(pos.quantity * fraction, 2);
        await fetch(
          `${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/trade`,
          {
            method: 'POST',
            headers: {
              'auth-token': env.metaToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(
              fraction >= 0.999
                ? {actionType: 'POSITION_CLOSE_ID', positionId: pos.brokerOrderId}
                : {actionType: 'POSITION_PARTIAL', positionId: pos.brokerOrderId, volume: vol},
            ),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'CTRADER') {
        await env.ctrader.client.closePosition(pos.brokerOrderId, fraction);
      } else if (env.provider === 'MT5') {
        await env.mt5.closePosition(pos.brokerOrderId, fraction);
      } else if (env.provider === 'WEBHOOK') {
        await fetch(env.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(env.webhookSecret ? {Authorization: `Bearer ${env.webhookSecret}`} : {}),
          },
          body: JSON.stringify({
            event: fraction >= 0.999 ? 'CLOSE' : 'PARTIAL_CLOSE',
            brokerOrderId: pos.brokerOrderId,
            symbol: pos.symbol,
            side: pos.side,
            fraction,
            timestamp: Date.now(),
          }),
          signal: AbortSignal.timeout(6000),
        });
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker close sync failed';
    }
  }

  async routeBrokerModifyRisk(pos: Position, stopLoss: number | null, takeProfit: number | null) {
    if (!pos.brokerOrderId || !this.shouldRouteRealBroker()) return;
    const env = this.detectBrokerEnv();
    try {
      if (env.provider === 'OANDA') {
        await fetch(
          `${env.oandaBaseUrl}/v3/accounts/${encodeURIComponent(env.oandaAccount)}/trades/${encodeURIComponent(pos.brokerOrderId)}/orders`,
          {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${env.oandaToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(stopLoss !== null ? {stopLoss: {price: stopLoss.toFixed(2)}} : {}),
              ...(takeProfit !== null ? {takeProfit: {price: takeProfit.toFixed(2)}} : {}),
            }),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'METAAPI') {
        await fetch(
          `${env.metaBaseUrl}/users/current/accounts/${encodeURIComponent(env.metaAccount)}/trade`,
          {
            method: 'POST',
            headers: {
              'auth-token': env.metaToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              actionType: 'POSITION_MODIFY',
              positionId: pos.brokerOrderId,
              ...(stopLoss !== null ? {stopLoss} : {}),
              ...(takeProfit !== null ? {takeProfit} : {}),
            }),
            signal: AbortSignal.timeout(6500),
          },
        );
      } else if (env.provider === 'CTRADER') {
        await env.ctrader.client.amendPositionRisk(pos.brokerOrderId, stopLoss, takeProfit);
      } else if (env.provider === 'MT5') {
        await env.mt5.modifyPosition(pos.brokerOrderId, stopLoss, takeProfit);
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker risk update failed';
    }
  }
}
