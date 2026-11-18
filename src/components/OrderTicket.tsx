import React, {useEffect, useMemo, useState} from 'react';
import {AlertTriangle, Calculator, ShieldAlert} from 'lucide-react';
import {
  computeLiquidationPrice,
  computePositionNotional,
  computePositionSizeFromRisk,
  computeRequiredMargin,
  formatCurrency,
  formatPrice,
} from '../services/tradingMath';
import type {
  Instrument,
  OrderSide,
  OrderType,
  RiskSettings,
  StagedOrderPreset,
} from '../types/trading';

interface OrderTicketProps {
  instrument: Instrument;
  equity: number;
  freeMargin: number;
  riskSettings: RiskSettings;
  isOnline: boolean;
  externalLimitPrice?: number | null;
  stagedOrderPreset?: StagedOrderPreset | null;
  onSubmitOrder: (payload: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: number;
    triggerPrice?: number;
    leverage: number;
    stopLoss: number | null;
    takeProfit: number | null;
    trailingStopDistance: number | null;
  }) => void;
}

export const OrderTicket: React.FC<OrderTicketProps> = ({
  instrument,
  equity,
  freeMargin,
  riskSettings,
  isOnline,
  externalLimitPrice,
  stagedOrderPreset,
  onSubmitOrder,
}) => {
  const [orderType, setOrderType] = useState<OrderType>('MARKET');
  const [side, setSide] = useState<OrderSide>('BUY');
  const [sizingMode, setSizingMode] = useState<'UNITS' | 'RISK_PCT'>('UNITS');
  const [quantityInput, setQuantityInput] = useState<string>(
    instrument.contractType === 'FUTURE' ? '1' : '0.5',
  );
  const [riskPctInput, setRiskPctInput] = useState<string>(
    String(riskSettings.defaultRiskPct),
  );
  const [limitPriceInput, setLimitPriceInput] = useState<string>('');
  const [leverage, setLeverage] = useState<number>(Math.min(10, instrument.maxLeverage));
  const [slInput, setSlInput] = useState<string>('');
  const [tpInput, setTpInput] = useState<string>('');
  const [useTrailingStop, setUseTrailingStop] = useState<boolean>(false);
  const [trailingDistanceInput, setTrailingDistanceInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync defaults when instrument switches
  useEffect(() => {
    setQuantityInput(instrument.contractType === 'FUTURE' ? '1' : '0.5');
    setLeverage((prev) => Math.min(prev, instrument.maxLeverage));
    setLimitPriceInput(formatRaw(instrument.price, instrument.decimals));
    const defaultSlDist = instrument.price * 0.008;
    const defaultTpDist = instrument.price * 0.016;
    setSlInput(
      formatRaw(
        side === 'BUY' ? instrument.price - defaultSlDist : instrument.price + defaultSlDist,
        instrument.decimals,
      ),
    );
    setTpInput(
      formatRaw(
        side === 'BUY' ? instrument.price + defaultTpDist : instrument.price - defaultTpDist,
        instrument.decimals,
      ),
    );
    setTrailingDistanceInput(formatRaw(instrument.tickSize * 20, instrument.decimals));
    setErrorMsg(null);
  }, [instrument.symbol]);

  useEffect(() => {
    if (externalLimitPrice) {
      setOrderType('LIMIT');
      setLimitPriceInput(formatRaw(externalLimitPrice, instrument.decimals));
    }
  }, [externalLimitPrice, instrument.decimals]);

  useEffect(() => {
    if (!stagedOrderPreset || stagedOrderPreset.symbol !== instrument.symbol) return;
    setOrderType(stagedOrderPreset.type);
    setSide(stagedOrderPreset.side);
    if (stagedOrderPreset.triggerPrice !== undefined) {
      setLimitPriceInput(formatRaw(stagedOrderPreset.triggerPrice, instrument.decimals));
    }
    setSlInput(formatRaw(stagedOrderPreset.stopLoss, instrument.decimals));
    setTpInput(formatRaw(stagedOrderPreset.takeProfit, instrument.decimals));
    setErrorMsg(null);
  }, [stagedOrderPreset, instrument.symbol, instrument.decimals]);

  const entryPrice = useMemo(() => {
    if (orderType === 'MARKET') {
      return side === 'BUY' ? instrument.ask : instrument.bid;
    }
    const parsed = parseFloat(limitPriceInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : instrument.price;
  }, [orderType, side, instrument, limitPriceInput]);

  const slPrice = useMemo(() => {
    const v = parseFloat(slInput);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [slInput]);

  const tpPrice = useMemo(() => {
    const v = parseFloat(tpInput);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [tpInput]);

  const effectiveQuantity = useMemo(() => {
    if (sizingMode === 'RISK_PCT') {
      const rp = parseFloat(riskPctInput);
      if (!Number.isFinite(rp) || rp <= 0 || !slPrice) return 0;
      return computePositionSizeFromRisk(equity, rp, entryPrice, slPrice, instrument);
    }
    const q = parseFloat(quantityInput);
    return Number.isFinite(q) && q > 0 ? q : 0;
  }, [sizingMode, quantityInput, riskPctInput, equity, entryPrice, slPrice, instrument]);

  const notional = computePositionNotional(entryPrice, effectiveQuantity, instrument);
  const requiredMargin = computeRequiredMargin(
    entryPrice,
    effectiveQuantity,
    leverage,
    instrument,
  );
  const estLiquidation = computeLiquidationPrice(
    entryPrice,
    side,
    leverage,
    instrument,
  );
  const estFee = effectiveQuantity * instrument.commissionPerUnit;
  const marginAfter = freeMargin - requiredMargin - estFee;

  const riskReward = useMemo(() => {
    if (!slPrice || !tpPrice) return null;
    const riskDist = Math.abs(entryPrice - slPrice);
    const rewardDist = Math.abs(tpPrice - entryPrice);
    if (riskDist <= 0) return null;
    return rewardDist / riskDist;
  }, [entryPrice, slPrice, tpPrice]);

  const exposurePct = equity > 0 ? (requiredMargin / equity) * 100 : 0;
  const exceedsExposureCap = exposurePct > riskSettings.maxAssetExposurePct;

  const handleSubmit = (submitSide: OrderSide) => {
    setErrorMsg(null);
    if (!isOnline) {
      setErrorMsg('Live order routing is paused in Offline Mode.');
      return;
    }
    if (effectiveQuantity <= 0) {
      setErrorMsg('Enter a valid position size or Stop-Loss for risk-based sizing.');
      return;
    }
    if (requiredMargin + estFee > freeMargin) {
      setErrorMsg('Insufficient free margin for this order.');
      return;
    }
    if (slPrice !== null) {
      if (submitSide === 'BUY' && slPrice >= entryPrice) {
        setErrorMsg('Long Stop-Loss must be below entry price.');
        return;
      }
      if (submitSide === 'SELL' && slPrice <= entryPrice) {
        setErrorMsg('Short Stop-Loss must be above entry price.');
        return;
      }
    }
    if (tpPrice !== null) {
      if (submitSide === 'BUY' && tpPrice <= entryPrice) {
        setErrorMsg('Long Take-Profit must be above entry price.');
        return;
      }
      if (submitSide === 'SELL' && tpPrice >= entryPrice) {
        setErrorMsg('Short Take-Profit must be below entry price.');
        return;
      }
    }

    const trailDist = useTrailingStop ? parseFloat(trailingDistanceInput) || null : null;

    onSubmitOrder({
      symbol: instrument.symbol,
      side: submitSide,
      type: orderType,
      quantity: effectiveQuantity,
      triggerPrice: orderType === 'MARKET' ? undefined : entryPrice,
      leverage,
      stopLoss: slPrice,
      takeProfit: tpPrice,
      trailingStopDistance: trailDist,
    });
  };

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-3.5 space-y-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Order Ticket
        </h2>
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {instrument.symbol} · Max {instrument.maxLeverage}x
        </span>
      </div>

      {/* Order Type Segmented Control */}
      <div className="grid grid-cols-3 gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-[#0D1119]">
        {(['MARKET', 'LIMIT', 'STOP'] as OrderType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setOrderType(t)}
            className={`py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              orderType === t
                ? 'bg-white dark:bg-[#1C2433] text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t === 'MARKET' ? 'Market' : t === 'LIMIT' ? 'Limit' : 'Stop'}
          </button>
        ))}
      </div>

      {/* Side Selector */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setSide('BUY')}
          className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
            side === 'BUY'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-slate-50 dark:bg-[#0D1119] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#242E42]'
          }`}
        >
          Buy / Long
        </button>
        <button
          type="button"
          onClick={() => setSide('SELL')}
          className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
            side === 'SELL'
              ? 'bg-rose-600 text-white border-rose-600'
              : 'bg-slate-50 dark:bg-[#0D1119] text-slate-600 dark:text-slate-400 border-slate-200 dark:border-[#242E42]'
          }`}
        >
          Sell / Short
        </button>
      </div>

      {/* Trigger Price for Limit / Stop */}
      {orderType !== 'MARKET' && (
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            {orderType === 'LIMIT' ? 'Limit Price' : 'Stop Trigger Price'}
          </label>
          <input
            type="number"
            step={instrument.tickSize}
            value={limitPriceInput}
            onChange={(e) => setLimitPriceInput(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Position Size or Risk % Calculator */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {sizingMode === 'UNITS'
              ? `Quantity (${instrument.unitLabel})`
              : 'Risk % of Equity'}
          </label>
          <button
            type="button"
            onClick={() =>
              setSizingMode((m) => (m === 'UNITS' ? 'RISK_PCT' : 'UNITS'))
            }
            className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            <Calculator className="w-3 h-3" />
            <span>
              {sizingMode === 'UNITS' ? 'Use Risk % Sizer' : 'Use Fixed Units'}
            </span>
          </button>
        </div>

        {sizingMode === 'UNITS' ? (
          <div className="space-y-1.5">
            <input
              type="number"
              min={instrument.contractType === 'FUTURE' ? 1 : 0.01}
              step={instrument.contractType === 'FUTURE' ? 1 : 0.1}
              value={quantityInput}
              onChange={(e) => setQuantityInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <div className="grid grid-cols-4 gap-1">
              {(instrument.contractType === 'FUTURE'
                ? ['1', '2', '5', '10']
                : ['0.1', '0.5', '1', '2']
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQuantityInput(preset)}
                  className="py-1 text-[11px] font-mono rounded bg-slate-100 dark:bg-[#192130] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#232D40] cursor-pointer"
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1">
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.25}
              value={riskPctInput}
              onChange={(e) => setRiskPctInput(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              Computed Size: {effectiveQuantity} {instrument.unitLabel} (
              {formatCurrency((equity * (parseFloat(riskPctInput) || 0)) / 100)} max risk)
            </div>
          </div>
        )}
      </div>

      {/* Leverage Slider */}
      <div>
        <div className="flex items-center justify-between text-[11px] mb-1">
          <span className="text-slate-500 dark:text-slate-400">Leverage</span>
          <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
            {leverage}x
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={instrument.maxLeverage}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-blue-600 cursor-pointer"
        />
      </div>

      {/* Risk Management: Stop-Loss & Take-Profit */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Stop-Loss
          </label>
          <input
            type="number"
            step={instrument.tickSize}
            value={slInput}
            onChange={(e) => setSlInput(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-rose-500"
          />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
            Take-Profit
          </label>
          <input
            type="number"
            step={instrument.tickSize}
            value={tpInput}
            onChange={(e) => setTpInput(e.target.value)}
            placeholder="Optional"
            className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Trailing Stop Option */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={useTrailingStop}
            onChange={(e) => setUseTrailingStop(e.target.checked)}
            className="accent-blue-600"
          />
          <span>Trailing Stop</span>
        </label>
        {useTrailingStop && (
          <input
            type="number"
            step={instrument.tickSize}
            value={trailingDistanceInput}
            onChange={(e) => setTrailingDistanceInput(e.target.value)}
            aria-label="Trailing stop offset"
            className="w-28 rounded border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2 py-1 text-xs font-mono text-slate-900 dark:text-slate-100"
          />
        )}
      </div>

      {/* Pre-Trade Risk & Margin Impact Summary */}
      <div className="rounded-lg bg-slate-50 dark:bg-[#0D1119] border border-slate-200 dark:border-[#1E2636] p-2.5 space-y-1.5 text-[11px]">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Notional Value</span>
          <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCurrency(notional)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Initial Margin</span>
          <span className="font-mono font-medium text-slate-900 dark:text-slate-100 tabular-nums">
            {formatCurrency(requiredMargin)} ({exposurePct.toFixed(1)}%)
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Free Margin After</span>
          <span
            className={`font-mono tabular-nums ${
              marginAfter < 0
                ? 'text-rose-500'
                : 'text-slate-700 dark:text-slate-300'
            }`}
          >
            {formatCurrency(marginAfter)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Est. Liquidation</span>
          <span className="font-mono text-amber-600 dark:text-amber-400 tabular-nums">
            {formatPrice(estLiquidation, instrument.decimals)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Risk / Reward</span>
          <span className="font-mono text-slate-900 dark:text-slate-100 tabular-nums">
            {riskReward !== null ? `1 : ${riskReward.toFixed(2)}` : 'Set SL & TP'}
          </span>
        </div>
      </div>

      {exceedsExposureCap && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Margin exceeds your {riskSettings.maxAssetExposurePct}% single-position guardrail.
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[11px] text-rose-700 dark:text-rose-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Primary Execution CTA */}
      <button
        type="button"
        disabled={!isOnline}
        onClick={() => handleSubmit(side)}
        className={`w-full py-3 px-4 rounded-lg text-xs font-semibold text-white transition-colors min-h-[44px] disabled:opacity-45 cursor-pointer ${
          side === 'BUY'
            ? 'bg-emerald-600 hover:bg-emerald-700'
            : 'bg-rose-600 hover:bg-rose-700'
        }`}
      >
        {!isOnline
          ? 'Offline — Live Trading Paused'
          : `${orderType === 'MARKET' ? 'Execute' : 'Place'} ${
              side === 'BUY' ? 'Long' : 'Short'
            } @ ${formatPrice(entryPrice, instrument.decimals)}`}
      </button>
    </div>
  );
};

function formatRaw(val: number, decimals: number): string {
  return val.toFixed(decimals);
}
