import fs from 'fs';
import path from 'path';

// OAuth 2 for cTrader Open API: authorize at id.ctrader.com, exchange/refresh at openapi.ctrader.com.
const AUTHORIZE_URL = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const TOKEN_URL = 'https://openapi.ctrader.com/apps/token';
const TOKEN_TIMEOUT_MS = 10_000;
/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 3 * 24 * 60 * 60 * 1000;

export interface CTraderAppCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface CTraderTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms; null when unknown (token pasted manually from the Playground). */
  expiresAt: number | null;
}

type FetchFn = typeof fetch;

export function buildAuthorizeUrl(app: CTraderAppCredentials, state: string): string {
  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: app.redirectUri,
    scope: 'trading',
    product: 'web',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function parseTokenResponse(data: unknown, now = Date.now()): CTraderTokens {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  if (body.errorCode) {
    const desc = typeof body.description === 'string' ? `: ${body.description}` : '';
    throw new Error(`cTrader token error ${String(body.errorCode)}${desc}`);
  }
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
  const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
  if (!accessToken || !refreshToken) throw new Error('cTrader token response missing accessToken/refreshToken');
  const expiresIn = Number(body.expiresIn);
  return {
    accessToken,
    refreshToken,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? now + expiresIn * 1000 : null,
  };
}

// The docs show GET for the code exchange and POST for refresh; try GET, fall back to POST on 405.
async function requestToken(params: URLSearchParams, fetchFn: FetchFn): Promise<CTraderTokens> {
  const url = `${TOKEN_URL}?${params.toString()}`;
  let res = await fetchFn(url, {method: 'GET', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)});
  if (res.status === 405) {
    res = await fetchFn(url, {method: 'POST', headers: {Accept: 'application/json'}, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)});
  }
  if (!res.ok) throw new Error(`cTrader token endpoint HTTP ${res.status}`);
  return parseTokenResponse(await res.json());
}

export function exchangeCode(app: CTraderAppCredentials, code: string, fetchFn: FetchFn = fetch): Promise<CTraderTokens> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: app.redirectUri,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }),
    fetchFn,
  );
}

export function refreshTokens(app: CTraderAppCredentials, refreshToken: string, fetchFn: FetchFn = fetch): Promise<CTraderTokens> {
  return requestToken(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: app.clientId,
      client_secret: app.clientSecret,
    }),
    fetchFn,
  );
}

export function needsRefresh(tokens: CTraderTokens, now = Date.now()): boolean {
  return tokens.expiresAt !== null && tokens.expiresAt - now < REFRESH_MARGIN_MS;
}

// Tokens obtained through OAuth live in the data dir (not in .env) so refreshes survive restarts.
export class CTraderTokenStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  load(): CTraderTokens | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<CTraderTokens>;
      if (typeof raw.accessToken !== 'string' || typeof raw.refreshToken !== 'string') return null;
      return {
        accessToken: raw.accessToken,
        refreshToken: raw.refreshToken,
        expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : null,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[ctrader] Cannot read token file ${this.filePath}:`, err instanceof Error ? err.message : err);
      }
      return null;
    }
  }

  save(tokens: CTraderTokens): void {
    fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tokens), {mode: 0o600});
    fs.renameSync(tmp, this.filePath);
  }
}
