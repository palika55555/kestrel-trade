import React, {useMemo, useState} from 'react';
import {Search} from 'lucide-react';
import {formatPrice} from '../services/tradingMath';
import type {AssetClass, Instrument} from '../types/trading';

interface MarketWatchlistProps {
  instruments: Instrument[];
  selectedSymbol: string;
  onSelectSymbol: (symbol: string) => void;
}

type FilterCategory = 'ALL' | 'FUTURES' | 'FX' | 'OTHER';

export const MarketWatchlist: React.FC<MarketWatchlistProps> = ({
  instruments,
  selectedSymbol,
  onSelectSymbol,
}) => {
  const [filter, setFilter] = useState<FilterCategory>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    return instruments.filter((inst) => {
      const matchesQuery =
        !query.trim() ||
        inst.symbol.toLowerCase().includes(query.toLowerCase()) ||
        inst.name.toLowerCase().includes(query.toLowerCase());
      if (!matchesQuery) return false;
      if (filter === 'ALL') return true;
      if (filter === 'FUTURES') {
        return inst.assetClass === 'FUTURES' || inst.assetClass === 'COMMODITY_FUTURES';
      }
      if (filter === 'FX') return inst.assetClass === 'FX_CFD';
      return inst.assetClass === 'INDEX_CFD' || inst.assetClass === 'CRYPTO_CFD';
    });
  }, [instruments, filter, query]);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
      <div className="p-3 border-b border-slate-200 dark:border-[#1E2636] space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Markets
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {instruments.length} contracts
          </span>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter symbol or asset..."
            aria-label="Filter instruments"
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0D1119]">
          {(
            [
              {id: 'ALL', label: 'All'},
              {id: 'FUTURES', label: 'Futures'},
              {id: 'FX', label: 'FX'},
              {id: 'OTHER', label: 'Idx / Crypto'},
            ] as {id: FilterCategory; label: string}[]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={`flex-1 py-1.5 px-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                filter === tab.id
                  ? 'bg-white dark:bg-[#1C2433] text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-[#1A2130]">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
            No matching instruments found.
          </div>
        ) : (
          filtered.map((inst) => {
            const active = inst.symbol === selectedSymbol;
            const up = inst.changePct >= 0;
            return (
              <button
                key={inst.symbol}
                type="button"
                onClick={() => onSelectSymbol(inst.symbol)}
                className={`w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 transition-colors min-h-[54px] cursor-pointer ${
                  active
                    ? 'bg-blue-50/70 dark:bg-blue-950/30'
                    : 'hover:bg-slate-50 dark:hover:bg-[#161D2A]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-semibold truncate ${
                        active
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {inst.symbol}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                      · {formatClassShort(inst.assetClass)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {inst.dataSource || inst.exchange} · {inst.maxLeverage}x max
                  </div>
                </div>

                {/* Mini Sparkline */}
                <Sparkline data={inst.sparkline} positive={up} />

                <div className="text-right shrink-0">
                  <div className="text-xs font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
                    {formatPrice(inst.price, inst.decimals)}
                  </div>
                  <div
                    className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                      up
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {up ? '+' : ''}
                    {inst.changePct.toFixed(2)}%
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

function formatClassShort(assetClass: AssetClass): string {
  switch (assetClass) {
    case 'FUTURES':
      return 'FUT';
    case 'COMMODITY_FUTURES':
      return 'CMDTY';
    case 'FX_CFD':
      return 'FX CFD';
    case 'INDEX_CFD':
      return 'IDX CFD';
    case 'CRYPTO_CFD':
      return 'CRYPTO';
  }
}

const Sparkline: React.FC<{data: number[]; positive: boolean}> = ({data, positive}) => {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 44;
  const h = 18;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible" aria-hidden="true">
      <polyline
        fill="none"
        stroke={positive ? '#10B981' : '#EF4444'}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
};
