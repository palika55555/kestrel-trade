import React, {useState} from 'react';
import {formatPrice} from '../services/tradingMath';
import type {
  Instrument,
  LiquidityZone,
  MarketPrint,
  OrderFlowSnapshot,
  StagedOrderPreset,
} from '../types/trading';

interface OrderBookDepthProps {
  instrument: Instrument;
  recentPrints?: MarketPrint[];
  orderFlow?: OrderFlowSnapshot | null;
  onSelectPrice?: (price: number) => void;
  onStageOrder?: (preset: StagedOrderPreset) => void;
}

export const OrderBookDepth: React.FC<OrderBookDepthProps> = ({
  instrument,
  recentPrints = [],
  orderFlow,
  onSelectPrice,
  onStageOrder,
}) => {
  const [view, setView] = useState<'DEPTH' | 'TAPE' | 'LIQUIDITY'>('DEPTH');

  const asksReversed = [...instrument.asks].slice(0, 7).reverse();
  const bidsTop = instrument.bids.slice(0, 7);
  const maxTotal = Math.max(
    asksReversed[0]?.total || 1,
    bidsTop[bidsTop.length - 1]?.total || 1,
  );
  const spread = instrument.ask - instrument.bid;

  const totalBid = instrument.bids.reduce((a, b) => a + b.size, 0);
  const totalAsk = instrument.asks.reduce((a, b) => a + b.size, 0);
  const bidPct =
    totalBid + totalAsk > 0 ? Math.round((totalBid / (totalBid + totalAsk)) * 100) : 50;
  const askPct = 100 - bidPct;

  const avgAskSize = asksReversed.length > 0 ? asksReversed.reduce((s, r) => s + r.size, 0) / asksReversed.length : 0;
  const avgBidSize = bidsTop.length > 0 ? bidsTop.reduce((s, r) => s + r.size, 0) / bidsTop.length : 0;

  const bestBid = bidsTop[0];
  const bestAsk = asksReversed[asksReversed.length - 1];
  const microPrice =
    bestBid && bestAsk && bestBid.size + bestAsk.size > 0
      ? (bestBid.price * bestAsk.size + bestAsk.price * bestBid.size) /
        (bestBid.size + bestAsk.size)
      : (instrument.bid + instrument.ask) / 2;
  const midPrice = (instrument.bid + instrument.ask) / 2;
  const microTilt = microPrice - midPrice;
  const isRealL2Symbol =
    instrument.symbol === 'XAU/USD' ||
    instrument.symbol === 'GC1!' ||
    instrument.symbol === 'BTC/USD';

  const tapeBuys = recentPrints.filter((p) => p.side === 'BUY').length;
  const tapeSells = recentPrints.filter((p) => p.side === 'SELL').length;
  const tapeBuyPct =
    tapeBuys + tapeSells > 0
      ? Math.round((tapeBuys / (tapeBuys + tapeSells)) * 100)
      : 50;

  const stageFromZone = (zone: LiquidityZone) => {
    if (!orderFlow) {
      onSelectPrice?.(zone.price);
      return;
    }
    const atr = Math.max(instrument.tickSize * 6, orderFlow.atr14);
    const isAbove = zone.price > instrument.price;
    const side =
      zone.type === 'BSL'
        ? 'BUY'
        : zone.type === 'SSL'
        ? 'SELL'
        : isAbove
        ? 'SELL'
        : 'BUY';
    const orderType =
      zone.type === 'BSL' || zone.type === 'SSL' ? 'STOP' : 'LIMIT';
    const factor = Math.pow(10, instrument.decimals);
    const sl =
      Math.round(
        (side === 'BUY' ? zone.price - atr * 1.3 : zone.price + atr * 1.3) * factor,
      ) / factor;
    const tp =
      Math.round(
        (side === 'BUY' ? zone.price + atr * 2.6 : zone.price - atr * 2.6) * factor,
      ) / factor;

    if (onStageOrder) {
      onStageOrder({
        symbol: instrument.symbol,
        side,
        type: orderType,
        triggerPrice: zone.price,
        stopLoss: sl,
        takeProfit: tp,
        sourceLabel: zone.label,
        nonce: Date.now(),
      });
    } else {
      onSelectPrice?.(zone.price);
    }
  };

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden flex flex-col">
      {/* Header + Sub-Tab Switcher */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636]">
          {(
            [
              {id: 'DEPTH', label: 'Depth L2'},
              {id: 'TAPE', label: `Tape (${recentPrints.length})`},
              {id: 'LIQUIDITY', label: 'Liquidity'},
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                view === t.id
                  ? 'bg-white dark:bg-[#1B2232] text-slate-900 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
          {instrument.symbol}
        </span>
      </div>

      {view === 'DEPTH' && (
        <>
          {/* Bid / Ask Book Imbalance Bar + Microprice */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-[#1A2130] space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                Bid {bidPct}% ({totalBid.toFixed(1)})
              </span>
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                Ask {askPct}% ({totalAsk.toFixed(1)})
              </span>
            </div>
            <div className="h-1.5 w-full rounded-sm bg-rose-500/35 overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{width: `${bidPct}%`}}
              />
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span>{isRealL2Symbol ? 'Real L2 Book' : 'BBO Depth'}</span>
              <span>
                Micro{' '}
                <strong
                  className={
                    microTilt > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : microTilt < 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }
                >
                  {formatPrice(microPrice, instrument.decimals)}
                </strong>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#1A2130]">
            <span>Price</span>
            <span className="text-right">Size</span>
            <span className="text-right">Total</span>
          </div>

          {/* Asks */}
          <div className="divide-y divide-transparent">
            {asksReversed.map((lvl, idx) => {
              const depthPct = Math.min(100, (lvl.total / maxTotal) * 100);
              const isWall = avgAskSize > 0 && lvl.size >= avgAskSize * 1.85;
              return (
                <button
                  key={`ask-${idx}`}
                  type="button"
                  onClick={() => onSelectPrice?.(lvl.price)}
                  className={`relative w-full grid grid-cols-3 px-3 py-1 text-[11px] font-mono tabular-nums hover:bg-rose-500/10 transition-colors cursor-pointer ${
                    isWall ? 'bg-rose-500/5 font-semibold' : ''
                  }`}
                >
                  <span
                    className="absolute inset-y-0 right-0 bg-rose-500/10 pointer-events-none"
                    style={{width: `${depthPct}%`}}
                  />
                  <span className="relative text-left text-rose-600 dark:text-rose-400">
                    {formatPrice(lvl.price, instrument.decimals)}
                  </span>
                  <span className="relative text-right text-slate-700 dark:text-slate-300">
                    {isWall ? 'W ' : ''}
                    {lvl.size}
                  </span>
                  <span className="relative text-right text-slate-500 dark:text-slate-400">
                    {lvl.total}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Spread Divider */}
          <div className="px-3 py-1.5 my-0.5 bg-slate-50 dark:bg-[#0D1119] border-y border-slate-200 dark:border-[#1E2636] flex items-center justify-between text-[11px] font-mono tabular-nums">
            <span className="text-slate-500 dark:text-slate-400">Spread</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium">
              {formatPrice(spread, instrument.decimals)}
            </span>
          </div>

          {/* Bids */}
          <div>
            {bidsTop.map((lvl, idx) => {
              const depthPct = Math.min(100, (lvl.total / maxTotal) * 100);
              const isWall = avgBidSize > 0 && lvl.size >= avgBidSize * 1.85;
              return (
                <button
                  key={`bid-${idx}`}
                  type="button"
                  onClick={() => onSelectPrice?.(lvl.price)}
                  className={`relative w-full grid grid-cols-3 px-3 py-1 text-[11px] font-mono tabular-nums hover:bg-emerald-500/10 transition-colors cursor-pointer ${
                    isWall ? 'bg-emerald-500/5 font-semibold' : ''
                  }`}
                >
                  <span
                    className="absolute inset-y-0 right-0 bg-emerald-500/10 pointer-events-none"
                    style={{width: `${depthPct}%`}}
                  />
                  <span className="relative text-left text-emerald-600 dark:text-emerald-400">
                    {formatPrice(lvl.price, instrument.decimals)}
                  </span>
                  <span className="relative text-right text-slate-700 dark:text-slate-300">
                    {isWall ? 'W ' : ''}
                    {lvl.size}
                  </span>
                  <span className="relative text-right text-slate-500 dark:text-slate-400">
                    {lvl.total}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === 'TAPE' && (
        <div className="flex flex-col">
          {/* Live Buy / Sell Aggressor Ratio */}
          <div className="px-3 py-2 border-b border-slate-100 dark:border-[#1A2130] space-y-1">
            <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                Buy Prints {tapeBuyPct}% ({tapeBuys})
              </span>
              <span className="text-rose-600 dark:text-rose-400 font-medium">
                Sell Prints {100 - tapeBuyPct}% ({tapeSells})
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-rose-500/35 overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{width: `${tapeBuyPct}%`}}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 px-3 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-[#1A2130]">
            <span>Time</span>
            <span>Side</span>
            <span className="text-right">Price</span>
            <span className="text-right">Size</span>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1A2130]">
            {recentPrints.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
                Waiting for live market prints on {instrument.symbol}...
              </div>
            ) : (
              recentPrints.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  onClick={() => onSelectPrice?.(pr.price)}
                  className="w-full grid grid-cols-4 px-3 py-1 text-[11px] font-mono tabular-nums hover:bg-slate-50 dark:hover:bg-[#171F2E] cursor-pointer text-left"
                >
                  <span className="text-slate-400">
                    {new Date(pr.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span
                    className={
                      pr.side === 'BUY'
                        ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                        : 'text-rose-600 dark:text-rose-400 font-semibold'
                    }
                  >
                    {pr.side}
                  </span>
                  <span className="text-right text-slate-900 dark:text-slate-100">
                    {formatPrice(pr.price, instrument.decimals)}
                  </span>
                  <span className="text-right text-slate-500 dark:text-slate-400">
                    {pr.size}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {view === 'LIQUIDITY' && (
        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1A2130]">
          {!orderFlow || orderFlow.liquidityZones.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500 dark:text-slate-400">
              Loading resting liquidity &amp; pending order zones...
            </div>
          ) : (
            orderFlow.liquidityZones.map((zone) => {
              const distPct =
                instrument.price > 0
                  ? ((zone.price - instrument.price) / instrument.price) * 100
                  : 0;
              return (
                <div
                  key={zone.id}
                  className="px-3 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50 dark:hover:bg-[#171F2E]"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                      {zone.label}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {formatPrice(zone.price, instrument.decimals)} ({distPct >= 0 ? '+' : ''}
                      {distPct.toFixed(2)}%)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => stageFromZone(zone)}
                    className="shrink-0 px-2 py-1 text-[11px] font-medium rounded-md border border-slate-200 dark:border-[#263042] text-blue-600 dark:text-blue-400 hover:bg-blue-500/10 cursor-pointer"
                  >
                    Stage
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
