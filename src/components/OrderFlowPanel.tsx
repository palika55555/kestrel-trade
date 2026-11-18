import React from 'react';
import {Activity, ArrowDownRight, ArrowUpRight, Layers} from 'lucide-react';
import {formatPrice} from '../services/tradingMath';
import type {
  Instrument,
  OrderFlowSnapshot,
  StagedOrderPreset,
} from '../types/trading';

interface OrderFlowPanelProps {
  instrument: Instrument;
  snapshot: OrderFlowSnapshot | null;
  onStageOrder: (preset: StagedOrderPreset) => void;
}

export const OrderFlowPanel: React.FC<OrderFlowPanelProps> = ({
  instrument,
  snapshot,
  onStageOrder,
}) => {
  if (!snapshot) {
    return (
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-6 text-center text-xs text-slate-500 dark:text-slate-400">
        Loading volume profile, buy/sell delta &amp; liquidity zones for {instrument.symbol}...
      </div>
    );
  }

  const dec = instrument.decimals;
  const maxBinVol = Math.max(1, ...snapshot.volumeProfile.map((r) => r.totalVolume));

  const verdictColor =
    snapshot.verdict === 'STRONG_BUY' || snapshot.verdict === 'BUY'
      ? 'text-emerald-600 dark:text-emerald-400'
      : snapshot.verdict === 'STRONG_SELL' || snapshot.verdict === 'SELL'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-slate-700 dark:text-slate-300';

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
        <div className="flex items-start gap-2.5">
          <Layers className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Order Flow, Volume Profile &amp; Liquidity Zones
              </h2>
              <span className="text-xs text-slate-400">·</span>
              <span className={`text-xs font-mono font-semibold ${verdictColor}`}>
                {snapshot.verdict.replace('_', ' ')} ({snapshot.verdictScore}/100)
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Real-time buy/sell volume delta, POC &amp; Value Area (70%), resting BSL/SSL liquidity, and pending Limit/Stop setups for {instrument.symbol}.
            </p>
          </div>
        </div>

        <div className="text-right font-mono text-xs tabular-nums">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">
            ATR(14) Volatility · {snapshot.volatilityRegime}
          </div>
          <div className="font-semibold text-slate-900 dark:text-white">
            {formatPrice(snapshot.atr14, dec)} ({snapshot.atrPct}%)
          </div>
        </div>
      </div>

      {/* Buy/Sell Volume Delta + Order Book Imbalance */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Buy vs. Sell Volume Pressure
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              CVD {snapshot.cvd >= 0 ? '+' : ''}
              {snapshot.cvd.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between font-mono text-xs font-semibold tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              Buyers {snapshot.buyPressurePct}%
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              Sellers {snapshot.sellPressurePct}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-rose-500/35 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{width: `${snapshot.buyPressurePct}%`}}
            />
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-medium text-slate-700 dark:text-slate-200">
              Resting Book Imbalance
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              Tape {snapshot.tickBuyCount}B / {snapshot.tickSellCount}S
            </span>
          </div>
          <div className="flex items-center justify-between font-mono text-xs font-semibold tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400">
              Bids {snapshot.bookImbalancePct}% ({snapshot.totalBidDepth})
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              Asks {100 - snapshot.bookImbalancePct}% ({snapshot.totalAskDepth})
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-rose-500/35 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{width: `${snapshot.bookImbalancePct}%`}}
            />
          </div>
        </div>
      </div>

      {/* Volume Profile + Key Liquidity Levels */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* 18-Row Horizontal Volume Profile */}
        <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-[#1E2636] p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-blue-500" />
              Volume-at-Price Profile
            </span>
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              VAL {formatPrice(snapshot.valPrice, dec)} · POC{' '}
              <strong className="text-amber-600 dark:text-amber-400">
                {formatPrice(snapshot.pocPrice, dec)}
              </strong>{' '}
              · VAH {formatPrice(snapshot.vahPrice, dec)}
            </span>
          </div>

          <div className="space-y-1">
            {snapshot.volumeProfile.map((row, idx) => {
              const totalWidth = Math.max(2, (row.totalVolume / maxBinVol) * 100);
              const buyRatio =
                row.totalVolume > 0 ? row.buyVolume / row.totalVolume : 0.5;
              const isCurrent =
                instrument.price >= row.priceLow && instrument.price <= row.priceHigh;
              return (
                <div
                  key={idx}
                  className={`grid grid-cols-12 items-center gap-2 text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded ${
                    isCurrent
                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 font-semibold'
                      : row.isPoc
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <span className="col-span-3 truncate">
                    {formatPrice(row.priceMid, dec)}
                    {row.isPoc ? ' POC' : isCurrent ? ' •' : ''}
                  </span>
                  <div className="col-span-7 h-2 rounded-xs bg-slate-100 dark:bg-[#192130] overflow-hidden">
                    <div
                      className="h-full flex"
                      style={{width: `${totalWidth}%`}}
                    >
                      <div
                        className="h-full bg-emerald-500/80"
                        style={{width: `${buyRatio * 100}%`}}
                      />
                      <div
                        className="h-full bg-rose-500/80"
                        style={{width: `${(1 - buyRatio) * 100}%`}}
                      />
                    </div>
                  </div>
                  <span className="col-span-2 text-right">
                    {Math.round(row.totalVolume)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actionable Pending Order Setups (Limit + Stop) */}
        <div className="lg:col-span-5 space-y-3">
          {/* Pullback Limit Order Card */}
          <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1">
                {snapshot.pullbackSetup.side === 'BUY' ? (
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
                )}
                Pending Limit Setup ({snapshot.pullbackSetup.side})
              </span>
              <span className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                1:2 R:R
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
              <div>
                <div className="text-slate-400">Limit</div>
                <div className="font-semibold text-slate-900 dark:text-white">
                  {formatPrice(snapshot.pullbackSetup.entryPrice, dec)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Stop-Loss</div>
                <div className="font-semibold text-rose-600 dark:text-rose-400">
                  {formatPrice(snapshot.pullbackSetup.stopLoss, dec)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Take-Profit</div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatPrice(snapshot.pullbackSetup.takeProfit, dec)}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {snapshot.pullbackSetup.rationale}
            </p>
            <button
              type="button"
              onClick={() =>
                onStageOrder({
                  symbol: instrument.symbol,
                  side: snapshot.pullbackSetup.side,
                  type: 'LIMIT',
                  triggerPrice: snapshot.pullbackSetup.entryPrice,
                  stopLoss: snapshot.pullbackSetup.stopLoss,
                  takeProfit: snapshot.pullbackSetup.takeProfit,
                  sourceLabel: 'Volume Profile Limit Setup',
                  nonce: Date.now(),
                })
              }
              className="w-full py-1.5 px-3 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer"
            >
              Stage {snapshot.pullbackSetup.side} Limit to Ticket
            </button>
          </div>

          {/* Liquidity Sweep Breakout Stop Card */}
          <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-white inline-flex items-center gap-1">
                {snapshot.breakoutSetup.side === 'BUY' ? (
                  <ArrowUpRight className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="w-3.5 h-3.5 text-rose-500" />
                )}
                Liquidity Breakout Stop ({snapshot.breakoutSetup.side})
              </span>
              <span className="font-mono text-[11px] text-amber-600 dark:text-amber-400">
                1:2 R:R
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono text-[11px] tabular-nums">
              <div>
                <div className="text-slate-400">Stop</div>
                <div className="font-semibold text-slate-900 dark:text-white">
                  {formatPrice(snapshot.breakoutSetup.entryPrice, dec)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Stop-Loss</div>
                <div className="font-semibold text-rose-600 dark:text-rose-400">
                  {formatPrice(snapshot.breakoutSetup.stopLoss, dec)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Take-Profit</div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatPrice(snapshot.breakoutSetup.takeProfit, dec)}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {snapshot.breakoutSetup.rationale}
            </p>
            <button
              type="button"
              onClick={() =>
                onStageOrder({
                  symbol: instrument.symbol,
                  side: snapshot.breakoutSetup.side,
                  type: 'STOP',
                  triggerPrice: snapshot.breakoutSetup.entryPrice,
                  stopLoss: snapshot.breakoutSetup.stopLoss,
                  takeProfit: snapshot.breakoutSetup.takeProfit,
                  sourceLabel: 'Liquidity Breakout Stop',
                  nonce: Date.now(),
                })
              }
              className="w-full py-1.5 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-[#1B2232] transition-colors cursor-pointer"
            >
              Stage {snapshot.breakoutSetup.side} Stop to Ticket
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
