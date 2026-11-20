import type {Dispatch, RefObject, SetStateAction} from 'react';
import type {AppendBotLog} from '../features/market/tickContext';
import type {PendingOrderPayload} from '../lib/orderPayload';
import {formatPrice} from '../services/tradingMath';
import {createDefaultXauBotConfig, evaluateMultiTradeEntry} from '../services/xauBot';
import type {
  Instrument,
  OrderSide,
  Position,
  ServerBotState,
  XauBotConfig,
} from '../types/trading';
import type {DerivedTradingData} from './useDerivedTradingData';

interface XauBotActionDeps {
  activeBotConfig: XauBotConfig;
  xauBotConfig: XauBotConfig;
  xauInstrument: Instrument | null;
  xauBotEvaluation: DerivedTradingData['xauBotEvaluation'];
  botPositions: Position[];
  selectedSymbol: string;
  server247Enabled: boolean;
  xauBotLastTradeRef: RefObject<number>;
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
  setXauBotConfig: Dispatch<SetStateAction<XauBotConfig>>;
  setServerBotState: Dispatch<SetStateAction<ServerBotState | null>>;
  syncConfigToBot: (next: XauBotConfig) => Promise<void>;
  executeOrderInternal: (payload: PendingOrderPayload) => void;
  handleClosePosition: (positionId: string, fraction?: number) => Promise<void>;
  appendBotLog: AppendBotLog;
}

/**
 * Trader-initiated XAU/USD bot actions used by the Trade tab bot panel and
 * the Bot Stats tab (start/pause, manual scan, sample paper trade, close bot
 * positions, self-learning controls).
 */
export function useXauBotActions({
  activeBotConfig,
  xauBotConfig,
  xauInstrument,
  xauBotEvaluation,
  botPositions,
  selectedSymbol,
  server247Enabled,
  xauBotLastTradeRef,
  setSelectedSymbol,
  setXauBotConfig,
  setServerBotState,
  syncConfigToBot,
  executeOrderInternal,
  handleClosePosition,
  appendBotLog,
}: XauBotActionDeps) {
  // Trade tab panel variant: also switches the chart to XAU/USD when starting.
  const toggleBotFromTradePanel = async () => {
    const next = !activeBotConfig.enabled;
    await syncConfigToBot({...activeBotConfig, enabled: next});
    appendBotLog(
      'INFO',
      next
        ? `Auto Bot STARTED on live XAU/USD quotes (${activeBotConfig.strategy}, ${activeBotConfig.lotSize} lots).`
        : 'Auto Bot PAUSED by trader.',
    );
    if (next && selectedSymbol !== 'XAU/USD') {
      setSelectedSymbol('XAU/USD');
    }
  };

  const evaluateNow = () => {
    if (!xauInstrument || !xauBotEvaluation) {
      appendBotLog(
        'INFO',
        'Waiting for at least 22 live XAU/USD candles to evaluate.',
      );
      return;
    }
    appendBotLog(
      xauBotEvaluation.action === 'HOLD' ? 'INFO' : 'SIGNAL',
      `Manual scan -> ${xauBotEvaluation.action} (${xauBotEvaluation.confidence}%): ${xauBotEvaluation.reason}`,
    );
    if (
      (xauBotEvaluation.action === 'BUY' ||
        xauBotEvaluation.action === 'SELL') &&
      botPositions.length < Math.max(1, xauBotConfig.maxConcurrentPositions)
    ) {
      const entryRef =
        xauBotEvaluation.action === 'BUY'
          ? xauInstrument.ask
          : xauInstrument.bid;
      const multiPlan = evaluateMultiTradeEntry({
        action: xauBotEvaluation.action,
        confidence: xauBotEvaluation.confidence,
        entryPrice: entryRef,
        baseStopLoss: xauBotEvaluation.stopLoss,
        baseTakeProfit: xauBotEvaluation.takeProfit,
        atr14: xauBotEvaluation.orderFlow?.atr14 ?? 2.0,
        openBotPositions: botPositions,
        config: xauBotConfig,
        ignoreSpacing: true,
      });
      if (multiPlan.allowed) {
        const tierLabel = multiPlan.isRunner
          ? `Runner #${multiPlan.tierNumber} (${multiPlan.tpMultiplier}x TP)`
          : `Core #${multiPlan.tierNumber}`;
        xauBotLastTradeRef.current = Date.now();
        executeOrderInternal({
          symbol: 'XAU/USD',
          side: xauBotEvaluation.action,
          type: 'MARKET',
          quantity: xauBotConfig.lotSize,
          leverage: xauBotConfig.leverage,
          stopLoss: multiPlan.stopLoss,
          takeProfit: multiPlan.takeProfit,
          trailingStopDistance: multiPlan.trailingStopDistance,
          source: 'XAU_BOT',
          botStrategy: xauBotConfig.strategy,
          botConfidence: xauBotEvaluation.confidence,
          note: `XAU Bot manual ${tierLabel} (${xauBotConfig.strategy})`,
        });
        appendBotLog(
          'EXECUTION',
          `Manual scan executed ${tierLabel} ${xauBotEvaluation.action} ${xauBotConfig.lotSize} XAU/USD (TP ${formatPrice(multiPlan.takeProfit, 2)}).`,
        );
      }
    }
  };

  const runSamplePaperTrade = (side: OrderSide) => {
    if (!xauInstrument) return;
    const entryRef =
      side === 'BUY' ? xauInstrument.ask : xauInstrument.bid;
    const baseSl = Number(
      (side === 'BUY'
        ? entryRef - xauBotConfig.stopLossDollars
        : entryRef + xauBotConfig.stopLossDollars
      ).toFixed(2),
    );
    const sameSideCount = botPositions.filter(
      (p) => p.side === side,
    ).length;
    const tpMultiplier = Number(
      (1 + sameSideCount * 0.35).toFixed(2),
    );
    const scaledTpDist = Number(
      (xauBotConfig.takeProfitDollars * tpMultiplier).toFixed(2),
    );
    const tp = Number(
      (side === 'BUY'
        ? entryRef + scaledTpDist
        : entryRef - scaledTpDist
      ).toFixed(2),
    );
    const runnerTrail =
      sameSideCount > 0
        ? xauBotConfig.trailingStopDollars ??
          Math.max(
            4.5,
            Number(
              (xauBotConfig.stopLossDollars * 0.75).toFixed(2),
            ),
          )
        : xauBotConfig.trailingStopDollars;
    const tierLabel =
      sameSideCount > 0
        ? `Runner #${sameSideCount + 1} (${tpMultiplier}x TP)`
        : 'Core #1';
    xauBotLastTradeRef.current = Date.now();
    executeOrderInternal({
      symbol: 'XAU/USD',
      side,
      type: 'MARKET',
      quantity: xauBotConfig.lotSize,
      leverage: xauBotConfig.leverage,
      stopLoss: baseSl,
      takeProfit: tp,
      trailingStopDistance: runnerTrail,
      source: 'XAU_BOT',
      botStrategy: xauBotConfig.strategy,
      botConfidence: xauBotEvaluation?.confidence ?? 75,
      note: `XAU Bot live paper test ${tierLabel} (${side})`,
    });
    appendBotLog(
      'EXECUTION',
      `Test Bot ${tierLabel} ${side} ${xauBotConfig.lotSize} XAU/USD @ ${formatPrice(
        entryRef,
        2,
      )} (SL ${formatPrice(baseSl, 2)} / TP ${formatPrice(tp, 2)})`,
    );
  };

  const closeBotPositions = async () => {
    if (server247Enabled) {
      try {
        const res = await fetch('/api/bot/close-all', {method: 'POST'});
        if (res.ok) {
          setServerBotState((await res.json()) as ServerBotState);
        }
      } catch {
        // Ignore
      }
    } else {
      botPositions.forEach((p) => handleClosePosition(p.id, 1));
      appendBotLog(
        'INFO',
        `Closed ${botPositions.length} active XAU/USD bot position(s).`,
      );
    }
  };

  // Bot Stats tab variant: does not switch the chart symbol.
  const toggleBotFromStats = async () => {
    const next = !activeBotConfig.enabled;
    await syncConfigToBot({...activeBotConfig, enabled: next});
    appendBotLog(
      'INFO',
      next
        ? `Auto Bot STARTED on live XAU/USD quotes (${activeBotConfig.strategy}, ${activeBotConfig.lotSize} lots).`
        : 'Auto Bot PAUSED by trader.',
    );
  };

  const toggleAutoLearn = () => {
    const next = !xauBotConfig.autoLearnEnabled;
    setXauBotConfig((prev) => ({...prev, autoLearnEnabled: next}));
    appendBotLog(
      'LEARN',
      `Automatic self-learning ${next ? 'ENABLED' : 'DISABLED'}.`,
    );
  };

  const resetLearnedParams = () => {
    const defaults = createDefaultXauBotConfig();
    setXauBotConfig((prev) => ({
      ...defaults,
      enabled: prev.enabled,
      autoLearnEnabled: prev.autoLearnEnabled,
    }));
    appendBotLog(
      'LEARN',
      'Reset bot strategy & risk parameters to baseline defaults.',
    );
  };

  return {
    toggleBotFromTradePanel,
    evaluateNow,
    runSamplePaperTrade,
    closeBotPositions,
    toggleBotFromStats,
    toggleAutoLearn,
    resetLearnedParams,
  };
}

export type XauBotActions = ReturnType<typeof useXauBotActions>;
