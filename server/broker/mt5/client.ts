import {z} from 'zod';

// HTTP client for the local MT5 Python bridge (bridge/mt5_bridge.py).
// The bridge drives a MetaTrader 5 terminal on this PC through the official MetaTrader5 package,
// so no MetaApi subscription is needed. The terminal must be running and logged in.

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765';
const REQUEST_TIMEOUT_MS = 8000;

export interface Mt5BridgeConfig {
  baseUrl: string;
  secret: string;
  symbol: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const accountSchema = z.object({
  login: z.number(),
  server: z.string(),
  company: z.string().optional().default(''),
  currency: z.string(),
  balance: z.number(),
  equity: z.number(),
  margin: z.number(),
  profit: z.number(),
  openPositions: z.number().int().nonnegative(),
  tradeAllowed: z.boolean(),
  dayPnl: z.number().nullable().optional().default(null),
});
export type Mt5Account = z.infer<typeof accountSchema>;

const openSchema = z.object({
  ticket: z.union([z.number(), z.string()]).transform(String),
  price: z.number(),
  volume: z.number(),
});
export type Mt5Fill = z.infer<typeof openSchema>;

const errorSchema = z.object({error: z.string()});

/** Reads MT5 bridge settings from env; null when the bridge is not configured. */
export function readMt5Config(env: NodeJS.ProcessEnv = process.env): Mt5BridgeConfig | null {
  const secret = (env.MT5_BRIDGE_SECRET || '').trim();
  if (!secret) return null;
  const rawUrl = (env.MT5_BRIDGE_URL || DEFAULT_BRIDGE_URL).trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`MT5_BRIDGE_URL is not a valid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('MT5_BRIDGE_URL must use http or https');
  }
  return {
    baseUrl: rawUrl,
    secret,
    symbol: (env.MT5_SYMBOL_XAU || 'XAUUSD').trim(),
  };
}

export class Mt5BridgeClient {
  readonly config: Mt5BridgeConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: Mt5BridgeConfig, fetchImpl: FetchLike = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async getAccount(): Promise<Mt5Account> {
    return accountSchema.parse(await this.request('GET', '/account'));
  }

  async openMarket(params: {side: 'BUY' | 'SELL'; lots: number; stopLoss: number; takeProfit: number}): Promise<Mt5Fill> {
    return openSchema.parse(
      await this.request('POST', '/orders/open', {
        symbol: this.config.symbol,
        side: params.side,
        lots: params.lots,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
      }),
    );
  }

  async closePosition(ticket: string, fraction: number): Promise<void> {
    await this.request('POST', '/positions/close', {ticket: Number(ticket), fraction});
  }

  async modifyPosition(ticket: string, stopLoss: number | null, takeProfit: number | null): Promise<void> {
    await this.request('POST', '/positions/modify', {ticket: Number(ticket), stopLoss, takeProfit});
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.secret}`,
          ...(body !== undefined ? {'Content-Type': 'application/json'} : {}),
        },
        ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`MT5 bridge unreachable at ${this.config.baseUrl} (is mt5_bridge.py running?): ${reason}`);
    }

    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsedErr = errorSchema.safeParse(payload);
      throw new Error(`MT5 bridge HTTP ${res.status}: ${parsedErr.success ? parsedErr.data.error : 'no details'}`);
    }
    return payload;
  }
}
