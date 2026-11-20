import {useCallback, type Dispatch, type SetStateAction} from 'react';
import type {
  AppendBotLog,
  EmitNotification,
  RecordClosedBotTrades,
} from '../features/market/tickContext';
import type {PendingOrderPayload} from '../lib/orderPayload';
import {
  computeRequiredMargin,
  computeUnrealizedPnl,
  formatCurrency,
  formatPrice,
} from '../services/tradingMath';
import type {
  ExecutionAction,
  Instrument,
  OrderSide,
  PendingOrder,
  Position,
  RiskSettings,
  SecurityState,
  ServerBotState,
  TradeExecution,
  XauBotConfig,
  XauBotTradeRecord,
} from '../types/trading';

interface TradeActionDeps {
  isOnline: boolean;
  instrumentsMap: Map<string, Instrument>;
  selectedInstrument: Instrument | null;
  positions: Position[];
  riskSettings: RiskSettings;
  securityState: SecurityState;
  serverBotState: ServerBotState | null;
  xauBotConfig: XauBotConfig;
  setPositions: Dispatch<SetStateAction<Position[]>>;
  setPendingOrders: Dispatch<SetStateAction<PendingOrder[]>>;
  setExecutions: Dispatch<SetStateAction<TradeExecution[]>>;
  setCashBalance: Dispatch<SetStateAction<number>>;
  setServerBotState: Dispatch<SetStateAction<ServerBotState | null>>;
  setPendingBiometricOrder: Dispatch<SetStateAction<PendingOrderPayload | null>>;
  emitNotification: EmitNotification;
  appendBotLog: AppendBotLog;
  recordClosedBotTradesAndLearn: RecordClosedBotTrades;
}

/**
 * Order execution core plus position management actions (quick trade,
 * close / partial close, flatten all, SL/TP edits) for both the local paper
 * ledger and 24/7 server bot positions.
 */
export function useTradeActions({
  isOnline,
  instrumentsMap,
  selectedInstrument,
  positions,
  riskSettings,
  securityState,
  serverBotState,
  xauBotConfig,
  setPositions,
  setPendingOrders,
  setExecutions,
  setCashBalance,
  setServerBotState,
  setPendingBiometricOrder,
  emitNotification,
  appendBotLog,
  recordClosedBotTradesAndLearn,
}: TradeActionDeps) {
  // Order Execution Core
  const executeOrderInternal = useCallback(
    (payload: PendingOrderPayload) => {
      const inst = instrumentsMap.get(payload.symbol);
      if (!inst) return;

      if (payload.type === 'MARKET') {
        const fillPrice = payload.side === 'BUY' ? inst.ask : inst.bid;
        const marginUsed = computeRequiredMargin(
          fillPrice,
          payload.quantity,
          payload.leverage,
          inst,
        );
        const fee = Number((payload.quantity * inst.commissionPerUnit).toFixed(2));
        const newPos: Position = {
          id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: payload.symbol,
          side: payload.side,
          quantity: payload.quantity,
          entryPrice: fillPrice,
          leverage: payload.leverage,
          marginUsed,
          stopLoss: payload.stopLoss,
          takeProfit: payload.takeProfit,
          trailingStopDistance: payload.trailingStopDistance,
          peakFavorablePrice: fillPrice,
          openedAt: Date.now(),
          commissionPaid: fee,
          source: payload.source,
          botStrategy: payload.botStrategy,
          botConfidence: payload.botConfidence,
        };
        const exec: TradeExecution = {
          id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: payload.symbol,
          side: payload.side,
          action: 'OPEN',
          quantity: payload.quantity,
          price: fillPrice,
          realizedPnl: 0,
          fee,
          timestamp: Date.now(),
          source: payload.source,
          notes:
            payload.note ||
            (payload.source === 'XAU_BOT'
              ? 'XAU/USD Auto Bot execution'
              : 'Instant market fill'),
        };
        setPositions((prev) => [newPos, ...prev]);
        setExecutions((prev) => [exec, ...prev]);
        setCashBalance((c) => Number((c - fee).toFixed(2)));
        emitNotification(
          `${payload.source === 'XAU_BOT' ? 'XAU Bot ' : 'Executed '}${payload.side} ${
            payload.symbol
          }`,
          `Filled ${payload.quantity} ${inst.unitLabel} @ ${formatPrice(
            fillPrice,
            inst.decimals,
          )}`,
          'EXECUTION',
          payload.symbol,
          'fill',
        );
      } else {
        const ord: PendingOrder = {
          id: `ord-${Date.now()}`,
          symbol: payload.symbol,
          side: payload.side,
          type: payload.type,
          quantity: payload.quantity,
          triggerPrice: payload.triggerPrice || inst.price,
          leverage: payload.leverage,
          stopLoss: payload.stopLoss,
          takeProfit: payload.takeProfit,
          createdAt: Date.now(),
        };
        setPendingOrders((prev) => [ord, ...prev]);
        emitNotification(
          `${payload.type} Order Placed: ${payload.symbol}`,
          `${payload.side} ${payload.quantity} @ ${formatPrice(
            ord.triggerPrice,
            inst.decimals,
          )}`,
          'EXECUTION',
          payload.symbol,
          'alert',
        );
      }
    },
    [instrumentsMap, emitNotification],
  );

  const handleSubmitOrder = (payload: PendingOrderPayload) => {
    if (
      riskSettings.requireBiometricForOrders &&
      (securityState.biometricEnrolled || securityState.pinConfigured)
    ) {
      setPendingBiometricOrder(payload);
      return;
    }
    executeOrderInternal(payload);
  };

  const handleQuickTrade = (side: OrderSide) => {
    if (!selectedInstrument || !isOnline) return;
    const qty = selectedInstrument.contractType === 'FUTURE' ? 1 : 0.25;
    const lev = Math.min(10, selectedInstrument.maxLeverage);
    const slDist = selectedInstrument.price * 0.008;
    const tpDist = selectedInstrument.price * 0.016;
    const factor = Math.pow(10, selectedInstrument.decimals);
    const sl =
      Math.round(
        (side === 'BUY'
          ? selectedInstrument.price - slDist
          : selectedInstrument.price + slDist) * factor,
      ) / factor;
    const tp =
      Math.round(
        (side === 'BUY'
          ? selectedInstrument.price + tpDist
          : selectedInstrument.price - tpDist) * factor,
      ) / factor;

    handleSubmitOrder({
      symbol: selectedInstrument.symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      leverage: lev,
      stopLoss: sl,
      takeProfit: tp,
      trailingStopDistance: null,
    });
  };

  const handleClosePosition = async (positionId: string, fraction = 1) => {
    const serverPos = serverBotState?.positions.find((p) => p.id === positionId);
    if (serverPos || positionId.startsWith('sbpos-')) {
      try {
        const res = await fetch(`/api/bot/close/${encodeURIComponent(positionId)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({fraction}),
        });
        if (res.ok) {
          const updated = (await res.json()) as ServerBotState;
          setServerBotState(updated);
          if (serverPos) {
            emitNotification(
              `Closed ${serverPos.symbol}`,
              `24/7 Bot ${serverPos.side} ${fraction >= 1 ? serverPos.quantity : '50%'} closed`,
              'EXECUTION',
              serverPos.symbol,
              'fill',
            );
          }
        }
      } catch {
        // Ignore transient network errors
      }
      return;
    }

    const pos = positions.find((p) => p.id === positionId);
    if (!pos) return;
    const inst = instrumentsMap.get(pos.symbol);
    if (!inst) return;

    const closeQty =
      fraction >= 1
        ? pos.quantity
        : inst.contractType === 'FUTURE'
        ? Math.max(1, Math.floor(pos.quantity * fraction))
        : Number((pos.quantity * fraction).toFixed(2));

    const actualFraction = Math.min(1, closeQty / pos.quantity);
    const fullPnl = computeUnrealizedPnl(pos, inst);
    const realizedPnl = Number((fullPnl * actualFraction).toFixed(2));
    const exitPrice = pos.side === 'BUY' ? inst.bid : inst.ask;
    const fee = Number((closeQty * inst.commissionPerUnit).toFixed(2));

    if (actualFraction >= 0.999) {
      setPositions((prev) => prev.filter((p) => p.id !== positionId));
    } else {
      setPositions((prev) =>
        prev.map((p) =>
          p.id === positionId
            ? {
                ...p,
                quantity: Number((p.quantity - closeQty).toFixed(4)),
                marginUsed: p.marginUsed * (1 - actualFraction),
              }
            : p,
        ),
      );
    }

    setCashBalance((c) => Number((c + realizedPnl - fee).toFixed(2)));
    const closedAt = Date.now();
    const exitAction: ExecutionAction =
      actualFraction >= 0.999 ? 'CLOSE' : 'PARTIAL_CLOSE';

    setExecutions((prev) => [
      {
        id: `exec-${closedAt}-${Math.random().toString(36).slice(2, 6)}`,
        symbol: pos.symbol,
        side: pos.side,
        action: exitAction,
        quantity: closeQty,
        price: exitPrice,
        realizedPnl,
        fee,
        timestamp: closedAt,
        source: pos.source,
        notes: actualFraction >= 0.999 ? 'Manual full close' : 'Partial close',
      },
      ...prev,
    ]);

    if (pos.source === 'XAU_BOT') {
      const roundTripFee = Number(
        ((pos.commissionPaid || 0) * actualFraction + fee).toFixed(2),
      );
      const netPnl = Number((realizedPnl - roundTripFee).toFixed(2));
      const record: XauBotTradeRecord = {
        id: `btr-${closedAt}-${Math.random().toString(36).slice(2, 6)}`,
        positionId: pos.id,
        symbol: pos.symbol,
        side: pos.side,
        strategy: pos.botStrategy || xauBotConfig.strategy,
        quantity: closeQty,
        entryPrice: pos.entryPrice,
        exitPrice,
        grossPnl: realizedPnl,
        fee: roundTripFee,
        netPnl,
        exitAction,
        confidenceAtEntry: pos.botConfidence ?? 70,
        stopLossDollars: xauBotConfig.stopLossDollars,
        takeProfitDollars: xauBotConfig.takeProfitDollars,
        openedAt: pos.openedAt,
        closedAt,
      };
      recordClosedBotTradesAndLearn([record]);
      appendBotLog(
        netPnl >= 0 ? 'EXECUTION' : 'RISK',
        `Closed ${pos.side} ${closeQty} XAU/USD (Manual) -> ${
          netPnl >= 0 ? '+' : ''
        }${formatCurrency(netPnl)} net`,
      );
    }

    emitNotification(
      `Closed ${pos.symbol}`,
      `${closeQty} ${pos.side} @ ${formatPrice(exitPrice, inst.decimals)} · P&L ${
        realizedPnl >= 0 ? '+' : ''
      }${formatCurrency(realizedPnl)}`,
      'EXECUTION',
      pos.symbol,
      'fill',
    );
  };

  const handleFlattenAll = async () => {
    positions.forEach((p) => void handleClosePosition(p.id, 1));
    if ((serverBotState?.positions.length ?? 0) > 0) {
      try {
        const res = await fetch('/api/bot/close-all', {method: 'POST'});
        if (res.ok) {
          setServerBotState((await res.json()) as ServerBotState);
        }
      } catch {
        // Ignore transient network errors
      }
    }
  };

  const handleUpdatePositionRisk = async (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) => {
    if (
      serverBotState?.positions.some((p) => p.id === positionId) ||
      positionId.startsWith('sbpos-')
    ) {
      try {
        const res = await fetch(`/api/bot/risk/${encodeURIComponent(positionId)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({stopLoss, takeProfit}),
        });
        if (res.ok) {
          setServerBotState((await res.json()) as ServerBotState);
        }
      } catch {
        // Ignore transient network errors
      }
      return;
    }
    setPositions((prev) =>
      prev.map((p) =>
        p.id === positionId ? {...p, stopLoss, takeProfit} : p,
      ),
    );
  };

  return {
    executeOrderInternal,
    handleSubmitOrder,
    handleQuickTrade,
    handleClosePosition,
    handleFlattenAll,
    handleUpdatePositionRisk,
  };
}

export type TradeActions = ReturnType<typeof useTradeActions>;
