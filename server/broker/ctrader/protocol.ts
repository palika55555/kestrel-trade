// cTrader Open API (JSON over WebSocket, port 5036) constants and pure helpers.
// Reference: https://help.ctrader.com/open-api/

export const CTRADER_HOSTS = {
  demo: 'wss://demo.ctraderapi.com:5036',
  live: 'wss://live.ctraderapi.com:5036',
} as const;

export type CTraderEnv = keyof typeof CTRADER_HOSTS;

export const PT = {
  HEARTBEAT_EVENT: 51,
  ERROR_RES: 50,
  APPLICATION_AUTH_REQ: 2100,
  APPLICATION_AUTH_RES: 2101,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  NEW_ORDER_REQ: 2106,
  AMEND_POSITION_SLTP_REQ: 2110,
  CLOSE_POSITION_REQ: 2111,
  SYMBOLS_LIST_REQ: 2114,
  SYMBOLS_LIST_RES: 2115,
  SYMBOL_BY_ID_REQ: 2116,
  SYMBOL_BY_ID_RES: 2117,
  TRADER_REQ: 2121,
  TRADER_RES: 2122,
  RECONCILE_REQ: 2124,
  RECONCILE_RES: 2125,
  EXECUTION_EVENT: 2126,
  ORDER_ERROR_EVENT: 2132,
  OA_ERROR_RES: 2142,
  ACCOUNTS_TOKEN_INVALIDATED_EVENT: 2147,
  CLIENT_DISCONNECT_EVENT: 2148,
  GET_ACCOUNTS_BY_TOKEN_REQ: 2149,
  GET_ACCOUNTS_BY_TOKEN_RES: 2150,
  POSITION_UNREALIZED_PNL_REQ: 2187,
  POSITION_UNREALIZED_PNL_RES: 2188,
} as const;

export const TRADE_SIDE = {BUY: 1, SELL: 2} as const;
export const ORDER_TYPE_MARKET = 1;
export const EXECUTION_TYPE = {ORDER_ACCEPTED: 2, ORDER_FILLED: 3, ORDER_REJECTED: 7} as const;

/** Relative SL/TP distances are sent in 1/100000 of a price unit. */
const RELATIVE_PRICE_SCALE = 100_000;

export interface CTraderMessage {
  clientMsgId?: string;
  payloadType: number;
  payload?: Record<string, unknown>;
}

export interface SymbolSpec {
  symbolId: number;
  symbolName: string;
  digits: number;
  /** All volumes are in 1/100 of a unit, as the API sends them. */
  lotSize: number;
  minVolume: number;
  maxVolume: number;
  stepVolume: number;
}

export function parseMessage(raw: string): CTraderMessage | null {
  try {
    const msg = JSON.parse(raw) as Partial<CTraderMessage>;
    if (typeof msg !== 'object' || msg === null || typeof msg.payloadType !== 'number') return null;
    return {
      clientMsgId: typeof msg.clientMsgId === 'string' ? msg.clientMsgId : undefined,
      payloadType: msg.payloadType,
      payload: msg.payload && typeof msg.payload === 'object' ? msg.payload : {},
    };
  } catch {
    return null;
  }
}

export function isErrorMessage(msg: CTraderMessage): boolean {
  return msg.payloadType === PT.OA_ERROR_RES || msg.payloadType === PT.ERROR_RES || msg.payloadType === PT.ORDER_ERROR_EVENT;
}

export function describeError(msg: CTraderMessage): string {
  const p = msg.payload ?? {};
  const code = typeof p.errorCode === 'string' ? p.errorCode : 'CTRADER_ERROR';
  const desc = typeof p.description === 'string' ? p.description : '';
  return desc ? `${code}: ${desc}` : code;
}

/**
 * Converts the bot's lot size into cTrader volume (1/100 of a unit), snapped down to the
 * symbol's step and clamped to its min/max. Returns null when the result is below minVolume,
 * so the caller refuses the order instead of silently trading a bigger size.
 */
export function lotsToVolume(lots: number, spec: SymbolSpec): number | null {
  if (!Number.isFinite(lots) || lots <= 0) return null;
  const step = spec.stepVolume > 0 ? spec.stepVolume : 1;
  const raw = lots * spec.lotSize;
  const snapped = Math.floor(raw / step + 1e-9) * step;
  if (snapped < spec.minVolume) return null;
  return spec.maxVolume > 0 ? Math.min(snapped, spec.maxVolume) : snapped;
}

export function volumeToLots(volume: number, spec: SymbolSpec): number {
  return spec.lotSize > 0 ? volume / spec.lotSize : 0;
}

/** Distance between entry and a protective price, in the API's 1/100000 price units. */
export function relativeDistance(entry: number, target: number): number | null {
  if (!Number.isFinite(entry) || !Number.isFinite(target)) return null;
  const dist = Math.round(Math.abs(entry - target) * RELATIVE_PRICE_SCALE);
  return dist > 0 ? dist : null;
}

export function scaleMoney(value: unknown, moneyDigits: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(num)) return null;
  const digits = typeof moneyDigits === 'number' && moneyDigits >= 0 ? moneyDigits : 2;
  return Number((num / 10 ** digits).toFixed(2));
}

export function toSymbolSpec(raw: Record<string, unknown>, fallbackName: string): SymbolSpec | null {
  const num = (k: string): number => (typeof raw[k] === 'number' ? (raw[k] as number) : Number(raw[k] ?? NaN));
  const symbolId = num('symbolId');
  const lotSize = num('lotSize');
  if (!Number.isFinite(symbolId) || !Number.isFinite(lotSize) || lotSize <= 0) return null;
  return {
    symbolId,
    symbolName: typeof raw.symbolName === 'string' ? raw.symbolName : fallbackName,
    digits: Number.isFinite(num('digits')) ? num('digits') : 2,
    lotSize,
    minVolume: Number.isFinite(num('minVolume')) ? num('minVolume') : 0,
    maxVolume: Number.isFinite(num('maxVolume')) ? num('maxVolume') : 0,
    stepVolume: Number.isFinite(num('stepVolume')) ? num('stepVolume') : 1,
  };
}
