import React, {useEffect, useMemo, useState} from 'react';
import {Layers, RefreshCw} from 'lucide-react';
import {formatPrice} from '../services/tradingMath';
import type {
  DomLevel2Snapshot,
  Instrument,
  OrderFlowSnapshot,
  StagedOrderPreset,
} from '../types/trading';

interface DomLevel2PanelProps {
  instrument: Instrument;
  orderFlow: OrderFlowSnapshot | null;
  isOnline: boolean;
  onStageOrder: (preset: StagedOrderPreset) => void;
}

export const DomLevel2Panel: React.FC<DomLevel2PanelProps> = ({
  instrument,
  orderFlow,
  isOnline,
  onStageOrder,
}) => {
  const isGold = instrument.symbol === 'XAU/USD' || instrument.symbol === 'GC1!';
  const isBtc = instrument.symbol === 'BTC/USD';

  const stepOptions = useMemo(() => {
    if (isGold) return [0.25, 0.5, 1.0, 2.5];
    if (isBtc) return [5, 10, 25, 50];
    const t = instrument.tickSize;
    return [
      Number((t * 2).toFixed(instrument.decimals)),
      Number((t * 5).toFixed(instrument.decimals)),
      Number((t * 10).toFixed(instrument.decimals)),
      Number((t * 25).toFixed(instrument.decimals)),
    ];
  }, [isGold, isBtc, instrument.tickSize, instrument.decimals]);

  const [stepSize, setStepSize] = useState<number>(stepOptions[1] ?? stepOptions[0]);
  const [dom, setDom] = useState<DomLevel2Snapshot | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    setStepSize(stepOptions[1] ?? stepOptions[0]);
  }, [instrument.symbol, stepOptions]);

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;

    const loadDom = async () => {
      try {
        const res = await fetch(
          `/api/dom/${encodeURIComponent(instrument.symbol)}?step=${stepSize}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as DomLevel2Snapshot;
        if (!cancelled) {
          setDom(data);
        }
      } catch {
        // Ignore transient network errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    loadDom();
    const timer = setInterval(loadDom, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [instrument.symbol, stepSize, isOnline]);

  const dec = instrument.decimals;
  const asksDisplay = useMemo(
    () => (dom ? [...dom.asks].slice(0, 14).reverse() : []),
    [dom],
  );
  const bidsDisplay = useMemo(
    () => (dom ? dom.bids.slice(0, 14) : []),
    [dom],
  );

  const maxSideSize = useMemo(() => {
    const askMax = asksDisplay.reduce((m, r) => Math.max(m, r.size), 0);
    const bidMax = bidsDisplay.reduce((m, r) => Math.max(m, r.size), 0);
    return Math.max(0.01, askMax, bidMax);
  }, [asksDisplay, bidsDisplay]);

  const atr = Math.max(
    instrument.tickSize * 8,
    orderFlow?.atr14 || (isGold ? 2.8 : instrument.price * 0.002),
  );

  const stageAtLevel = (
    price: number,
    side: 'BUY' | 'SELL',
    orderType: 'LIMIT' | 'STOP',
    label: string,
  ) => {
    const f = Math.pow(10, dec);
    const sl =
      Math.round((side === 'BUY' ? price - atr * 1.4 : price + atr * 1.4) * f) / f;
    const tp =
      Math.round((side === 'BUY' ? price + atr * 2.8 : price - atr * 2.8) * f) / f;
    onStageOrder({
      symbol: instrument.symbol,
      side,
      type: orderType,
      triggerPrice: price,
      stopLoss: sl,
      takeProfit: tp,
      sourceLabel: label,
      nonce: Date.now(),
    });
  };

  if (!dom) {
    return (
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-6 text-center text-xs text-slate-500 dark:text-slate-400">
        {loading
          ? `Connecting to Level 2 Depth of Market for ${instrument.symbol}...`
          : `Level 2 DOM ready when market stream is online.`}
      </div>
    );
  }

  const microBiasLabel =
    dom.microPriceDelta > 0
      ? 'Bid-Heavy (Upward Tilt)'
      : dom.microPriceDelta < 0
      ? 'Ask-Heavy (Downward Tilt)'
      : 'Balanced';

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
        <div className="flex items-start gap-2.5">
          <Layers className="w-4 h-4 mt-0.5 text-blue-500 shrink-0" />
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                DOM Level 2 Price Ladder &amp; Liquidity Walls
              </h2>
              <span className="text-slate-400">·</span>
              <span
                className={`font-mono font-semibold ${
                  dom.isRealL2
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {dom.isRealL2 ? 'Live Multi-Venue L2' : 'BBO Liquidity Tiers'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {dom.sourceLabel} · Click any price row to stage Limit or Stop orders into the ticket.
            </p>
          </div>
        </div>

        {/* Tick / Price Grouping Selector */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Step
          </span>
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636]">
            {stepOptions.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStepSize(st)}
                className={`px-2 py-1 text-[11px] font-mono tabular-nums rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  stepSize === st
                    ? 'bg-white dark:bg-[#1B2232] text-slate-900 dark:text-white font-semibold'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
          <RefreshCw className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
        </div>
      </div>

      {/* 4-Metric L2 Telemetry Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Top-5 Levels Imbalance
          </div>
          <div className="font-mono text-sm font-semibold tabular-nums flex items-center justify-between">
            <span className="text-emerald-600 dark:text-emerald-400">
              {dom.top5BidRatioPct}% Bid
            </span>
            <span className="text-rose-600 dark:text-rose-400">
              {100 - dom.top5BidRatioPct}% Ask
            </span>
          </div>
          <div className="h-1.5 w-full rounded-sm bg-rose-500/30 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{width: `${dom.top5BidRatioPct}%`}}
            />
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-3 space-y-1">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            Full Book ({dom.bids.length + dom.asks.length} Lvl)
          </div>
          <div className="font-mono text-sm font-semibold tabular-nums flex items-center justify-between">
            <span className="text-emerald-600 dark:text-emerald-400">
              {dom.totalBidLiquidity}
            </span>
            <span className="text-slate-400 text-[11px]">{dom.fullBookBidRatioPct}% Bid</span>
            <span className="text-rose-600 dark:text-rose-400">
              {dom.totalAskLiquidity}
            </span>
          </div>
          <div className="h-1.5 w-full rounded-sm bg-rose-500/30 overflow-hidden flex">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{width: `${dom.fullBookBidRatioPct}%`}}
            />
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-3 space-y-0.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>L2 Microprice Fair Value</span>
            {dom.wallVelocity && dom.wallVelocity !== 'BALANCED' && (
              <span
                className={`font-mono font-semibold ${
                  dom.wallVelocity === 'STACKING_BIDS' || dom.wallVelocity === 'PULLING_ASKS'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {dom.wallVelocity.replace('_', ' ')}
              </span>
            )}
          </div>
          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
            {formatPrice(dom.microPrice, dec)}{' '}
            <span
              className={`text-[11px] ${
                dom.microPriceDelta > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : dom.microPriceDelta < 0
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              ({dom.microPriceDelta >= 0 ? '+' : ''}
              {dom.microPriceDelta.toFixed(Math.min(4, Math.max(2, dec)))})
            </span>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
            {microBiasLabel} · ΔB {dom.bidWallDelta ? (dom.bidWallDelta >= 0 ? '+' : '') + dom.bidWallDelta : '0'} / ΔA{' '}
            {dom.askWallDelta ? (dom.askWallDelta >= 0 ? '+' : '') + dom.askWallDelta : '0'}
          </div>
        </div>

        <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-3 space-y-1 font-mono text-[11px] tabular-nums">
          <div className="font-sans text-[11px] text-slate-500 dark:text-slate-400">
            Nearest Whale Walls
          </div>
          <div className="flex items-center justify-between">
            <span className="text-rose-600 dark:text-rose-400 font-semibold">
              Ask {dom.nearestAskWall ? formatPrice(dom.nearestAskWall.price, dec) : '--'}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {dom.nearestAskWall ? `${dom.nearestAskWall.size} (+${dom.nearestAskWall.distanceDollars})` : ''}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
              Bid {dom.nearestBidWall ? formatPrice(dom.nearestBidWall.price, dec) : '--'}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {dom.nearestBidWall ? `${dom.nearestBidWall.size} (-${dom.nearestBidWall.distanceDollars})` : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Centered Pro DOM Ladder */}
      <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] overflow-hidden">
        <div className="grid grid-cols-12 px-3 py-2 bg-slate-50 dark:bg-[#0D1119] border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
          <span className="col-span-2">Bid Cum</span>
          <span className="col-span-3 text-right pr-2">Bid Liquidity</span>
          <span className="col-span-2 text-center">Price</span>
          <span className="col-span-3 pl-2">Ask Liquidity</span>
          <span className="col-span-2 text-right">Stage</span>
        </div>

        {/* Asks (Descending towards Mid) */}
        <div className="divide-y divide-slate-100 dark:divide-[#1A2130]">
          {asksDisplay.map((row, idx) => {
            const barPct = Math.min(100, (row.size / maxSideSize) * 100);
            return (
              <div
                key={`dom-ask-${row.price}-${idx}`}
                className={`grid grid-cols-12 items-center px-3 py-1 text-[11px] font-mono tabular-nums transition-colors ${
                  row.isWall
                    ? 'bg-rose-500/10 hover:bg-rose-500/15'
                    : 'hover:bg-slate-50 dark:hover:bg-[#171F2E]'
                }`}
              >
                <span className="col-span-2 text-slate-400">
                  {row.venues || '—'}
                </span>
                <span className="col-span-3" />
                <button
                  type="button"
                  onClick={() =>
                    stageAtLevel(
                      row.price,
                      'SELL',
                      'LIMIT',
                      `DOM Ask Wall @ ${formatPrice(row.price, dec)}`,
                    )
                  }
                  className="col-span-2 text-center font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  {formatPrice(row.price, dec)}
                </button>
                <div className="col-span-3 relative pl-2 flex items-center justify-between">
                  <span
                    className="absolute inset-y-0 left-0 bg-rose-500/20 pointer-events-none"
                    style={{width: `${barPct}%`}}
                  />
                  <span className="relative font-semibold text-slate-800 dark:text-slate-100">
                    {row.size}
                    {row.isWall ? ' WALL' : ''}
                  </span>
                  <span className="relative text-slate-400">{row.total}</span>
                </div>
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      stageAtLevel(
                        row.price,
                        'SELL',
                        'LIMIT',
                        `DOM Sell Limit @ ${formatPrice(row.price, dec)}`,
                      )
                    }
                    className="px-1.5 py-0.5 text-[10px] rounded border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Sell Lmt
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      stageAtLevel(
                        row.price,
                        'BUY',
                        'STOP',
                        `DOM Buy Stop @ ${formatPrice(row.price, dec)}`,
                      )
                    }
                    className="px-1.5 py-0.5 text-[10px] rounded border border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#232C3F] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Buy Stp
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Center Mid / Spread Bar */}
        <div className="px-3 py-2 bg-slate-100 dark:bg-[#0B0F17] border-y border-slate-200 dark:border-[#1E2636] flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
            Best Bid {formatPrice(instrument.bid, dec)}
          </span>
          <span className="text-slate-700 dark:text-slate-200 font-semibold">
            Mid {formatPrice(dom.midPrice, dec)} · Spread {formatPrice(dom.spread, dec)}
          </span>
          <span className="text-rose-600 dark:text-rose-400 font-semibold">
            Best Ask {formatPrice(instrument.ask, dec)}
          </span>
        </div>

        {/* Bids (Descending from Best Bid) */}
        <div className="divide-y divide-slate-100 dark:divide-[#1A2130]">
          {bidsDisplay.map((row, idx) => {
            const barPct = Math.min(100, (row.size / maxSideSize) * 100);
            return (
              <div
                key={`dom-bid-${row.price}-${idx}`}
                className={`grid grid-cols-12 items-center px-3 py-1 text-[11px] font-mono tabular-nums transition-colors ${
                  row.isWall
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/15'
                    : 'hover:bg-slate-50 dark:hover:bg-[#171F2E]'
                }`}
              >
                <span className="col-span-2 text-slate-400">{row.total}</span>
                <div className="col-span-3 relative pr-2 flex items-center justify-between">
                  <span
                    className="absolute inset-y-0 right-0 bg-emerald-500/20 pointer-events-none"
                    style={{width: `${barPct}%`}}
                  />
                  <span className="relative text-slate-400">{row.venues || '—'}</span>
                  <span className="relative font-semibold text-slate-800 dark:text-slate-100">
                    {row.isWall ? 'WALL ' : ''}
                    {row.size}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    stageAtLevel(
                      row.price,
                      'BUY',
                      'LIMIT',
                      `DOM Bid Wall @ ${formatPrice(row.price, dec)}`,
                    )
                  }
                  className="col-span-2 text-center font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                >
                  {formatPrice(row.price, dec)}
                </button>
                <span className="col-span-3" />
                <div className="col-span-2 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      stageAtLevel(
                        row.price,
                        'BUY',
                        'LIMIT',
                        `DOM Buy Limit @ ${formatPrice(row.price, dec)}`,
                      )
                    }
                    className="px-1.5 py-0.5 text-[10px] rounded border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Buy Lmt
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      stageAtLevel(
                        row.price,
                        'SELL',
                        'STOP',
                        `DOM Sell Stop @ ${formatPrice(row.price, dec)}`,
                      )
                    }
                    className="px-1.5 py-0.5 text-[10px] rounded border border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-[#232C3F] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Sell Stp
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Swissquote BBO Spread Tiers when available */}
      {dom.tiers && dom.tiers.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-[#1E2636]">
          <span>Swissquote Quote Liquidity Tiers:</span>
          <div className="flex flex-wrap items-center gap-3">
            {dom.tiers.map((t) => (
              <span key={t.profile}>
                <strong className="text-slate-700 dark:text-slate-200">{t.profile}</strong>{' '}
                {formatPrice(t.bid, dec)} / {formatPrice(t.ask, dec)} (
                {formatPrice(t.ask - t.bid, dec)})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
