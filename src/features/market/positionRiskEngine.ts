import {computeUnrealizedPnl, formatCurrency, formatPrice} from '../../services/tradingMath';
import {shouldEarlyExitPosition} from '../../services/xauBot';
import type {
  ExecutionAction,
  Position,
  TradeExecution,
  XauBotTradeRecord,
} from '../../types/trading';
import type {InstrumentMap, MarketTickContext, MarketTickPayload} from './tickContext';

/**
 * Evaluates open positions on each tick: trailing stops, XAU bot auto
 * break-even / partial take-profit, stop-loss & take-profit fills, and the
 * margin level warning.
 */
export function evaluateOpenPositions(
  ctx: MarketTickContext,
  payload: MarketTickPayload,
  instMap: InstrumentMap,
) {
  const {
    positionsRef,
    xauBotConfigRef,
    cashBalanceRef,
    riskSettingsRef,
    marginWarnedRef,
    latestXauEvalRef,
    setPositions,
    setCashBalance,
    setExecutions,
    appendBotLog,
    emitNotification,
    recordClosedBotTradesAndLearn,
  } = ctx;
  // 2. Evaluate Open Positions (Trailing Stop, Stop-Loss, Take-Profit)
  const currentPositions = positionsRef.current;
  if (currentPositions.length > 0) {
    const remaining: Position[] = [];
    const triggeredExecs: TradeExecution[] = [];
    const triggeredBotTrades: XauBotTradeRecord[] = [];
    let cashDelta = 0;
    let modified = false;

    for (const pos of currentPositions) {
      const inst = instMap.get(pos.symbol);
      if (!inst) {
        remaining.push(pos);
        continue;
      }
      const exitMark = pos.side === 'BUY' ? inst.bid : inst.ask;
      let updatedPos = pos;

      // Update Trailing Stop
      if (pos.trailingStopDistance && pos.trailingStopDistance > 0) {
        if (pos.side === 'BUY' && exitMark > pos.peakFavorablePrice) {
          const newSl = Number(
            (exitMark - pos.trailingStopDistance).toFixed(inst.decimals),
          );
          updatedPos = {
            ...pos,
            peakFavorablePrice: exitMark,
            stopLoss: pos.stopLoss ? Math.max(pos.stopLoss, newSl) : newSl,
          };
          modified = true;
        } else if (pos.side === 'SELL' && exitMark < pos.peakFavorablePrice) {
          const newSl = Number(
            (exitMark + pos.trailingStopDistance).toFixed(inst.decimals),
          );
          updatedPos = {
            ...pos,
            peakFavorablePrice: exitMark,
            stopLoss: pos.stopLoss ? Math.min(pos.stopLoss, newSl) : newSl,
          };
          modified = true;
        }
      }

      // 2a. Auto Break-Even & 50% Partial Take-Profit for XAU Bot positions
      if (
        updatedPos.source === 'XAU_BOT' &&
        updatedPos.takeProfit !== null
      ) {
        const tpDist = Math.abs(updatedPos.takeProfit - updatedPos.entryPrice);
        const favMove =
          updatedPos.side === 'BUY'
            ? exitMark - updatedPos.entryPrice
            : updatedPos.entryPrice - exitMark;

        // Auto Break-Even at 50% progress toward Take-Profit
        if (
          (xauBotConfigRef.current.autoBreakEvenEnabled ?? true) &&
          !updatedPos.breakEvenMoved &&
          tpDist > 0 &&
          favMove >= tpDist * 0.5
        ) {
          const beSl = Number(
            (updatedPos.side === 'BUY'
              ? updatedPos.entryPrice + 0.35
              : updatedPos.entryPrice - 0.35
            ).toFixed(inst.decimals),
          );
          const tighterSl =
            updatedPos.side === 'BUY'
              ? updatedPos.stopLoss !== null
                ? Math.max(updatedPos.stopLoss, beSl)
                : beSl
              : updatedPos.stopLoss !== null
              ? Math.min(updatedPos.stopLoss, beSl)
              : beSl;
          updatedPos = {
            ...updatedPos,
            stopLoss: tighterSl,
            breakEvenMoved: true,
          };
          modified = true;
          appendBotLog(
            'RISK',
            `Auto Break-Even locked SL @ ${formatPrice(
              tighterSl,
              inst.decimals,
            )} on ${updatedPos.side} XAU/USD (+50% TP reached).`,
          );
        }

        // Partial Take-Profit (close 50% at 70% progress toward TP, keep remainder risk-free)
        if (
          (xauBotConfigRef.current.partialTpEnabled ?? true) &&
          !updatedPos.partialTpTaken &&
          updatedPos.quantity >= 0.04 &&
          tpDist > 0 &&
          favMove >= tpDist * 0.7
        ) {
          const closeQty = Number((updatedPos.quantity * 0.5).toFixed(2));
          const remQty = Number((updatedPos.quantity - closeQty).toFixed(2));
          if (closeQty > 0 && remQty > 0) {
            const fullPnl = computeUnrealizedPnl(updatedPos, inst);
            const partialRatio = closeQty / updatedPos.quantity;
            const partialPnl = Number((fullPnl * partialRatio).toFixed(2));
            const partialCloseFee = Number(
              (closeQty * inst.commissionPerUnit).toFixed(2),
            );
            const entryFeeShare = Number(
              ((updatedPos.commissionPaid || 0) * partialRatio).toFixed(2),
            );
            const partialNet = Number(
              (partialPnl - partialCloseFee - entryFeeShare).toFixed(2),
            );
            cashDelta += partialPnl - partialCloseFee;

            triggeredExecs.push({
              id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              symbol: updatedPos.symbol,
              side: updatedPos.side,
              action: 'PARTIAL_CLOSE',
              quantity: closeQty,
              price: exitMark,
              realizedPnl: partialPnl,
              fee: partialCloseFee,
              timestamp: payload.timestamp,
              source: 'XAU_BOT',
              notes: 'XAU Bot Partial TP (50% scale-out @ 70% target)',
            });
            triggeredBotTrades.push({
              id: `btr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              positionId: `${updatedPos.id}-ptp`,
              symbol: updatedPos.symbol,
              side: updatedPos.side,
              strategy: updatedPos.botStrategy || xauBotConfigRef.current.strategy,
              quantity: closeQty,
              entryPrice: updatedPos.entryPrice,
              exitPrice: exitMark,
              grossPnl: partialPnl,
              fee: Number((entryFeeShare + partialCloseFee).toFixed(2)),
              netPnl: partialNet,
              exitAction: 'PARTIAL_CLOSE',
              confidenceAtEntry: updatedPos.botConfidence ?? 70,
              stopLossDollars: xauBotConfigRef.current.stopLossDollars,
              takeProfitDollars: xauBotConfigRef.current.takeProfitDollars,
              openedAt: updatedPos.openedAt,
              closedAt: payload.timestamp,
            });

            const beSl = Number(
              (updatedPos.side === 'BUY'
                ? updatedPos.entryPrice + 0.35
                : updatedPos.entryPrice - 0.35
              ).toFixed(inst.decimals),
            );
            const safeSl =
              updatedPos.side === 'BUY'
                ? updatedPos.stopLoss !== null
                  ? Math.max(updatedPos.stopLoss, beSl)
                  : beSl
                : updatedPos.stopLoss !== null
                ? Math.min(updatedPos.stopLoss, beSl)
                : beSl;

            updatedPos = {
              ...updatedPos,
              quantity: remQty,
              marginUsed: Number(
                (updatedPos.marginUsed * (1 - partialRatio)).toFixed(2),
              ),
              commissionPaid: Number(
                ((updatedPos.commissionPaid || 0) * (1 - partialRatio)).toFixed(2),
              ),
              stopLoss: safeSl,
              breakEvenMoved: true,
              partialTpTaken: true,
            };
            modified = true;

            appendBotLog(
              'EXECUTION',
              `Partial TP booked 50% (${closeQty} lots ${updatedPos.side}) @ ${formatPrice(
                exitMark,
                inst.decimals,
              )} -> +${formatCurrency(partialNet)} net; ${remQty} lots running risk-free.`,
            );
            emitNotification(
              `Partial TP Booked: ${updatedPos.symbol}`,
              `Closed ${closeQty} ${updatedPos.side} @ ${formatPrice(
                exitMark,
                inst.decimals,
              )} (+${formatCurrency(partialPnl)}) · Runner protected @ BE.`,
              'TAKE_PROFIT',
              updatedPos.symbol,
              'fill',
            );
          }
        }
      }

      let triggerAction: ExecutionAction | null = null;
      if (updatedPos.stopLoss !== null) {
        const hitSL =
          (updatedPos.side === 'BUY' && exitMark <= updatedPos.stopLoss) ||
          (updatedPos.side === 'SELL' && exitMark >= updatedPos.stopLoss);
        if (hitSL) {
          triggerAction = updatedPos.trailingStopDistance
            ? 'TRAILING_STOP'
            : 'STOP_LOSS';
        }
      }

      if (!triggerAction && updatedPos.takeProfit !== null) {
        const hitTP =
          (updatedPos.side === 'BUY' && exitMark >= updatedPos.takeProfit) ||
          (updatedPos.side === 'SELL' && exitMark <= updatedPos.takeProfit);
        if (hitTP) triggerAction = 'TAKE_PROFIT';
      }

      if (
        !triggerAction &&
        updatedPos.source === 'XAU_BOT' &&
        updatedPos.symbol === 'XAU/USD'
      ) {
        const earlyRes = shouldEarlyExitPosition(
          updatedPos,
          exitMark,
          inst.contractSize,
          latestXauEvalRef.current,
          xauBotConfigRef.current.staleTradeMinutes ?? 45,
          payload.timestamp,
        );
        if (earlyRes.exit) {
          triggerAction = 'EARLY_EXIT';
        }
      }

      if (triggerAction) {
        modified = true;
        const pnl = computeUnrealizedPnl(updatedPos, inst);
        const fee = Number((updatedPos.quantity * inst.commissionPerUnit).toFixed(2));
        cashDelta += pnl - fee;

        triggeredExecs.push({
          id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          symbol: updatedPos.symbol,
          side: updatedPos.side,
          action: triggerAction,
          quantity: updatedPos.quantity,
          price: exitMark,
          realizedPnl: Number(pnl.toFixed(2)),
          fee,
          timestamp: payload.timestamp,
          source: updatedPos.source,
          notes:
            updatedPos.source === 'XAU_BOT'
              ? `XAU Bot ${triggerAction === 'TAKE_PROFIT' ? 'Take-Profit' : 'Stop-Loss'}`
              : triggerAction === 'TAKE_PROFIT'
              ? 'Automated Take-Profit fill'
              : 'Automated Stop-Loss trigger',
        });

        if (updatedPos.source === 'XAU_BOT') {
          const roundTripFee = Number(
            ((updatedPos.commissionPaid || 0) + fee).toFixed(2),
          );
          const netPnl = Number((pnl - roundTripFee).toFixed(2));
          triggeredBotTrades.push({
            id: `btr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            positionId: updatedPos.id,
            symbol: updatedPos.symbol,
            side: updatedPos.side,
            strategy: updatedPos.botStrategy || xauBotConfigRef.current.strategy,
            quantity: updatedPos.quantity,
            entryPrice: updatedPos.entryPrice,
            exitPrice: exitMark,
            grossPnl: Number(pnl.toFixed(2)),
            fee: roundTripFee,
            netPnl,
            exitAction: triggerAction,
            confidenceAtEntry: updatedPos.botConfidence ?? 70,
            stopLossDollars: xauBotConfigRef.current.stopLossDollars,
            takeProfitDollars: xauBotConfigRef.current.takeProfitDollars,
            openedAt: updatedPos.openedAt,
            closedAt: payload.timestamp,
          });
          appendBotLog(
            netPnl >= 0 ? 'EXECUTION' : 'RISK',
            `Closed ${updatedPos.side} ${updatedPos.quantity} XAU/USD (${triggerAction.replace(
              '_',
              ' ',
            )}) -> ${netPnl >= 0 ? '+' : ''}${formatCurrency(netPnl)} net`,
          );
        }

        emitNotification(
          `${triggerAction === 'TAKE_PROFIT' ? 'Take-Profit Filled' : 'Stop-Loss Triggered'}: ${updatedPos.symbol}`,
          `Closed ${updatedPos.quantity} ${updatedPos.side} @ ${formatPrice(
            exitMark,
            inst.decimals,
          )} · Realized ${pnl >= 0 ? '+' : ''}${formatCurrency(pnl)}`,
          triggerAction === 'TAKE_PROFIT' ? 'TAKE_PROFIT' : 'STOP_LOSS',
          updatedPos.symbol,
          triggerAction === 'TAKE_PROFIT' ? 'fill' : 'warning',
        );
      } else {
        remaining.push(updatedPos);
      }
    }

    if (modified) {
      setPositions(remaining);
    }
    if (triggeredExecs.length > 0) {
      setCashBalance((c) => Number((c + cashDelta).toFixed(2)));
      setExecutions((prev) => [...triggeredExecs, ...prev]);
    }
    if (triggeredBotTrades.length > 0) {
      recordClosedBotTradesAndLearn(triggeredBotTrades);
    }

    // Margin Level Warning Check
    const totalUsed = remaining.reduce((a, p) => a + p.marginUsed, 0);
    if (totalUsed > 0) {
      const totalUnreal = remaining.reduce((acc, p) => {
        const i = instMap.get(p.symbol);
        return acc + (i ? computeUnrealizedPnl(p, i) : 0);
      }, 0);
      const curEq = cashBalanceRef.current + cashDelta + totalUnreal;
      const mLevel = (curEq / totalUsed) * 100;
      if (
        mLevel <= riskSettingsRef.current.marginCallLevelPct &&
        !marginWarnedRef.current
      ) {
        marginWarnedRef.current = true;
        emitNotification(
          'Margin Level Warning',
          `Account margin level dropped to ${mLevel.toFixed(1)}% (threshold ${
            riskSettingsRef.current.marginCallLevelPct
          }%).`,
          'MARGIN_WARNING',
          undefined,
          'warning',
        );
      } else if (mLevel > riskSettingsRef.current.marginCallLevelPct + 15) {
        marginWarnedRef.current = false;
      }
    }
  }
}
