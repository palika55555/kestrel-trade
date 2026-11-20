import React, {type Dispatch, type SetStateAction} from 'react';
import {Moon, Sun, Wifi, WifiOff} from 'lucide-react';
import {PWAInstallButton} from '../../components/PWAInstallButton';
import {formatCurrency} from '../../services/tradingMath';

interface AccountStripProps {
  equity: number;
  dailyPnl: number;
  freeMargin: number;
  usedMargin: number;
  marginLevelPct: number;
  isOnline: boolean;
  streamConnected: boolean;
  setSimulatedOffline: Dispatch<SetStateAction<boolean>>;
  isDark: boolean;
  setIsDark: Dispatch<SetStateAction<boolean>>;
}

/** Below-header account telemetry strip with feed status, theme and PWA controls. */
export function AccountStrip({
  equity,
  dailyPnl,
  freeMargin,
  usedMargin,
  marginLevelPct,
  isOnline,
  streamConnected,
  setSimulatedOffline,
  isDark,
  setIsDark,
}: AccountStripProps) {
  return (
    <div className="border-b border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#0E131B]">
      <div className="mx-auto max-w-[1600px] px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4 lg:gap-6 font-mono tabular-nums">
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
              Equity
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">
              {formatCurrency(equity)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
              Day P&L
            </span>
            <span
              className={`font-semibold ${
                dailyPnl >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {dailyPnl >= 0 ? '+' : ''}
              {formatCurrency(dailyPnl)}
            </span>
          </div>
          <div className="hidden sm:block">
            <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
              Free Margin
            </span>
            <span className="text-slate-800 dark:text-slate-200">
              {formatCurrency(freeMargin)}
            </span>
          </div>
          <div className="hidden md:block">
            <span className="text-slate-500 dark:text-slate-400 font-sans mr-1.5">
              Margin Level
            </span>
            <span className="text-slate-800 dark:text-slate-200">
              {usedMargin === 0 ? '∞' : `${marginLevelPct.toFixed(0)}%`}
            </span>
          </div>
        </div>

        {/* Right Workspace Utility Controls */}
        <div className="flex items-center gap-2">
          {/* Real SSE Live Stream / Offline Cache Toggle */}
          <button
            type="button"
            onClick={() => setSimulatedOffline((v) => !v)}
            title="Toggle offline mode to verify cached portfolio access"
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 dark:border-[#242E42] px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#192130] transition-colors whitespace-nowrap cursor-pointer"
          >
            {isOnline && streamConnected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Live Feed</span>
              </>
            ) : isOnline ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-blue-500" />
                <span>Connecting</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-amber-500" />
                <span>Offline Cache</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            aria-label="Toggle Light/Dark theme"
            className="p-1.5 rounded-md border border-slate-200 dark:border-[#242E42] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#192130] transition-colors cursor-pointer"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>

          <PWAInstallButton compact />
        </div>
      </div>
    </div>
  );
}
