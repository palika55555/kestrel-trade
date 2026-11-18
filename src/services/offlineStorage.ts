import type {
  AlertNotification,
  Candle,
  ChartDrawing,
  EODReport,
  Instrument,
  NotificationAutomationConfig,
  PendingOrder,
  Position,
  PriceAlert,
  RiskSettings,
  SecurityState,
  Timeframe,
  TradeExecution,
  XauBotAdaptationEvent,
  XauBotConfig,
  XauBotLogEntry,
  XauBotTradeRecord,
} from '../types/trading';

const DB_NAME = 'KestrelOfflineDB';
const DB_VERSION = 1;
const STORE_KV = 'kv_store';

export interface PersistedWorkspace {
  cashBalance: number;
  dayStartEquity: number;
  positions: Position[];
  pendingOrders: PendingOrder[];
  executions: TradeExecution[];
  priceAlerts: PriceAlert[];
  notifications: AlertNotification[];
  eodReports: EODReport[];
  riskSettings: RiskSettings;
  securityState: SecurityState;
  automationConfig?: NotificationAutomationConfig;
  xauBotConfig?: XauBotConfig;
  xauBotLogs?: XauBotLogEntry[];
  xauBotTrades?: XauBotTradeRecord[];
  xauBotAdaptations?: XauBotAdaptationEvent[];
  drawings: ChartDrawing[];
  cachedInstruments: Instrument[];
  lastSyncedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try {
      localStorage.setItem(`kestrel_${key}`, JSON.stringify(value));
    } catch {
      // Ignore quota errors
    }
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    const res = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const req = tx.objectStore(STORE_KV).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (res !== null) return res;
  } catch {
    // Fallback to localStorage
  }

  try {
    const raw = localStorage.getItem(`kestrel_${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function saveWorkspace(data: PersistedWorkspace): Promise<void> {
  await idbSet('workspace_v2', data);
}

export async function loadWorkspace(): Promise<PersistedWorkspace | null> {
  return idbGet<PersistedWorkspace>('workspace_v2');
}

export async function saveCachedCandles(
  symbol: string,
  timeframe: Timeframe,
  candles: Candle[],
): Promise<void> {
  await idbSet(`candles_${symbol}_${timeframe}`, candles);
}

export async function loadCachedCandles(
  symbol: string,
  timeframe: Timeframe,
): Promise<Candle[] | null> {
  return idbGet<Candle[]>(`candles_${symbol}_${timeframe}`);
}
