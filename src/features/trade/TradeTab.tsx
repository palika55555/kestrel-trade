import React, {type Dispatch, type SetStateAction} from 'react';
import {AdvancedChart} from '../../components/AdvancedChart';
import {MarketWatchlist} from '../../components/MarketWatchlist';
import {OrderBookDepth} from '../../components/OrderBookDepth';
import {OrderTicket} from '../../components/OrderTicket';
import {PositionsBlotter} from '../../components/PositionsBlotter';
import type {DerivedTradingData} from '../../hooks/useDerivedTradingData';
import type {TradeActions} from '../../hooks/useTradeActions';
import type {
  Candle,
  ChartDrawing,
  Instrument,
  MarketPrint,
  PendingOrder,
  PriceAlert,
  RiskSettings,
  StagedOrderPreset,
  Timeframe,
} from '../../types/trading';
import {CenterStrategyPanel, type CenterStrategyPanelProps} from './CenterStrategyPanel';
import type {MobileTradePanel} from './types';

interface TradeTabProps {
  derived: DerivedTradingData;
  tradeActions: TradeActions;
  centerPanelProps: Omit<CenterStrategyPanelProps, 'selectedInstrument'>;
  instruments: Instrument[];
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
  mobileTradePanel: MobileTradePanel;
  setMobileTradePanel: Dispatch<SetStateAction<MobileTradePanel>>;
  candles: Candle[];
  timeframe: Timeframe;
  setTimeframe: Dispatch<SetStateAction<Timeframe>>;
  priceAlerts: PriceAlert[];
  drawings: ChartDrawing[];
  setDrawings: Dispatch<SetStateAction<ChartDrawing[]>>;
  isOnline: boolean;
  isDark: boolean;
  riskSettings: RiskSettings;
  externalLimitPrice: number | null;
  setExternalLimitPrice: Dispatch<SetStateAction<number | null>>;
  stagedOrderPreset: StagedOrderPreset | null;
  setStagedOrderPreset: Dispatch<SetStateAction<StagedOrderPreset | null>>;
  recentPrints: MarketPrint[];
  pendingOrders: PendingOrder[];
  setPendingOrders: Dispatch<SetStateAction<PendingOrder[]>>;
}

/** Trade tab: watchlist, chart, strategy panels, order ticket/depth and blotter. */
export function TradeTab({
  derived,
  tradeActions,
  centerPanelProps,
  instruments,
  setSelectedSymbol,
  mobileTradePanel,
  setMobileTradePanel,
  candles,
  timeframe,
  setTimeframe,
  priceAlerts,
  drawings,
  setDrawings,
  isOnline,
  isDark,
  riskSettings,
  externalLimitPrice,
  setExternalLimitPrice,
  stagedOrderPreset,
  setStagedOrderPreset,
  recentPrints,
  pendingOrders,
  setPendingOrders,
}: TradeTabProps) {
  const {
    selectedInstrument,
    allPositions,
    allExecutions,
    activeOrbAnalysis,
    orderFlowSnapshot,
    instrumentsMap,
    equity,
    freeMargin,
  } = derived;
  const {
    handleQuickTrade,
    handleSubmitOrder,
    handleClosePosition,
    handleUpdatePositionRisk,
    handleFlattenAll,
  } = tradeActions;

  return (
    <div className="space-y-4">
      {/* Mobile Sub-switcher within Trade view */}
      <div className="lg:hidden grid grid-cols-3 gap-1 p-1 rounded-xl bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636]">
        {(
          [
            {id: 'CHART', label: 'Chart'},
            {id: 'MARKETS', label: 'Markets'},
            {id: 'ORDER', label: 'Order Ticket'},
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setMobileTradePanel(t.id)}
            className={`py-2 text-xs font-medium rounded-lg min-h-[40px] cursor-pointer ${
              mobileTradePanel === t.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {selectedInstrument ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Watchlist */}
          <div
            className={`lg:col-span-3 lg:h-[640px] ${
              mobileTradePanel === 'MARKETS' ? 'block' : 'hidden lg:block'
            }`}
          >
            <MarketWatchlist
              instruments={instruments}
              selectedSymbol={selectedInstrument.symbol}
              onSelectSymbol={(sym) => {
                setSelectedSymbol(sym);
                setMobileTradePanel('CHART');
              }}
            />
          </div>

          {/* Center Chart + ORB Long/Short Analyzer */}
          <div
            className={`lg:col-span-6 space-y-4 ${
              mobileTradePanel === 'CHART' ? 'block' : 'hidden lg:block'
            }`}
          >
            <AdvancedChart
              instrument={selectedInstrument}
              candles={candles}
              timeframe={timeframe}
              onChangeTimeframe={setTimeframe}
              positions={allPositions}
              alerts={priceAlerts}
              orbAnalysis={activeOrbAnalysis}
              drawings={drawings}
              onAddDrawing={(d) => setDrawings((prev) => [...prev, d])}
              onClearDrawings={(sym) =>
                setDrawings((prev) => prev.filter((d) => d.symbol !== sym))
              }
              onQuickTrade={handleQuickTrade}
              isOnline={isOnline}
              isDark={isDark}
            />

            <CenterStrategyPanel {...centerPanelProps} selectedInstrument={selectedInstrument} />
          </div>

          {/* Right Order Ticket + Order Book Depth */}
          <div
            className={`lg:col-span-3 space-y-4 ${
              mobileTradePanel === 'ORDER' ? 'block' : 'hidden lg:block'
            }`}
          >
            <OrderTicket
              instrument={selectedInstrument}
              equity={equity}
              freeMargin={freeMargin}
              riskSettings={riskSettings}
              isOnline={isOnline}
              externalLimitPrice={externalLimitPrice}
              stagedOrderPreset={stagedOrderPreset}
              onSubmitOrder={handleSubmitOrder}
            />
            <OrderBookDepth
              instrument={selectedInstrument}
              recentPrints={recentPrints}
              orderFlow={orderFlowSnapshot}
              onSelectPrice={(p) => {
                setExternalLimitPrice(p);
                setMobileTradePanel('ORDER');
              }}
              onStageOrder={(preset) => {
                setStagedOrderPreset(preset);
                setMobileTradePanel('ORDER');
              }}
            />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-[#1E2636] bg-white dark:bg-[#121721] p-10 text-center text-xs text-slate-500">
          Connecting to real-time CFD & Futures market stream...
        </div>
      )}

      {/* Full-Width Positions & Blotter */}
      <PositionsBlotter
        positions={allPositions}
        pendingOrders={pendingOrders}
        executions={allExecutions}
        instrumentsMap={instrumentsMap}
        isOnline={isOnline}
        onSelectSymbol={(sym) => {
          setSelectedSymbol(sym);
          setMobileTradePanel('CHART');
        }}
        onClosePosition={handleClosePosition}
        onUpdatePositionRisk={handleUpdatePositionRisk}
        onCancelPendingOrder={(id) =>
          setPendingOrders((prev) => prev.filter((o) => o.id !== id))
        }
        onFlattenAll={handleFlattenAll}
      />
    </div>
  );
}
