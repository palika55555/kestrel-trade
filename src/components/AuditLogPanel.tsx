import React, {useCallback, useEffect, useState} from 'react';
import {History, RefreshCw} from 'lucide-react';

interface AuditChange {
  from: unknown;
  to: unknown;
}

interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  summary: string;
  changes?: Record<string, AuditChange>;
  ip: string | null;
  userAgent: string | null;
}

const REFRESH_INTERVAL_MS = 10_000;
const ENTRY_LIMIT = 100;

const ACTION_TONE: Record<string, string> = {
  BROKER_ROUTING_ARMED: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  BOT_RESET: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  BOT_CLOSE_ALL: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  BROKER_ARM_REFUSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  REQUEST_REJECTED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  BOT_ENABLED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
};
const DEFAULT_TONE = 'bg-slate-500/10 text-slate-600 dark:text-slate-300';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Read-only view of the server audit trail (config changes, broker arming, closes, rejected requests).
export const AuditLogPanel: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audit?limit=${ENTRY_LIMIT}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {entries: AuditEntry[]};
      setEntries(data.entries);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <History className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Audit Log</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Zmeny konfigurácie bota, prepnutia live/paper režimu, zatváranie pozícií a odmietnuté požiadavky.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#242E42] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1A2232] disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Obnoviť
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
          Audit log sa nepodarilo načítať: {error}
        </div>
      )}

      {!error && entries.length === 0 && (
        <div className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">Zatiaľ žiadne záznamy.</div>
      )}

      {entries.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-[#1E2636] max-h-[420px] overflow-y-auto text-xs">
          {entries.map((entry) => (
            <li key={entry.id} className="py-2.5 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-slate-500 dark:text-slate-400">
                  {new Date(entry.timestamp).toLocaleString('sk-SK')}
                </span>
                <span
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold ${
                    ACTION_TONE[entry.action] ?? DEFAULT_TONE
                  }`}
                >
                  {entry.action}
                </span>
                {entry.ip && (
                  <span className="font-mono text-[10px] text-slate-400" title={entry.userAgent ?? undefined}>
                    {entry.ip}
                  </span>
                )}
              </div>
              <div className="text-slate-800 dark:text-slate-200">{entry.summary}</div>
              {entry.changes && (
                <ul className="pl-3 space-y-0.5 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                  {Object.entries(entry.changes).map(([key, change]) => (
                    <li key={key}>
                      {key}: {formatValue(change.from)} → {formatValue(change.to)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
