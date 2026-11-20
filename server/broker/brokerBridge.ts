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
    openPositionsCount: 0,
    currency: 'USD',
    accountLabel: 'Paper Simulation Ledger',
    lastSyncedAt: null,
    lastOrderSummary: null,
    lastError: null,
  };

  // undefined = not read yet; null = no cTrader credentials in the environment.
  private ctrader: CTraderService | null | undefined;

  constructor(host: BrokerBridgeHost) {
    this.host = host;
  }

  getCTraderService(): CTraderService | null {
    if (this.ctrader === undefined) {
      const config = readCTraderConfig();
      this.ctrader = config ? new CTraderService(config, new CTraderTokenStore(CTRADER_TOKEN_FILE)) : null;
    }
    return this.ctrader;
  }

  private detectBrokerEnv() {
    const oandaToken = (process.env.OANDA_API_TOKEN || '').trim();
    const oandaAccount = (process.env.OANDA_ACCOUNT_ID || '').trim();
    const oandaEnv: 'practice' | 'live' =
      (process.env.OANDA_ENV || 'practice').toLowerCase() === 'live' ? 'live' : 'practice';
    if (oandaToken && oandaAccount) {
      return {
        provider: 'OANDA' as const,
        configured: true as const,
        environment: oandaEnv,
        oandaToken,
        oandaAccount,
        oandaBaseUrl: oandaEnv === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com',
      };
    }

    const metaToken = (process.env.METAAPI_TOKEN || '').trim();
    const metaAccount = (process.env.METAAPI_ACCOUNT_ID || '').trim();
    const metaSymbol = (process.env.METAAPI_SYMBOL_XAU || 'XAUUSD').trim();
    if (metaToken && metaAccount) {
      return {
        provider: 'METAAPI' as const,
        configured: true as const,
        environment: 'live' as const,
        metaToken,
        metaAccount,
        metaSymbol,
        metaBaseUrl: 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai',
      };
    }

    const ctrader = this.getCTraderService();
    if (ctrader) {
      return {
        provider: 'CTRADER' as const,
        // Credentials alone are not enough: the account must be authorized via OAuth (or a pasted token).
        configured: ctrader.isAuthorized(),
        environment: ctrader.config.env === 'live' ? ('live' as const) : ('practice' as const),
        ctrader,
      };
    }

    const webhookUrl = (process.env.BROKER_WEBHOOK_URL || '').trim();
    const webhookSecret = (process.env.BROKER_WEBHOOK_SECRET || '').trim();
    if (webhookUrl) {
      return {
        provider: 'WEBHOOK' as const,
        configured: true as const,
        environment: 'live' as const,
        webhookUrl,
        webhookSecret,
      };
    }

    return {
      provider: 'SIMULATION' as const,
      configured: false as const,
      environment: 'practice' as const,
    };
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
    } else if (env.provider === 'WEBHOOK') {
      accountLabel = 'Custom Broker Webhook Bridge';
    }
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
      openPositionsCount: this.brokerCache.openPositionsCount,
      lastSyncedAt: this.brokerCache.lastSyncedAt,
      lastOrderSummary: this.brokerCache.lastOrderSummary,
      lastError: this.brokerCache.lastError,
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
    return this.getBrokerStatus();
  }

  async syncBrokerAccount(): Promise<BrokerStatus> {
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
      }
    } catch (err) {
      this.brokerCache.lastError = err instanceof Error ? err.message : 'Broker risk update failed';
    }
  }
}
