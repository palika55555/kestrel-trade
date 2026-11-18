import React, {useMemo} from 'react';
import {Database, Shield, Wifi, WifiOff} from 'lucide-react';
import {
  computePositionNotional,
  computeUnrealizedPnl,
  formatCurrency,
  formatPrice,
} from '../services/tradingMath';
import type {Instrument, Position, RiskSettings} from '../types/trading';

interface PortfolioViewProps {
  cashBalance: number;
  dayStartEquity: number;
  equity: number;
  usedMargin: number;
  freeMargin: number;
  marginLevelPct: number;
  unrealizedPnl: number;
  positions: Position[];
  instrumentsMap: Map<string, Instrument>;
  riskSettings: RiskSettings;
  onUpdateRiskSettings: (next: RiskSettings) => void;
  lastSyncedAt: number;
  isOnline: boolean;
  onSelectSymbolAndTrade: (symbol: string) => void;
}

const CLASS_COLORS: Record<string, string> = {
  FUTURES: '#3B82F6',
  COMMODITY_FUTURES: '#F59E0B',
  FX_CFD: '#10B981',
  INDEX_CFD: '#8B5CF6',
  CRYPTO_CFD: '#EC4899',
};

const CLASS_LABELS: Record<string, string> = {
  FUTURES: 'Equity Futures',
  COMMODITY_FUTURES: 'Commodity Futures',
  FX_CFD: 'FX CFDs',
  INDEX_CFD: 'Index CFDs',
  CRYPTO_CFD: 'Crypto CFDs',
};

export const PortfolioView: React.FC<PortfolioViewProps> = ({
  cashBalance,
  dayStartEquity,
  equity,
  usedMargin,
  freeMargin,
  marginLevelPct,
  unrealizedPnl,
  positions,
  instrumentsMap,
  riskSettings,
  onUpdateRiskSettings,
  lastSyncedAt,
  isOnline,
  onSelectSymbolAndTrade,
}) => {
  const dailyPnl = equity - dayStartEquity;
  const dailyPnlPct = dayStartEquity > 0 ? (dailyPnl / dayStartEquity) * 100 : 0;
  const dailyDrawdownPct = dailyPnl < 0 ? Math.abs(dailyPnlPct) : 0;
  const drawdownRatio = Math.min(
    100,
    (dailyDrawdownPct / Math.max(0.1, riskSettings.maxDailyDrawdownPct)) * 100,
  );

  // Asset class allocation by notional & margin
  const allocation = useMemo(() => {
    const map = new Map<string, {margin: number; notional: number; pnl: number}>();
    let totalMargin = 0;
    positions.forEach((pos) => {
      const inst = instrumentsMap.get(pos.symbol);
      const cls = inst?.assetClass || 'FUTURES';
      const notional = inst
        ? computePositionNotional(inst.price, pos.quantity, inst)
        : pos.marginUsed * pos.leverage;
      const pnl = inst ? computeUnrealizedPnl(pos, inst) : 0;
      const cur = map.get(cls) || {margin: 0, notional: 0, pnl: 0};
      cur.margin += pos.marginUsed;
      cur.notional += notional;
      cur.pnl += pnl;
      totalMargin += pos.marginUsed;
      map.set(cls, cur);
    });

    return Array.from(map.entries()).map(([cls, stats]) => ({
      cls,
      label: CLASS_LABELS[cls] || cls,
      color: CLASS_COLORS[cls] || '#64748B',
      margin: stats.margin,
      notional: stats.notional,
      pnl: stats.pnl,
      pct: totalMargin > 0 ? (stats.margin / totalMargin) * 100 : 0,
    }));
  }, [positions, instrumentsMap]);

  const marginStatusLabel =
    usedMargin === 0
      ? 'Unleveraged'
      : marginLevelPct <= riskSettings.stopOutLevelPct
      ? 'Stop-Out Risk'
      : marginLevelPct <= riskSettings.marginCallLevelPct
      ? 'Margin Call Warning'
      : 'Healthy';

  return (
    <div className="space-y-5">
      {/* Top 4-column Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <SummaryMetric
          label="Net Liquidation Equity"
          value={formatCurrency(equity)}
          sub={`${dailyPnl >= 0 ? '+' : ''}${formatCurrency(dailyPnl)} (${
            dailyPnlPct >= 0 ? '+' : ''
          }${dailyPnlPct.toFixed(2)}%) today`}
          positive={dailyPnl >= 0}
        />
        <SummaryMetric
          label="Cash Balance"
          value={formatCurrency(cashBalance)}
          sub={`Unrealized: ${unrealizedPnl >= 0 ? '+' : ''}${formatCurrency(unrealizedPnl)}`}
          positive={unrealizedPnl >= 0}
        />
        <SummaryMetric
          label="Margin Utilization"
          value={formatCurrency(usedMargin)}
          sub={`Free Margin: ${formatCurrency(freeMargin)}`}
        />
        <SummaryMetric
          label="Margin Level"
          value={usedMargin === 0 ? '∞' : `${marginLevelPct.toFixed(0)}%`}
          sub={`${marginStatusLabel} · Call @ ${riskSettings.marginCallLevelPct}%`}
          positive={usedMargin === 0 || marginLevelPct > riskSettings.marginCallLevelPct}
        />
      </div>

      {/* Allocation + Risk Guardrails Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Multi-Asset Exposure Breakdown */}
        <div className="lg:col-span-7 bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Multi-Asset Allocation
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Active margin and notional exposure across Futures and CFD classes
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {positions.length} active positions
            </span>
          </div>

          {allocation.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400">
              100% Cash Allocation — No open leveraged positions.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              {/* SVG Donut */}
              <div className="sm:col-span-4 flex justify-center">
                <AllocationDonut slices={allocation} totalMargin={usedMargin} />
              </div>

              {/* Class Table */}
              <div className="sm:col-span-8 divide-y divide-slate-100 dark:divide-[#1A2130]">
                {allocation.map((item) => (
                  <div
                    key={item.cls}
                    className="py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{backgroundColor: item.color}}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                          {item.label}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          Notional {formatCurrency(item.notional, true)}
                        </div>
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-slate-900 dark:text-slate-100 font-medium">
                        {formatCurrency(item.margin)} ({item.pct.toFixed(1)}%)
                      </div>
                      <div
                        className={`text-[11px] ${
                          item.pnl >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {item.pnl >= 0 ? '+' : ''}
                        {formatCurrency(item.pnl)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Account Risk Guardrails & Offline Sync */}
        <div className="lg:col-span-5 bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Risk Guardrails
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Auto-enforced
            </span>
          </div>

          {/* Daily Drawdown Gauge */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-600 dark:text-slate-300">
                Daily Drawdown Limit ({riskSettings.maxDailyDrawdownPct}%)
              </span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {dailyDrawdownPct.toFixed(2)}% used
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 dark:bg-[#0D1119] overflow-hidden">
              <div
                className={`h-full transition-all ${
                  drawdownRatio >= 80
                    ? 'bg-rose-500'
                    : drawdownRatio >= 50
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{width: `${Math.max(4, drawdownRatio)}%`}}
              />
            </div>
          </div>

          {/* Editable Risk Parameters */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Max Daily Loss (%)
              </label>
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={riskSettings.maxDailyDrawdownPct}
                onChange={(e) =>
                  onUpdateRiskSettings({
                    ...riskSettings,
                    maxDailyDrawdownPct: Math.max(0.5, Number(e.target.value) || 3.5),
                  })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Max Single Position (%)
              </label>
              <input
                type="number"
                min={5}
                max={100}
                step={5}
                value={riskSettings.maxAssetExposurePct}
                onChange={(e) =>
                  onUpdateRiskSettings({
                    ...riskSettings,
                    maxAssetExposurePct: Math.max(5, Number(e.target.value) || 35),
                  })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Margin Call Level (%)
              </label>
              <input
                type="number"
                min={80}
                max={200}
                step={10}
                value={riskSettings.marginCallLevelPct}
                onChange={(e) =>
                  onUpdateRiskSettings({
                    ...riskSettings,
                    marginCallLevelPct: Math.max(80, Number(e.target.value) || 120),
                  })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Default Trade Risk (%)
              </label>
              <input
                type="number"
                min={0.25}
                max={5}
                step={0.25}
                value={riskSettings.defaultRiskPct}
                onChange={(e) =>
                  onUpdateRiskSettings({
                    ...riskSettings,
                    defaultRiskPct: Math.max(0.25, Number(e.target.value) || 1.0),
                  })
                }
                className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          {/* Offline IndexedDB Cache Card */}
          <div className="pt-3 border-t border-slate-200 dark:border-[#1E2636] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-slate-400 shrink-0" />
              <div className="text-xs">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Offline Portfolio Cache
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  IndexedDB synced ·{' '}
                  {new Date(lastSyncedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </div>
              </div>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs font-medium">
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Live</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Cached</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Detailed Holdings Matrix */}
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Portfolio Holdings & Cached Valuation
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click any instrument to open chart
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No open positions currently held in portfolio.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 px-4">Contract</th>
                  <th className="py-2.5 px-3">Class</th>
                  <th className="py-2.5 px-3">Side</th>
                  <th className="py-2.5 px-3 text-right">Qty</th>
                  <th className="py-2.5 px-3 text-right">Entry</th>
                  <th className="py-2.5 px-3 text-right">Mark</th>
                  <th className="py-2.5 px-3 text-right">Notional</th>
                  <th className="py-2.5 px-4 text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
                {positions.map((pos) => {
                  const inst = instrumentsMap.get(pos.symbol);
                  const decimals = inst?.decimals ?? 2;
                  const mark = inst
                    ? pos.side === 'BUY'
                      ? inst.bid
                      : inst.ask
                    : pos.entryPrice;
                  const notional = inst
                    ? computePositionNotional(mark, pos.quantity, inst)
                    : pos.marginUsed * pos.leverage;
                  const pnl = inst ? computeUnrealizedPnl(pos, inst) : 0;
                  return (
                    <tr
                      key={pos.id}
                      onClick={() => onSelectSymbolAndTrade(pos.symbol)}
                      className="hover:bg-slate-50 dark:hover:bg-[#161D2A] cursor-pointer h-11"
                    >
                      <td className="py-2 px-4 font-semibold text-slate-900 dark:text-slate-100">
                        {pos.symbol}
                      </td>
                      <td className="py-2 px-3 text-slate-500 dark:text-slate-400">
                        {inst ? CLASS_LABELS[inst.assetClass] : '--'}
                      </td>
                      <td
                        className={`py-2 px-3 font-medium ${
                          pos.side === 'BUY'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {pos.side === 'BUY' ? 'Long' : 'Short'} ({pos.leverage}x)
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {pos.quantity}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatPrice(pos.entryPrice, decimals)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatPrice(mark, decimals)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrency(notional, true)}
                      </td>
                      <td
                        className={`py-2 px-4 text-right font-mono tabular-nums font-semibold ${
                          pnl >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {pnl >= 0 ? '+' : ''}
                        {formatCurrency(pnl)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const SummaryMetric: React.FC<{
  label: string;
  value: string;
  sub: string;
  positive?: boolean;
}> = ({label, value, sub, positive}) => (
  <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4">
    <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
    <div className="mt-1 text-xl font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
      {value}
    </div>
    <div
      className={`mt-1 text-[11px] font-mono tabular-nums ${
        positive === undefined
          ? 'text-slate-500 dark:text-slate-400'
          : positive
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {sub}
    </div>
  </div>
);

const AllocationDonut: React.FC<{
  slices: {cls: string; color: string; margin: number}[];
  totalMargin: number;
}> = ({slices, totalMargin}) => {
  const r = 46;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width="128" height="128" viewBox="0 0 128 128">
      <circle
        cx="64"
        cy="64"
        r={r}
        fill="none"
        stroke="currentColor"
        className="text-slate-100 dark:text-[#1C2433]"
        strokeWidth="16"
      />
      {slices.map((s) => {
        const len = totalMargin > 0 ? (s.margin / totalMargin) * c : 0;
        const dash = `${len} ${c - len}`;
        const dashOffset = -offset;
        offset += len;
        return (
          <circle
            key={s.cls}
            cx="64"
            cy="64"
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth="16"
            strokeDasharray={dash}
            strokeDashoffset={dashOffset}
            transform="rotate(-90 64 64)"
          />
        );
      })}
      <text
        x="64"
        y="60"
        textAnchor="middle"
        className="fill-slate-400 text-[10px]"
      >
        Margin
      </text>
      <text
        x="64"
        y="76"
        textAnchor="middle"
        className="fill-slate-900 dark:fill-white text-[12px] font-mono font-semibold"
      >
        {formatCurrency(totalMargin, true)}
      </text>
    </svg>
  );
};
