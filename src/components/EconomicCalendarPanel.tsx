import React, {useMemo, useState} from 'react';
import {AlertTriangle, Calendar, Clock, RefreshCw, ShieldCheck} from 'lucide-react';
import type {EconomicCalendarSnapshot} from '../types/trading';

interface EconomicCalendarPanelProps {
  calendar: EconomicCalendarSnapshot | null;
  newsGuardEnabled: boolean;
  pauseMinutesBefore: number;
  pauseMinutesAfter: number;
  onToggleNewsGuard: () => void;
  onRefresh: () => void;
}

function formatRelativeMinutes(mins: number): string {
  const abs = Math.abs(mins);
  const d = Math.floor(abs / 1440);
  const h = Math.floor((abs % 1440) / 60);
  const m = abs % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (d === 0) parts.push(`${m}m`);
  const label = parts.join(' ');
  if (mins === 0) return 'NOW';
  return mins > 0 ? `in ${label}` : `${label} ago`;
}

export const EconomicCalendarPanel: React.FC<EconomicCalendarPanelProps> = ({
  calendar,
  newsGuardEnabled,
  pauseMinutesBefore,
  pauseMinutesAfter,
  onToggleNewsGuard,
  onRefresh,
}) => {
  const [filterMode, setFilterMode] = useState<'HIGH' | 'USD' | 'ALL'>('HIGH');
  const [nowMs] = useState(() => Date.now());

  const filteredEvents = useMemo(() => {
    const events = calendar?.events ?? [];
    // Show from 4 hours ago onward so recent releases remain visible with past markers
    const windowEvents = events.filter((ev) => ev.timestamp >= nowMs - 4 * 3600_000);
    const base = windowEvents.length > 0 ? windowEvents : events;

    if (filterMode === 'HIGH') {
      return base.filter((e) => e.impact === 'High' || e.impact === 'Medium').slice(0, 40);
    }
    if (filterMode === 'USD') {
      return base.filter((e) => e.country === 'USD').slice(0, 40);
    }
    return base.slice(0, 50);
  }, [calendar, filterMode, nowMs]);

  const nextHighUsd = calendar?.nextHighImpactUsd;
  const activeGuard = calendar?.activeGuardEvent;
  const minsToNext = calendar?.minutesToNextHighUsd;

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
        <div className="flex items-start gap-2.5">
          <Calendar className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Economic Calendar &amp; News Protection Guard
              </h2>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {calendar?.source || 'ForexFactory Live Calendar'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tracks FOMC, CPI, NFP, PPI, and high-impact macro releases. News Guard pauses bot entries {pauseMinutesBefore}m before to {pauseMinutesAfter}m after High-Impact USD/EUR events.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleNewsGuard}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
              newsGuardEnabled
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                : 'border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>News Guard: {newsGuardEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1B2232] cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Active Guard / Next High-Impact USD News Banner */}
      <div
        className={`rounded-lg border p-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
          activeGuard && newsGuardEnabled
            ? 'border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200'
            : 'border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] text-slate-800 dark:text-slate-200'
        }`}
      >
        <div className="flex items-start gap-2.5">
          {activeGuard && newsGuardEnabled ? (
            <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
          ) : (
            <Clock className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          )}
          <div>
            {activeGuard ? (
              <>
                <div className="font-semibold">
                  {newsGuardEnabled
                    ? `NEWS GUARD ACTIVE — Bot Entries Paused (${activeGuard.country} High Impact)`
                    : `High-Impact Window Active (${activeGuard.country}) — Guard Disabled`}
                </div>
                <div className="text-[11px] font-mono mt-0.5">
                  {activeGuard.title} · Forecast {activeGuard.forecast || '--'} · Previous{' '}
                  {activeGuard.previous || '--'}
                </div>
              </>
            ) : nextHighUsd ? (
              <>
                <div className="font-semibold">
                  Next High-Impact USD Event: {nextHighUsd.title}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                  {new Date(nextHighUsd.timestamp).toLocaleString([], {
                    weekday: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · Forecast {nextHighUsd.forecast || '--'} · Prev {nextHighUsd.previous || '--'}
                </div>
              </>
            ) : (
              <div className="font-medium text-slate-500 dark:text-slate-400">
                No upcoming High-Impact USD events remaining in this week&apos;s schedule.
              </div>
            )}
          </div>
        </div>

        {typeof minsToNext === 'number' && (
          <div className="text-right font-mono tabular-nums shrink-0">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Countdown</div>
            <div className="text-sm font-bold">
              {formatRelativeMinutes(minsToNext)}
            </div>
          </div>
        )}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636]">
          {(
            [
              {id: 'HIGH', label: 'High & Medium'},
              {id: 'USD', label: 'USD Only'},
              {id: 'ALL', label: 'All Events'},
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterMode(tab.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                filterMode === tab.id
                  ? 'bg-white dark:bg-[#1B2232] text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {filteredEvents.length} events shown
        </span>
      </div>

      {/* Schedule Table */}
      <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] overflow-hidden">
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-[#0D1119] border-b border-slate-200 dark:border-[#1E2636] text-left text-[11px] text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-2 px-3 font-medium">Time</th>
                <th className="py-2 px-2 font-medium">CCY</th>
                <th className="py-2 px-2 font-medium">Impact</th>
                <th className="py-2 px-2 font-medium">Event</th>
                <th className="py-2 px-2 font-medium text-right">Forecast</th>
                <th className="py-2 px-3 font-medium text-right">Previous</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130]">
              {filteredEvents.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    Loading live economic calendar schedule...
                  </td>
                </tr>
              ) : (
                filteredEvents.map((ev) => {
                  const diffMin = Math.round((ev.timestamp - Date.now()) / 60_000);
                  const isPast = diffMin < -pauseMinutesAfter;
                  const isActiveWindow =
                    ev.impact === 'High' &&
                    (ev.country === 'USD' || ev.country === 'EUR') &&
                    diffMin <= pauseMinutesBefore &&
                    diffMin >= -pauseMinutesAfter;

                  return (
                    <tr
                      key={ev.id}
                      className={`${
                        isActiveWindow
                          ? 'bg-rose-500/10'
                          : isPast
                          ? 'opacity-55'
                          : 'hover:bg-slate-50 dark:hover:bg-[#171E2C]'
                      }`}
                    >
                      <td className="py-2 px-3 font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                        <div>
                          {new Date(ev.timestamp).toLocaleString([], {
                            weekday: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatRelativeMinutes(diffMin)}
                        </div>
                      </td>
                      <td className="py-2 px-2 font-mono font-semibold text-slate-900 dark:text-white">
                        {ev.country}
                      </td>
                      <td className="py-2 px-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded border ${
                            ev.impact === 'High'
                              ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                              : ev.impact === 'Medium'
                              ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              : 'border-slate-300 dark:border-[#263042] text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {ev.impact}
                        </span>
                      </td>
                      <td className="py-2 px-2 font-medium text-slate-800 dark:text-slate-200">
                        {ev.title}
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {ev.forecast || '--'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {ev.previous || '--'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
