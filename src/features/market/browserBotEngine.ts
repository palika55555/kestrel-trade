import {computeRequiredMargin, computeUnrealizedPnl, formatCurrency, formatPrice} from '../../services/tradingMath';
import {evaluateMultiTradeEntry, evaluateXauBotSignal} from '../../services/xauBot';
import type {Position, TradeExecution} from '../../types/trading';
import type {InstrumentMap, MarketTickContext, MarketTickPayload} from './tickContext';

/**
 * Autonomous XAU/USD bot evaluation on live quotes (browser mode only; skipped
 * while the 24/7 server worker owns execution or the session is locked).
 */
export function evaluateBrowserBot(
  ctx: MarketTickContext,
  payload: MarketTickPayload,
  instMap: InstrumentMap,
) {
  const {
    xauBotConfigRef,
    server247EnabledRef,
    securityStateRef,
    selectedSymbolRef,
    candlesRef,
    candlesBySymbolRef,
    positionsRef,
    executionsRef,
    xauBotLastTradeRef,
    xauBotLastHoldLogRef,
    automationConfigRef,
    xauPrintsRef,
    pendingOrdersRef,
    xauMtfCandlesRef,
    goldMacroRef,
    institutionalGoldRef,
    xauBotTradesRef,
    calendarSnapshotRef,
    cashBalanceRef,
    setXauBotConfig,
    setPositions,
    setExecutions,
    setCashBalance,
    appendBotLog,
    emitNotification,
  } = ctx;
  // 4. Evaluate Autonomous XAU/USD Test Bot on Live Quotes (Browser Mode)
  const botCfg = xauBotConfigRef.current;
  if (
    botCfg.enabled &&
    !server247EnabledRef.current &&
    !securityStateRef.current.isLocked
  ) {
    const xauInst = instMap.get('XAU/USD');
    const rawXauCandles =
      selectedSymbolRef.current === 'XAU/USD' && candlesRef.current.length >= 22
        ? candlesRef.current
        : candlesBySymbolRef.current['XAU/USD'];

    if (xauInst && rawXauCandles && rawXauCandles.length >= 22) {
      const latestBar = rawXauCandles[rawXauCandles.length - 1];
      const patchedXauCandles = [
        ...rawXauCandles.slice(0, -1),
        {
          ...latestBar,
          close: xauInst.price,
          high: Math.max(latestBar.high, xauInst.price),
          low: Math.min(latestBar.low, xauInst.price),
        },
      ];

      const activePositionsNow = positionsRef.current;
      const botOpenPositions = activePositionsNow.filter(
        (p) => p.symbol === 'XAU/USD' && p.source === 'XAU_BOT',
      );
      // Daily loss limit: only today's closed trades count.
      const today = new Date().toDateString();
      const botClosedExecs = executionsRef.current.filter(
        (e) =>
          e.source === 'XAU_BOT' &&
          e.action !== 'OPEN' &&
          new Date(e.timestamp).toDateString() === today,
      );
      const botRealized = botClosedExecs.reduce(
        (acc, e) => acc + e.realizedPnl - e.fee,
        0,
      );
      const botUnreal = botOpenPositions.reduce(
        (acc, p) => acc + computeUnrealizedPnl(p, xauInst),
        0,
      );
      const botNet = botRealized + botUnreal;

      if (botNet <= -Math.abs(botCfg.maxDailyLossDollars)) {
        setXauBotConfig((prev) => ({...prev, enabled: false}));
        appendBotLog(
          'RISK',
          `Bot paused: daily loss limit (-${formatCurrency(
            botCfg.maxDailyLossDollars,
          )}) reached.`,
        );
        emitNotification(
          'XAU/USD Bot Circuit Breaker',
          `Auto Bot paused at ${formatCurrency(botNet)} net P&L.`,
          'MARGIN_WARNING',
          'XAU/USD',
          'warning',
        );
      } else {
        const nowMs = payload.timestamp;
        const cooldownMs = Math.max(5, botCfg.cooldownSeconds) * 1000;
        const cooldownReady = nowMs - xauBotLastTradeRef.current >= cooldownMs;
        const capacityReady =
          botOpenPositions.length < Math.max(1, botCfg.maxConcurrentPositions);

        const evalRes = evaluateXauBotSignal(
          xauInst,
          patchedXauCandles,
          botCfg,
          automationConfigRef.current.orbWindowMinutes,
          xauPrintsRef.current,
          pendingOrdersRef.current,
          {
            mtfCandles: xauMtfCandlesRef.current,
            macro: goldMacroRef.current,
            institutional: institutionalGoldRef.current,
            calendar: calendarSnapshotRef.current,
            closedTrades: xauBotTradesRef.current,
            accountEquity: cashBalanceRef.current,
            nowMs,
          },
        );

        if (evalRes) {
          if (
            (evalRes.action === 'BUY' || evalRes.action === 'SELL') &&
            capacityReady &&
            cooldownReady
          ) {
            const fillPrice =
              evalRes.action === 'BUY' ? xauInst.ask : xauInst.bid;
            const multiPlan = evaluateMultiTradeEntry({
              action: evalRes.action,
              confidence: evalRes.confidence,
              entryPrice: fillPrice,
              baseStopLoss: evalRes.stopLoss,
              baseTakeProfit: evalRes.takeProfit,
              atr14: evalRes.orderFlow?.atr14 ?? 2.0,
              openBotPositions: botOpenPositions,
              config: botCfg,
            });

            if (!multiPlan.allowed) {
              if (nowMs - xauBotLastHoldLogRef.current >= 25_000) {
                xauBotLastHoldLogRef.current = nowMs;
                appendBotLog(
                  'SIGNAL',
                  `${evalRes.action} (${evalRes.confidence}%) deferred: ${multiPlan.reason}`,
                );
              }
            } else {
              // ATR / equity-risk sizing and the ensemble's chosen sub-strategy override the static config.
              const tradeLot = evalRes.effectiveLotSize || botCfg.lotSize;
              const usedStrategy = evalRes.selectedSubStrategy || botCfg.strategy;
              const marginUsed = computeRequiredMargin(
                fillPrice,
                tradeLot,
                botCfg.leverage,
                xauInst,
              );
              const totalUsed = activePositionsNow.reduce(
                (a, p) => a + p.marginUsed,
                0,
              );
              const totalUnrealAll = activePositionsNow.reduce((a, p) => {
                const pi = instMap.get(p.symbol);
                return a + (pi ? computeUnrealizedPnl(p, pi) : 0);
              }, 0);
              const estFreeMargin =
                cashBalanceRef.current + totalUnrealAll - totalUsed;

              if (marginUsed <= estFreeMargin) {
                xauBotLastTradeRef.current = nowMs;
                const fee = Number(
                  (tradeLot * xauInst.commissionPerUnit).toFixed(2),
                );
                const tierLabel = multiPlan.isRunner
                  ? `Runner #${multiPlan.tierNumber} (${multiPlan.tpMultiplier}x TP)`
                  : `Core #${multiPlan.tierNumber}`;
                const newPos: Position = {
                  id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  symbol: 'XAU/USD',
                  side: evalRes.action,
                  quantity: tradeLot,
                  entryPrice: fillPrice,
                  leverage: botCfg.leverage,
                  marginUsed,
                  stopLoss: multiPlan.stopLoss,
                  takeProfit: multiPlan.takeProfit,
                  trailingStopDistance: multiPlan.trailingStopDistance,
                  peakFavorablePrice: fillPrice,
                  openedAt: nowMs,
                  commissionPaid: fee,
                  source: 'XAU_BOT',
                  botStrategy: usedStrategy,
                  botConfidence: evalRes.confidence,
                };
                const newExec: TradeExecution = {
                  id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  symbol: 'XAU/USD',
                  side: evalRes.action,
                  action: 'OPEN',
                  quantity: tradeLot,
                  price: fillPrice,
                  realizedPnl: 0,
                  fee,
                  timestamp: nowMs,
                  source: 'XAU_BOT',
                  notes: `XAU Bot ${tierLabel} (${usedStrategy}) · ${evalRes.reason}`,
                };
                setPositions((prev) => [newPos, ...prev]);
                setExecutions((prev) => [newExec, ...prev]);
                setCashBalance((c) => Number((c - fee).toFixed(2)));
                appendBotLog(
                  'EXECUTION',
                  `Opened ${tierLabel} ${evalRes.action} ${tradeLot} XAU/USD @ ${formatPrice(
                    fillPrice,
                    2,
                  )} (SL ${formatPrice(multiPlan.stopLoss, 2)} / TP ${formatPrice(
                    multiPlan.takeProfit,
                    2,
                  )}${
                    multiPlan.trailingStopDistance
                      ? ` / Trail $${multiPlan.trailingStopDistance.toFixed(1)}`
                      : ''
                  }) — ${evalRes.reason}`,
                );
                emitNotification(
                  `XAU Bot ${tierLabel} ${evalRes.action}`,
                  `${tradeLot} lots XAU/USD @ ${formatPrice(
                    fillPrice,
                    2,
                  )} · SL ${formatPrice(multiPlan.stopLoss, 2)} · TP ${formatPrice(
                    multiPlan.takeProfit,
                    2,
                  )}`,
                  'EXECUTION',
                  'XAU/USD',
                  'fill',
                );
              } else {
                appendBotLog(
                  'RISK',
                  `Skipped ${evalRes.action}: insufficient free margin (${formatCurrency(
                    estFreeMargin,
                  )}).`,
                );
              }
            }
          } else if (nowMs - xauBotLastHoldLogRef.current >= 30_000) {
            xauBotLastHoldLogRef.current = nowMs;
            appendBotLog(
              evalRes.action === 'HOLD' ? 'INFO' : 'SIGNAL',
              `${evalRes.action} (${evalRes.confidence}%): ${evalRes.reason}`,
            );
          }
        }
      }
    }
  }
}
