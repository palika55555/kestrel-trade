import crypto from 'crypto';
import {CTraderClient, type SocketFactory} from './client.ts';
import {
  CTraderTokenStore,
  buildAuthorizeUrl,
  exchangeCode,
  needsRefresh,
  refreshTokens,
  type CTraderAppCredentials,
  type CTraderTokens,
} from './oauth.ts';
import type {CTraderEnv} from './protocol.ts';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export interface CTraderConfig {
  app: CTraderAppCredentials;
  env: CTraderEnv;
  accountId: number | null;
  symbolName: string;
  envTokens: CTraderTokens | null;
}

export function readCTraderConfig(env: NodeJS.ProcessEnv = process.env): CTraderConfig | null {
  const clientId = (env.CTRADER_CLIENT_ID || '').trim();
  const clientSecret = (env.CTRADER_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;
  const port = Number(env.PORT || 3000);
  const accountRaw = (env.CTRADER_ACCOUNT_ID || '').trim();
  const accountId = accountRaw && Number.isFinite(Number(accountRaw)) ? Number(accountRaw) : null;
  const accessToken = (env.CTRADER_ACCESS_TOKEN || '').trim();
  return {
    app: {
      clientId,
      clientSecret,
      redirectUri: (env.CTRADER_REDIRECT_URI || '').trim() || `http://localhost:${port}/api/ctrader/callback`,
    },
    env: (env.CTRADER_ENV || 'demo').trim().toLowerCase() === 'live' ? 'live' : 'demo',
    accountId,
    symbolName: (env.CTRADER_SYMBOL_XAU || 'XAUUSD').trim(),
    envTokens: accessToken
      ? {accessToken, refreshToken: (env.CTRADER_REFRESH_TOKEN || '').trim(), expiresAt: null}
      : null,
  };
}

// Owns the OAuth tokens and the single CTraderClient for the configured account.
export class CTraderService {
  readonly config: CTraderConfig;
  readonly client: CTraderClient;
  private store: CTraderTokenStore;
  private tokens: CTraderTokens | null;
  private pendingStates = new Map<string, number>();
  private refreshing: Promise<CTraderTokens> | null = null;

  constructor(config: CTraderConfig, store: CTraderTokenStore, socketFactory?: SocketFactory) {
    this.config = config;
    this.store = store;
    // Tokens from a completed OAuth login win over a token pasted into .env.
    this.tokens = store.load() ?? config.envTokens;
    this.client = new CTraderClient({
      env: config.env,
      clientId: config.app.clientId,
      clientSecret: config.app.clientSecret,
      accountId: config.accountId,
      symbolName: config.symbolName,
      getAccessToken: () => this.getAccessToken(),
      onTokenRejected: () => {
        void this.forceRefresh().catch((err: unknown) => {
          console.error('[ctrader] Token refresh after rejection failed:', err instanceof Error ? err.message : err);
        });
      },
      socketFactory,
    });
  }

  isAuthorized(): boolean {
    return Boolean(this.tokens?.accessToken);
  }

  createAuthorizeUrl(now = Date.now()): string {
    for (const [s, exp] of this.pendingStates) if (exp < now) this.pendingStates.delete(s);
    const state = crypto.randomBytes(16).toString('hex');
    this.pendingStates.set(state, now + OAUTH_STATE_TTL_MS);
    return buildAuthorizeUrl(this.config.app, state);
  }

  /** Validates the CSRF state, exchanges the code and persists the tokens. */
  async completeAuthorization(code: string, state: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<void> {
    const expiry = this.pendingStates.get(state);
    this.pendingStates.delete(state);
    if (!expiry || expiry < now) throw new Error('Invalid or expired OAuth state; start the connection again');
    const tokens = await exchangeCode(this.config.app, code, fetchFn);
    this.setTokens(tokens);
    this.client.close(); // Reconnect with the new token on the next request.
  }

  private async getAccessToken(): Promise<string> {
    if (!this.tokens) throw new Error('cTrader not authorized yet: open /api/ctrader/connect');
    if (needsRefresh(this.tokens) && this.tokens.refreshToken) {
      await this.forceRefresh();
    }
    return this.tokens.accessToken;
  }

  private forceRefresh(): Promise<CTraderTokens> {
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) return Promise.reject(new Error('cTrader token expired and no refresh token is available; reconnect'));
    if (!this.refreshing) {
      this.refreshing = refreshTokens(this.config.app, refreshToken)
        .then((tokens) => {
          this.setTokens(tokens);
          return tokens;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  private setTokens(tokens: CTraderTokens): void {
    this.tokens = tokens;
    try {
      this.store.save(tokens);
    } catch (err) {
      console.error('[ctrader] Cannot persist tokens; they will be lost on restart:', err instanceof Error ? err.message : err);
    }
  }
}
