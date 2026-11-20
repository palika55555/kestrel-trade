import {
  CTRADER_HOSTS,
  EXECUTION_TYPE,
  ORDER_TYPE_MARKET,
  PT,
  TRADE_SIDE,
  describeError,
  isErrorMessage,
  lotsToVolume,
  parseMessage,
  relativeDistance,
  scaleMoney,
  toSymbolSpec,
  type CTraderEnv,
  type CTraderMessage,
  type SymbolSpec,
} from './protocol.ts';

const HEARTBEAT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 10_000;
const ORDER_TIMEOUT_MS = 15_000;

/** The subset of the WHATWG WebSocket the client uses (Node 22 ships it globally). */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (ev: {data?: unknown}) => void): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface CTraderClientOptions {
  env: CTraderEnv;
  clientId: string;
  clientSecret: string;
  /** Preferred ctidTraderAccountId; when null the single account matching env is picked. */
  accountId: number | null;
  symbolName: string;
  /** Returns a valid access token (refreshing if needed). */
  getAccessToken: () => Promise<string>;
  /** Called when the server says the token is no longer valid. */
  onTokenRejected: () => void;
  socketFactory?: SocketFactory;
}

export interface AccountSummary {
  accountId: number;
  traderLogin: number | null;
  balance: number | null;
  equity: number | null;
  unrealizedPnl: number | null;
  marginUsed: number | null;
  openPositions: number;
}

export interface OrderFill {
  positionId: string;
  fillPrice: number | null;
}

type Waiter = {
  match: (msg: CTraderMessage) => 'resolve' | 'reject' | 'skip';
  resolve: (msg: CTraderMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const TOKEN_ERROR_CODES = new Set(['CH_ACCESS_TOKEN_INVALID', 'OA_AUTH_TOKEN_EXPIRED', 'INVALID_REQUEST_TOKEN']);

const defaultSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

// Single long-lived connection: app auth -> account auth -> symbol lookup, then trading requests.
// A dropped connection is re-established lazily by the next request.
export class CTraderClient {
  private opts: CTraderClientOptions;
  private socket: SocketLike | null = null;
  private ready: Promise<void> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private waiters = new Set<Waiter>();
  private msgSeq = 0;
  private accountId: number | null = null;
  private traderLogin: number | null = null;
  private symbol: SymbolSpec | null = null;

  constructor(opts: CTraderClientOptions) {
    this.opts = opts;
  }

  getSymbol(): SymbolSpec | null {
    return this.symbol;
  }

  close(): void {
    this.teardown(new Error('cTrader client closed'));
  }

  async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.connect().catch((err: unknown) => {
        this.teardown(err instanceof Error ? err : new Error(String(err)));
        throw err;
      });
    }
    return this.ready;
  }

  async getAccountSummary(): Promise<AccountSummary> {
    await this.ensureReady();
    const accountId = this.requireAccount();
    const [traderRes, reconcileRes] = await Promise.all([
      this.request(PT.TRADER_REQ, {ctidTraderAccountId: accountId}, PT.TRADER_RES),
      this.request(PT.RECONCILE_REQ, {ctidTraderAccountId: accountId}, PT.RECONCILE_RES),
    ]);
    const trader = (traderRes.payload?.trader ?? {}) as Record<string, unknown>;
    const positions = Array.isArray(reconcileRes.payload?.position)
      ? (reconcileRes.payload.position as Array<Record<string, unknown>>)
      : [];
    const balance = scaleMoney(trader.balance, trader.moneyDigits);
    const marginUsed = positions.reduce<number>((sum, p) => sum + (scaleMoney(p.usedMargin, p.moneyDigits) ?? 0), 0);

    let unrealizedPnl: number | null = positions.length === 0 ? 0 : null;
    if (positions.length > 0) {
      try {
        const pnlRes = await this.request(PT.POSITION_UNREALIZED_PNL_REQ, {ctidTraderAccountId: accountId}, PT.POSITION_UNREALIZED_PNL_RES);
        const list = Array.isArray(pnlRes.payload?.positionUnrealizedPnL)
          ? (pnlRes.payload.positionUnrealizedPnL as Array<Record<string, unknown>>)
          : [];
        unrealizedPnl = Number(
          list.reduce<number>((sum, p) => sum + (scaleMoney(p.netUnrealizedPnL, pnlRes.payload?.moneyDigits) ?? 0), 0).toFixed(2),
        );
      } catch {
        unrealizedPnl = null; // Older servers may not support this request; balance is still useful.
      }
    }
    if (typeof trader.traderLogin === 'number') this.traderLogin = trader.traderLogin;
    return {
      accountId,
      traderLogin: this.traderLogin,
      balance,
      equity: balance !== null && unrealizedPnl !== null ? Number((balance + unrealizedPnl).toFixed(2)) : null,
      unrealizedPnl,
      marginUsed: Number(marginUsed.toFixed(2)),
      openPositions: positions.length,
    };
  }

  async placeMarketOrder(params: {
    side: 'BUY' | 'SELL';
    lots: number;
    stopLoss: number;
    takeProfit: number;
    estimatedPrice: number;
  }): Promise<OrderFill> {
    await this.ensureReady();
    const accountId = this.requireAccount();
    const symbol = this.requireSymbol();
    const volume = lotsToVolume(params.lots, symbol);
    if (volume === null) {
      throw new Error(`Lot size ${params.lots} is below the broker minimum for ${symbol.symbolName}`);
    }
    // Absolute SL/TP are not accepted on MARKET orders; send distances from the expected price instead.
    const relativeStopLoss = relativeDistance(params.estimatedPrice, params.stopLoss);
    const relativeTakeProfit = relativeDistance(params.estimatedPrice, params.takeProfit);
    if (relativeStopLoss === null) throw new Error('Refusing to send an order without a stop loss');

    const clientMsgId = this.nextId();
    let orderId: unknown = null;
    const filled = this.waitFor((msg) => {
      const ownMsg = msg.clientMsgId === clientMsgId;
      if (isErrorMessage(msg)) {
        const sameOrder = orderId !== null && msg.payload?.orderId === orderId;
        return ownMsg || sameOrder ? 'reject' : 'skip';
      }
      if (msg.payloadType !== PT.EXECUTION_EVENT) return 'skip';
      const order = (msg.payload?.order ?? {}) as Record<string, unknown>;
      if (!ownMsg && (orderId === null || order.orderId !== orderId)) return 'skip';
      if (orderId === null && order.orderId !== undefined) orderId = order.orderId;
      const type = msg.payload?.executionType;
      if (type === EXECUTION_TYPE.ORDER_FILLED) return 'resolve';
      if (type === EXECUTION_TYPE.ORDER_REJECTED) return 'reject';
      return 'skip';
    }, ORDER_TIMEOUT_MS);

    this.send({
      clientMsgId,
      payloadType: PT.NEW_ORDER_REQ,
      payload: {
        ctidTraderAccountId: accountId,
        symbolId: symbol.symbolId,
        orderType: ORDER_TYPE_MARKET,
        tradeSide: params.side === 'BUY' ? TRADE_SIDE.BUY : TRADE_SIDE.SELL,
        volume,
        relativeStopLoss,
        ...(relativeTakeProfit !== null ? {relativeTakeProfit} : {}),
        label: 'kestrel-xau-bot',
        comment: 'Kestrel XAU bot',
      },
    });

    const msg = await filled;
    const position = (msg.payload?.position ?? {}) as Record<string, unknown>;
    const deal = (msg.payload?.deal ?? {}) as Record<string, unknown>;
    const positionId = position.positionId ?? deal.positionId;
    if (positionId === undefined) throw new Error('cTrader fill event carried no positionId');
    const price = typeof deal.executionPrice === 'number' ? deal.executionPrice : typeof position.price === 'number' ? position.price : null;
    return {positionId: String(positionId), fillPrice: price};
  }

  /** Closes `fraction` of the position; a full close uses the exact volume the broker reports. */
  async closePosition(positionId: string, fraction: number): Promise<void> {
    await this.ensureReady();
    const accountId = this.requireAccount();
    const symbol = this.requireSymbol();
    const reconcile = await this.request(PT.RECONCILE_REQ, {ctidTraderAccountId: accountId}, PT.RECONCILE_RES);
    const positions = Array.isArray(reconcile.payload?.position) ? (reconcile.payload.position as Array<Record<string, unknown>>) : [];
    const pos = positions.find((p) => String(p.positionId) === positionId);
    if (!pos) throw new Error(`cTrader position ${positionId} not found (already closed?)`);
    const fullVolume = Number(((pos.tradeData ?? {}) as Record<string, unknown>).volume);
    if (!Number.isFinite(fullVolume) || fullVolume <= 0) throw new Error(`cTrader position ${positionId} has no volume`);

    let volume = fullVolume;
    if (fraction < 0.999) {
      const step = symbol.stepVolume > 0 ? symbol.stepVolume : 1;
      volume = Math.floor((fullVolume * fraction) / step + 1e-9) * step;
      if (volume < symbol.minVolume || volume <= 0) throw new Error('Partial close is below the broker minimum volume');
      if (fullVolume - volume < symbol.minVolume) volume = fullVolume;
    }
    await this.request(
      PT.CLOSE_POSITION_REQ,
      {ctidTraderAccountId: accountId, positionId: Number(positionId), volume},
      PT.EXECUTION_EVENT,
      ORDER_TIMEOUT_MS,
    );
  }

  async amendPositionRisk(positionId: string, stopLoss: number | null, takeProfit: number | null): Promise<void> {
    await this.ensureReady();
    const accountId = this.requireAccount();
    const digits = this.requireSymbol().digits;
    const round = (v: number) => Number(v.toFixed(digits));
    await this.request(
      PT.AMEND_POSITION_SLTP_REQ,
      {
        ctidTraderAccountId: accountId,
        positionId: Number(positionId),
        ...(stopLoss !== null ? {stopLoss: round(stopLoss)} : {}),
        ...(takeProfit !== null ? {takeProfit: round(takeProfit)} : {}),
      },
      PT.EXECUTION_EVENT,
    );
  }

  // ---------------------------------------------------------------- connection

  private async connect(): Promise<void> {
    const accessToken = await this.opts.getAccessToken();
    await this.openSocket();
    await this.request(
      PT.APPLICATION_AUTH_REQ,
      {clientId: this.opts.clientId, clientSecret: this.opts.clientSecret},
      PT.APPLICATION_AUTH_RES,
    );
    this.accountId = await this.resolveAccountId(accessToken);
    await this.request(PT.ACCOUNT_AUTH_REQ, {ctidTraderAccountId: this.accountId, accessToken}, PT.ACCOUNT_AUTH_RES);
    this.symbol = await this.loadSymbol(this.accountId);
  }

  private openSocket(): Promise<void> {
    const factory = this.opts.socketFactory ?? defaultSocketFactory;
    const socket = factory(CTRADER_HOSTS[this.opts.env]);
    this.socket = socket;
    return new Promise<void>((resolve, reject) => {
      let opened = false;
      socket.addEventListener('open', () => {
        opened = true;
        this.heartbeat = setInterval(() => this.send({payloadType: PT.HEARTBEAT_EVENT, payload: {}}), HEARTBEAT_MS);
        resolve();
      });
      socket.addEventListener('message', (ev) => this.onMessage(ev.data));
      socket.addEventListener('error', () => {
        if (!opened) reject(new Error('cTrader connection failed'));
      });
      socket.addEventListener('close', () => {
        if (!opened) reject(new Error('cTrader connection closed before open'));
        if (this.socket === socket) this.teardown(new Error('cTrader connection closed'));
      });
    });
  }

  private async resolveAccountId(accessToken: string): Promise<number> {
    const res = await this.request(PT.GET_ACCOUNTS_BY_TOKEN_REQ, {accessToken}, PT.GET_ACCOUNTS_BY_TOKEN_RES);
    const accounts = Array.isArray(res.payload?.ctidTraderAccount)
      ? (res.payload.ctidTraderAccount as Array<Record<string, unknown>>)
      : [];
    const wantLive = this.opts.env === 'live';
    const matching = accounts.filter((a) => Boolean(a.isLive) === wantLive);
    if (this.opts.accountId !== null) {
      // Accept either the internal ctidTraderAccountId or the login number the broker shows to the user.
      const wanted = this.opts.accountId;
      const found = accounts.find(
        (a) => Number(a.ctidTraderAccountId) === wanted || Number(a.traderLogin) === wanted,
      );
      if (!found) throw new Error(`cTrader account ${wanted} is not authorized for this token`);
      if (Boolean(found.isLive) !== wantLive) {
        throw new Error(`cTrader account ${wanted} is ${found.isLive ? 'live' : 'demo'} but CTRADER_ENV=${this.opts.env}`);
      }
      this.traderLogin = typeof found.traderLogin === 'number' ? found.traderLogin : null;
      return Number(found.ctidTraderAccountId);
    }
    if (matching.length !== 1) {
      const ids = matching.map((a) => `${a.ctidTraderAccountId} (login ${a.traderLogin})`).join(', ') || 'none';
      throw new Error(`Set CTRADER_ACCOUNT_ID: ${matching.length} ${this.opts.env} accounts found: ${ids}`);
    }
    this.traderLogin = typeof matching[0].traderLogin === 'number' ? matching[0].traderLogin : null;
    return Number(matching[0].ctidTraderAccountId);
  }

  private async loadSymbol(accountId: number): Promise<SymbolSpec> {
    const wanted = this.opts.symbolName.toUpperCase();
    const list = await this.request(PT.SYMBOLS_LIST_REQ, {ctidTraderAccountId: accountId}, PT.SYMBOLS_LIST_RES);
    const symbols = Array.isArray(list.payload?.symbol) ? (list.payload.symbol as Array<Record<string, unknown>>) : [];
    const light = symbols.find((s) => String(s.symbolName ?? '').toUpperCase() === wanted);
    if (!light) throw new Error(`Symbol ${this.opts.symbolName} not found on this cTrader account`);
    const full = await this.request(
      PT.SYMBOL_BY_ID_REQ,
      {ctidTraderAccountId: accountId, symbolId: [light.symbolId]},
      PT.SYMBOL_BY_ID_RES,
    );
    const raw = Array.isArray(full.payload?.symbol) ? (full.payload.symbol as Array<Record<string, unknown>>)[0] : undefined;
    const spec = raw ? toSymbolSpec({...raw, symbolName: light.symbolName}, this.opts.symbolName) : null;
    if (!spec) throw new Error(`cTrader returned no contract details for ${this.opts.symbolName}`);
    return spec;
  }

  // ---------------------------------------------------------------- messaging

  private onMessage(data: unknown): void {
    const msg = typeof data === 'string' ? parseMessage(data) : null;
    if (!msg) return;
    if (msg.payloadType === PT.ACCOUNTS_TOKEN_INVALIDATED_EVENT || this.isTokenError(msg)) {
      this.opts.onTokenRejected();
    }
    if (msg.payloadType === PT.CLIENT_DISCONNECT_EVENT || msg.payloadType === PT.ACCOUNTS_TOKEN_INVALIDATED_EVENT) {
      this.teardown(new Error(`cTrader disconnected: ${describeError(msg)}`));
      return;
    }
    for (const waiter of [...this.waiters]) {
      const verdict = waiter.match(msg);
      if (verdict === 'skip') continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      if (verdict === 'resolve') waiter.resolve(msg);
      else waiter.reject(new Error(isErrorMessage(msg) ? describeError(msg) : 'cTrader order rejected'));
    }
  }

  private isTokenError(msg: CTraderMessage): boolean {
    return isErrorMessage(msg) && TOKEN_ERROR_CODES.has(String(msg.payload?.errorCode ?? ''));
  }

  private waitFor(match: Waiter['match'], timeoutMs: number): Promise<CTraderMessage> {
    return new Promise<CTraderMessage>((resolve, reject) => {
      const waiter: Waiter = {
        match,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('cTrader request timed out'));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  private request(
    payloadType: number,
    payload: Record<string, unknown>,
    expectType: number,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<CTraderMessage> {
    const clientMsgId = this.nextId();
    const result = this.waitFor((msg) => {
      if (msg.clientMsgId !== clientMsgId) return 'skip';
      if (isErrorMessage(msg)) return 'reject';
      return msg.payloadType === expectType ? 'resolve' : 'skip';
    }, timeoutMs);
    this.send({clientMsgId, payloadType, payload});
    return result;
  }

  private send(msg: CTraderMessage): void {
    if (!this.socket) throw new Error('cTrader socket is not open');
    this.socket.send(JSON.stringify(msg));
  }

  private nextId(): string {
    this.msgSeq += 1;
    return `k${Date.now().toString(36)}-${this.msgSeq}`;
  }

  private requireAccount(): number {
    if (this.accountId === null) throw new Error('cTrader account not authorized');
    return this.accountId;
  }

  private requireSymbol(): SymbolSpec {
    if (!this.symbol) throw new Error('cTrader symbol not loaded');
    return this.symbol;
  }

  private teardown(reason: Error): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const socket = this.socket;
    this.socket = null;
    this.ready = null;
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    this.waiters.clear();
    try {
      socket?.close();
    } catch {
      // Socket already closed; nothing else to release.
    }
  }
}
