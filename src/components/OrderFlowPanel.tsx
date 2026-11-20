import React from 'react';
import {Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Building2, Layers} from 'lucide-react';
import {formatPrice} from '../services/tradingMath';
import type {
  InstitutionalGoldContext,
  Instrument,
  OrderFlowSnapshot,
  StagedOrderPreset,
} from '../types/trading';

interface OrderFlowPanelProps {
  instrument: Instrument;
  snapshot: OrderFlowSnapshot | null;
  institutional?: InstitutionalGoldContext | null;
  onStageOrder: (preset: StagedOrderPreset) => void;
}

export const OrderFlowPanel: React.FC<OrderFlowPanelProps> = ({
  instrument,
  snapshot,
  institutional,
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

      {/* ATAS Footprint Price Clusters & 12-Bar Delta Histogram */}
      {(snapshot.footprintClusters?.length > 0 || snapshot.barDeltas?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-1 border-t border-slate-200 dark:border-[#1E2636]">
          {/* Footprint Clusters (Bid x Ask + 2.4x Imbalance) */}
          <div className="lg:col-span-7 rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <BarChart3 className="w-3.5 h-3.5 text-amber-500" />
                ATAS Footprint Clusters (Bid × Ask · 2.4x Imbalance)
              </span>
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                <span
                  className={`px-1.5 py-0.5 rounded border ${
                    snapshot.stackedImbalance === 'BULLISH_STACK'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : snapshot.stackedImbalance === 'BEARISH_STACK'
                      ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                      : 'border-slate-200 dark:border-[#263042] text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {snapshot.stackedImbalance === 'NONE'
                    ? 'Stack: Neutral'
                    : snapshot.stackedImbalance.replace('_', ' ')}
                </span>
                {snapshot.absorptionSignal !== 'NONE' && (
                  <span
                    className={`px-1.5 py-0.5 rounded border ${
                      snapshot.absorptionSignal === 'BULLISH_ABSORPTION'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {snapshot.absorptionSignal.replace('_', ' ')}
                  </span>
                )}
                {snapshot.cvdDivergence !== 'NONE' && (
                  <span
                    className={`px-1.5 py-0.5 rounded border ${
                      snapshot.cvdDivergence === 'BULLISH'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    CVD Div: {snapshot.cvdDivergence}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-12 text-[10px] font-mono uppercase tracking-wider text-slate-400 px-1.5">
              <span className="col-span-4">Price Level</span>
              <span className="col-span-5 text-center">Bid Vol × Ask Vol</span>
              <span className="col-span-3 text-right">Delta</span>
            </div>

            <div className="space-y-1">
              {snapshot.footprintClusters.map((row, idx) => {
                const isCurrent =
                  instrument.price >= row.priceLow && instrument.price <= row.priceHigh;
                return (
                  <div
                    key={idx}
                    className={`grid grid-cols-12 items-center gap-2 text-[11px] font-mono tabular-nums px-1.5 py-1 rounded ${
                      row.isBarPoc
                        ? 'bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold'
                        : isCurrent
                        ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <span className="col-span-4 truncate">
                      {formatPrice(row.priceMid, dec)}
                      {row.isBarPoc ? ' POC' : isCurrent ? ' •' : ''}
                    </span>
                    <span className="col-span-5 flex items-center justify-center gap-1.5">
                      <span
                        className={
                          row.imbalance === 'SELL'
                            ? 'px-1 rounded bg-rose-500/20 text-rose-600 dark:text-rose-400 font-bold'
                            : 'text-rose-600/90 dark:text-rose-400/90'
                        }
                      >
                        {Math.round(row.bidVolume)}
                      </span>
                      <span className="text-slate-400">×</span>
                      <span
                        className={
                          row.imbalance === 'BUY'
                            ? 'px-1 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold'
                            : 'text-emerald-600/90 dark:text-emerald-400/90'
                        }
                      >
                        {Math.round(row.askVolume)}
                      </span>
                    </span>
                    <span
                      className={`col-span-3 text-right font-semibold ${
                        row.delta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : row.delta < 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {row.delta >= 0 ? '+' : ''}
                      {Math.round(row.delta)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 12-Bar Delta & CVD Histogram */}
          <div className="lg:col-span-5 rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 flex flex-col justify-between space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                12-Bar Delta &amp; CVD Flow
              </span>
              <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                Last Delta{' '}
                <strong
                  className={
                    (snapshot.barDeltas[snapshot.barDeltas.length - 1]?.delta ?? 0) >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }
                >
                  {(snapshot.barDeltas[snapshot.barDeltas.length - 1]?.delta ?? 0) >= 0 ? '+' : ''}
                  {Math.round(snapshot.barDeltas[snapshot.barDeltas.length - 1]?.delta ?? 0)}
                </strong>
              </span>
            </div>

            {(() => {
              const maxAbsDelta = Math.max(
                1,
                ...snapshot.barDeltas.map((b) => Math.abs(b.delta)),
              );
              return (
                <div className="grid grid-cols-12 gap-1 items-end h-32 pt-3 pb-1 px-1 rounded bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636]">
                  {snapshot.barDeltas.map((pt, i) => {
                    const heightPct = Math.max(8, Math.round((Math.abs(pt.delta) / maxAbsDelta) * 100));
                    const isPos = pt.delta >= 0;
                    return (
                      <div key={i} className="flex flex-col items-center justify-end h-full gap-1">
                        <div className="w-full flex-1 flex items-end justify-center">
                          <div
                            title={`Delta ${pt.delta >= 0 ? '+' : ''}${Math.round(pt.delta)} · CVD ${Math.round(pt.cvd)}`}
                            className={`w-full rounded-xs transition-all ${
                              isPos ? 'bg-emerald-500/85' : 'bg-rose-500/85'
                            }`}
                            style={{height: `${heightPct}%`}}
                          />
                        </div>
                        <span className="text-[9px] font-mono text-slate-400 tabular-nums">
                          {pt.delta >= 0 ? '+' : '-'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono tabular-nums pt-1">
              <div className="rounded bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] px-2.5 py-1.5">
                <div className="text-[10px] text-slate-400">Cumulative Delta</div>
                <div
                  className={`font-semibold ${
                    snapshot.cvd >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {snapshot.cvd >= 0 ? '+' : ''}
                  {snapshot.cvd.toLocaleString()}
                </div>
              </div>
              <div className="rounded bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] px-2.5 py-1.5">
                <div className="text-[10px] text-slate-400">ATAS Confluence</div>
                <div className="font-semibold text-slate-900 dark:text-white truncate">
                  {snapshot.stackedImbalance !== 'NONE'
                    ? snapshot.stackedImbalance.replace('_', ' ')
                    : snapshot.absorptionSignal !== 'NONE'
                    ? snapshot.absorptionSignal.replace('_', ' ')
                    : 'Balanced'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Institutional & Smart Money ("Finance Insider") — CFTC COT, CBOE GVZ/VIX, GLD ETF & Kraken PAXG */}
      {institutional && (
        <div className="pt-3 border-t border-slate-200 dark:border-[#1E2636] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-blue-500 shrink-0" />
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Institutional Positioning &amp; Smart Money Flow (COT · Volatility · Physical Gold Tape)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {institutional.summary}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              {institutional.volatilityAlert && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold">
                  <AlertTriangle className="w-3 h-3" />
                  GVZ Vol Spike (+5% Conf Floor)
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded border font-semibold ${
                  institutional.compositeBias === 'BULLISH'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : institutional.compositeBias === 'BEARISH'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    : 'border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300'
                }`}
              >
                Smart Money: {institutional.compositeBias} ({institutional.compositeScore >= 0 ? '+' : ''}
                {institutional.compositeScore})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            {/* CFTC COT COMEX Gold */}
            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  CFTC COT COMEX Gold
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {institutional.cot?.reportDate || 'Pending'}
                </span>
              </div>
              {institutional.cot ? (
                <div className="space-y-1 font-mono text-[11px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Managed Money Net</span>
                    <span
                      className={
                        institutional.cot.managedMoneyNet >= 0
                          ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                          : 'font-semibold text-rose-600 dark:text-rose-400'
                      }
                    >
                      {institutional.cot.managedMoneyNet >= 0 ? '+' : ''}
                      {institutional.cot.managedMoneyNet.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 dark:text-slate-400">Funds WoW Change</span>
                    <span
                      className={
                        institutional.cot.managedMoneyNetChange >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }
                    >
                      {institutional.cot.managedMoneyNetChange >= 0 ? '+' : ''}
                      {institutional.cot.managedMoneyNetChange.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                    <span>Comm: {institutional.cot.commercialNet.toLocaleString()}</span>
                    <span>Retail: {institutional.cot.retailNet.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span>OI: {institutional.cot.openInterest.toLocaleString()}</span>
                    <span>Bias: {institutional.cot.bias}</span>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">Syncing CFTC Disaggregated COT...</div>
              )}
            </div>

            {/* CBOE Gold Volatility (^GVZ), ^VIX & SPDR GLD ETF */}
            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Options Vol &amp; GLD ETF
                </span>
                <span className="text-[10px] font-mono text-slate-400">CBOE / NYSE</span>
              </div>
              <div className="space-y-1 font-mono text-[11px] tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Gold Vol (^GVZ)</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {institutional.gvz !== null ? institutional.gvz.toFixed(2) : '--'}{' '}
                    <span
                      className={
                        institutional.gvzChangePct >= 0 ? 'text-amber-500' : 'text-emerald-500'
                      }
                    >
                      ({institutional.gvzChangePct >= 0 ? '+' : ''}
                      {institutional.gvzChangePct}%)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">SPX Vol (^VIX)</span>
                  <span className="text-slate-700 dark:text-slate-200">
                    {institutional.vix !== null ? institutional.vix.toFixed(2) : '--'}{' '}
                    <span className="text-slate-400">
                      ({institutional.vixChangePct >= 0 ? '+' : ''}
                      {institutional.vixChangePct}%)
                    </span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 dark:text-slate-400">SPDR Gold (GLD)</span>
                  <span
                    className={
                      institutional.gldChangePct >= 0
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-semibold text-rose-600 dark:text-rose-400'
                    }
                  >
                    {institutional.gldPrice !== null ? `$${institutional.gldPrice.toFixed(2)}` : '--'}{' '}
                    ({institutional.gldChangePct >= 0 ? '+' : ''}
                    {institutional.gldChangePct}%)
                  </span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>GLD Session Vol</span>
                  <span>{institutional.gldVolume.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Real Executed Gold Flow (Kraken PAXG/USD 1:1 Physical Gold) */}
            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  PAXG/USD Real Prints
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {institutional.paxgPrice ? `$${institutional.paxgPrice.toFixed(2)}` : 'Kraken'}
                </span>
              </div>
              <div className="space-y-1.5 font-mono text-[11px] tabular-nums">
                <div className="flex justify-between font-semibold">
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Buy {institutional.paxgBuyPct}% ({institutional.paxgBuyVolumeOz.toFixed(2)} oz)
                  </span>
                  <span className="text-rose-600 dark:text-rose-400">
                    Sell {100 - institutional.paxgBuyPct}% ({institutional.paxgSellVolumeOz.toFixed(2)} oz)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-rose-500/35 overflow-hidden flex">
                  <div
                    className="h-full bg-emerald-500"
                    style={{width: `${institutional.paxgBuyPct}%`}}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                  <span>
                    Net Delta:{' '}
                    <strong
                      className={
                        institutional.paxgNetDeltaOz >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }
                    >
                      {institutional.paxgNetDeltaOz >= 0 ? '+' : ''}
                      {institutional.paxgNetDeltaOz.toFixed(2)} oz
                    </strong>
                  </span>
                  <span>L2 Book Bid: {institutional.paxgBookBidPct}%</span>
                </div>
              </div>
            </div>

            {/* Institutional Whale Prints Tape (>= 0.2 oz) */}
            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Gold Whale Prints
                </span>
                <span className="text-[10px] font-mono text-slate-400">&gt;= 0.20 oz</span>
              </div>
              {institutional.paxgLargePrints.length > 0 ? (
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1 font-mono text-[10px] tabular-nums">
                  {institutional.paxgLargePrints.slice(0, 6).map((p) => (
                    <div key={p.id} className="flex items-center justify-between">
                      <span
                        className={
                          p.side === 'BUY'
                            ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                            : 'font-semibold text-rose-600 dark:text-rose-400'
                        }
                      >
                        {p.side} {p.sizeOz.toFixed(2)} oz
                      </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        ${p.price.toFixed(2)}
                      </span>
                      <span className="text-slate-400">
                        {new Date(p.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400">
                  Waiting for &gt;=0.20 oz physical gold blocks...
                </div>
              )}
            </div>
          </div>

          {/* Pro Institutional Cross-Asset Lead & Perpetual Futures OI Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between font-sans">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Gold Perp OI &amp; Funding
                </span>
                <span className="text-[10px] font-mono text-slate-400">Binance fapi</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">Open Interest</span>
                <span className="font-semibold text-slate-900 dark:text-white">
                  {institutional.futuresOiOz != null
                    ? `${Math.round(institutional.futuresOiOz).toLocaleString()} oz`
                    : '--'}{' '}
                  {typeof institutional.futuresOiDeltaPct === 'number' &&
                    institutional.futuresOiDeltaPct !== 0 && (
                      <span
                        className={
                          institutional.futuresOiDeltaPct > 0 ? 'text-emerald-500' : 'text-rose-500'
                        }
                      >
                        ({institutional.futuresOiDeltaPct >= 0 ? '+' : ''}
                        {institutional.futuresOiDeltaPct}%)
                      </span>
                    )}
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>
                  Funding:{' '}
                  {institutional.futuresFundingRate != null
                    ? `${(institutional.futuresFundingRate * 100).toFixed(4)}%`
                    : '--'}
                </span>
                <span>
                  Taker:{' '}
                  {institutional.futuresTakerBuySellRatio != null
                    ? `${institutional.futuresTakerBuySellRatio.toFixed(2)}x`
                    : '--'}
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                Regime: {institutional.futuresRegime ? institutional.futuresRegime.replace('_', ' ') : 'NEUTRAL'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between font-sans">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Real Yields (TIP) &amp; FX
                </span>
                <span className="text-[10px] font-mono text-slate-400">TIPS / Carry</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">iShares TIPS (TIP)</span>
                <span
                  className={
                    (institutional.tipChangePct ?? 0) >= 0
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'font-semibold text-rose-600 dark:text-rose-400'
                  }
                >
                  {institutional.tipPrice != null ? `$${institutional.tipPrice.toFixed(2)}` : '--'}{' '}
                  ({(institutional.tipChangePct ?? 0) >= 0 ? '+' : ''}
                  {institutional.tipChangePct ?? 0}%)
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                <span>USD/JPY</span>
                <span>
                  {institutional.usdJpyPrice != null ? institutional.usdJpyPrice.toFixed(2) : '--'} (
                  {(institutional.usdJpyChangePct ?? 0) >= 0 ? '+' : ''}
                  {institutional.usdJpyChangePct ?? 0}%)
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between font-sans">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Gold Miners Lead (GDX)
                </span>
                <span className="text-[10px] font-mono text-slate-400">NYSE Arca</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">VanEck Miners</span>
                <span
                  className={
                    (institutional.gdxChangePct ?? 0) >= 0
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'font-semibold text-rose-600 dark:text-rose-400'
                  }
                >
                  {institutional.gdxPrice != null ? `$${institutional.gdxPrice.toFixed(2)}` : '--'}{' '}
                  ({(institutional.gdxChangePct ?? 0) >= 0 ? '+' : ''}
                  {institutional.gdxChangePct ?? 0}%)
                </span>
              </div>
              <div className="text-[10px] text-slate-400 truncate">
                Equities front-run physical Gold swings
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3 space-y-1 font-mono text-[11px] tabular-nums">
              <div className="flex items-center justify-between font-sans">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Silver &amp; SMT Divergence
                </span>
                <span className="text-[10px] font-mono text-slate-400">SI=F vs XAU</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 dark:text-slate-400">COMEX Silver</span>
                <span
                  className={
                    (institutional.silverChangePct ?? 0) >= 0
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : 'font-semibold text-rose-600 dark:text-rose-400'
                  }
                >
                  {institutional.silverPrice != null ? `$${institutional.silverPrice.toFixed(3)}` : '--'}{' '}
                  ({(institutional.silverChangePct ?? 0) >= 0 ? '+' : ''}
                  {institutional.silverChangePct ?? 0}%)
                </span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-500 dark:text-slate-400">SMT Signal</span>
                <span
                  className={
                    institutional.smtDivergence === 'BULLISH_SMT'
                      ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                      : institutional.smtDivergence === 'BEARISH_SMT'
                      ? 'font-semibold text-rose-600 dark:text-rose-400'
                      : 'text-slate-400'
                  }
                >
                  {institutional.smtDivergence && institutional.smtDivergence !== 'NONE'
                    ? institutional.smtDivergence.replace('_', ' ')
                    : 'Aligned (None)'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
