import {computeRequiredMargin, createInitialSeedState, formatPrice} from '../../services/tradingMath';
import type {Candle, PendingOrder, Position, Timeframe, TradeExecution} from '../../types/trading';
import {evaluateBrowserBot} from './browserBotEngine';
import {evaluateOrbAutomation} from './orbAutomation';
import {evaluateOpenPositions} from './positionRiskEngine';
import type {InstrumentMap, MarketTickContext, MarketTickPayload} from './tickContext';

/**
 * Applies one live market snapshot: updates instruments and the live candle,
 * then runs the alert, ORB automation, position risk, pending order and
 * browser-bot engines in order. Any thrown error aborts the remaining steps
 * for this tick (malformed tick is ignored).
 */
export function processMarketTick(ctx: MarketTickContext, payload: MarketTickPayload) {
  const {
    setStreamConnected,
    setInstruments,
    setLastSyncedAt,
    hasSavedWorkspaceRef,
    anchoredLiveRef,
    setPositions,
    setPendingOrders,
    setExecutions,
    setPriceAlerts,
  } = ctx;
  try {
    if (!payload.instruments?.length) return;

    setStreamConnected(true);
    setInstruments(payload.instruments);
    setLastSyncedAt(payload.timestamp);

    if (!hasSavedWorkspaceRef.current && !anchoredLiveRef.current) {
      anchoredLiveRef.current = true;
      const liveSeed = createInitialSeedState(payload.instruments);
      setPositions(liveSeed.positions);
      setPendingOrders(liveSeed.pendingOrders);
      setExecutions(liveSeed.executions);
      setPriceAlerts(liveSeed.priceAlerts);
    }

    const instMap = new Map(payload.instruments.map((i) => [i.symbol, i]));

    updateLiveCandle(ctx, payload, instMap);
    evaluatePriceAlerts(ctx, payload, instMap);
    evaluateOrbAutomation(ctx, payload);
    evaluateOpenPositions(ctx, payload, instMap);
    evaluatePendingOrders(ctx, payload, instMap);
    evaluateBrowserBot(ctx, payload, instMap);
  } catch {
    // Ignore malformed tick
  }
}

function updateLiveCandle(
  ctx: MarketTickContext,
  payload: MarketTickPayload,
  instMap: InstrumentMap,
) {
  const {selectedSymbolRef, timeframeRef, setCandles} = ctx;
  // Update current live candle on chart
  const activeInst = instMap.get(selectedSymbolRef.current);
  if (activeInst) {
    const tfSecondsMap: Record<Timeframe, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1H': 3600,
      '4H': 14400,
      '1D': 86400,
    };
    const tfSec = tfSecondsMap[timeframeRef.current];
    const bucket = Math.floor(payload.timestamp / 1000 / tfSec) * tfSec;
    setCandles((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.time === bucket) {
        const updated: Candle = {
          ...last,
          close: activeInst.price,
          high: Math.max(last.high, activeInst.price),
          low: Math.min(last.low, activeInst.price),
        };
        return [...prev.slice(0, -1), updated];
      }
      return [
        ...prev.slice(-240),
        {
          time: bucket,
          open: last.close,
          high: activeInst.price,
          low: activeInst.price,
          close: activeInst.price,
          volume: 20,
        },
      ];
    });
  }
}

function evaluatePriceAlerts(
  ctx: MarketTickContext,
  payload: MarketTickPayload,
  instMap: InstrumentMap,
) {
  const {priceAlertsRef, setPriceAlerts, emitNotification} = ctx;
  // 1. Evaluate Price Alerts
  const currentAlerts = priceAlertsRef.current;
  let alertsChanged = false;
  const nextAlerts = currentAlerts.map((al) => {
    if (!al.active) return al;
    const inst = instMap.get(al.symbol);
    if (!inst) return al;
    const hit =
      (al.condition === 'ABOVE' && inst.price >= al.targetPrice) ||
      (al.condition === 'BELOW' && inst.price <= al.targetPrice);
    if (hit) {
      alertsChanged = true;
      emitNotification(
        `Price Alert: ${al.symbol}`,
        `${al.symbol} crossed ${al.condition === 'ABOVE' ? 'above' : 'below'} ${formatPrice(
          al.targetPrice,
          inst.decimals,
        )} (Last: ${formatPrice(inst.price, inst.decimals)})${
          al.note ? ` · ${al.note}` : ''
        }`,
        'PRICE_ALERT',
        al.symbol,
        'alert',
      );
      return {...al, active: false, triggeredAt: payload.timestamp};
    }
    return al;
  });
  if (alertsChanged) {
    setPriceAlerts(nextAlerts);
  }
}

function evaluatePendingOrders(
  ctx: MarketTickContext,
  payload: MarketTickPayload,
  instMap: InstrumentMap,
) {
  const {
    pendingOrdersRef,
    setPendingOrders,
    setPositions,
    setExecutions,
    setCashBalance,
    emitNotification,
  } = ctx;
  // 3. Evaluate Pending Limit / Stop Orders
  const curPending = pendingOrdersRef.current;
  if (curPending.length > 0) {
    const stillPending: PendingOrder[] = [];
    const newPositions: Position[] = [];
    const newExecs: TradeExecution[] = [];
    let feeDelta = 0;

    for (const ord of curPending) {
      const inst = instMap.get(ord.symbol);
      if (!inst) {
        stillPending.push(ord);
        continue;
      }
      const execPrice = ord.side === 'BUY' ? inst.ask : inst.bid;
      const shouldFill =
        (ord.type === 'LIMIT' &&
          ((ord.side === 'BUY' && execPrice <= ord.triggerPrice) ||
            (ord.side === 'SELL' && execPrice >= ord.triggerPrice))) ||
        (ord.type === 'STOP' &&
          ((ord.side === 'BUY' && execPrice >= ord.triggerPrice) ||
            (ord.side === 'SELL' && execPrice <= ord.triggerPrice)));

      if (shouldFill) {
        const marginUsed = computeRequiredMargin(
          execPrice,
          ord.quantity,
          ord.leverage,
          inst,
        );
        const fee = Number((ord.quantity * inst.commissionPerUnit).toFixed(2));
        feeDelta += fee;
        newPositions.push({
          id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: ord.symbol,
          side: ord.side,
          quantity: ord.quantity,
          entryPrice: execPrice,
          leverage: ord.leverage,
          marginUsed,
          stopLoss: ord.stopLoss,
          takeProfit: ord.takeProfit,
          trailingStopDistance: null,
          peakFavorablePrice: execPrice,
          openedAt: payload.timestamp,
          commissionPaid: fee,
        });
        newExecs.push({
          id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: ord.symbol,
          side: ord.side,
          action: 'OPEN',
          quantity: ord.quantity,
          price: execPrice,
          realizedPnl: 0,
          fee,
          timestamp: payload.timestamp,
          notes: `${ord.type} order filled`,
        });
        emitNotification(
          `${ord.type} Order Filled: ${ord.symbol}`,
          `${ord.side} ${ord.quantity} @ ${formatPrice(execPrice, inst.decimals)}`,
          'EXECUTION',
          ord.symbol,
          'fill',
        );
      } else {
        stillPending.push(ord);
      }
    }

    if (newPositions.length > 0) {
      setPendingOrders(stillPending);
      setPositions((prev) => [...newPositions, ...prev]);
      setExecutions((prev) => [...newExecs, ...prev]);
      setCashBalance((c) => Number((c - feeDelta).toFixed(2)));
    }
  }
}
