import {analyzeORB} from '../../services/orbAnalyzer';
import {formatPrice} from '../../services/tradingMath';
import type {MarketTickContext, MarketTickPayload} from './tickContext';

/** Automated ORB & momentum notification engine, evaluated on each tick. */
export function evaluateOrbAutomation(ctx: MarketTickContext, payload: MarketTickPayload) {
  const {automationConfigRef, candlesBySymbolRef, signalCooldownRef, emitNotification} = ctx;
  // 1b. Automated ORB & Momentum Notification Engine
  const autoCfg = automationConfigRef.current;
  if (autoCfg.enabled) {
    const nowMs = payload.timestamp;
    const cooldownMs = Math.max(1, autoCfg.cooldownMinutes) * 60_000;

    for (const inst of payload.instruments) {
      if (
        autoCfg.monitoredSymbols.length > 0 &&
        !autoCfg.monitoredSymbols.includes(inst.symbol)
      ) {
        continue;
      }
      const symCandles = candlesBySymbolRef.current[inst.symbol];
      if (!symCandles || symCandles.length < 20) continue;

      // Patch latest close on last candle for real-time evaluation
      const latestBar = symCandles[symCandles.length - 1];
      const patchedCandles = [
        ...symCandles.slice(0, -1),
        {
          ...latestBar,
          close: inst.price,
          high: Math.max(latestBar.high, inst.price),
          low: Math.min(latestBar.low, inst.price),
        },
      ];

      const orb = analyzeORB(inst, patchedCandles, autoCfg.orbWindowMinutes);
      if (!orb) continue;

      const vwapOk =
        !autoCfg.requireVwapConfluence ||
        (orb.bias === 'LONG' && inst.price >= orb.vwap) ||
        (orb.bias === 'SHORT' && inst.price <= orb.vwap);

      const volOk =
        !autoCfg.requireVolumeSurge ||
        orb.volumeRatio >= autoCfg.minVolumeRatio;

      let fireKey: string | null = null;
      let title = '';
      let body = '';
      let chime: 'alert' | 'fill' | 'warning' = 'alert';

      if (
        orb.signal === 'LONG_BREAKOUT' &&
        autoCfg.notifyOnLongBreakout &&
        vwapOk &&
        volOk
      ) {
        fireKey = `${inst.symbol}:LONG_BREAKOUT`;
        title = `ORB Long Signal: ${inst.symbol}`;
        body = `Breakout above ${autoCfg.orbWindowMinutes}m OR High (${formatPrice(
          orb.orHigh,
          inst.decimals,
        )}). Entry ${formatPrice(orb.longPlan.entryPrice, inst.decimals)} · SL ${formatPrice(
          orb.longPlan.stopLoss,
          inst.decimals,
        )} · TP ${formatPrice(orb.longPlan.takeProfit2R, inst.decimals)}`;
        chime = 'fill';
      } else if (
        orb.signal === 'SHORT_BREAKOUT' &&
        autoCfg.notifyOnShortBreakout &&
        vwapOk &&
        volOk
      ) {
        fireKey = `${inst.symbol}:SHORT_BREAKOUT`;
        title = `ORB Short Signal: ${inst.symbol}`;
        body = `Breakdown below ${autoCfg.orbWindowMinutes}m OR Low (${formatPrice(
          orb.orLow,
          inst.decimals,
        )}). Entry ${formatPrice(orb.shortPlan.entryPrice, inst.decimals)} · SL ${formatPrice(
          orb.shortPlan.stopLoss,
          inst.decimals,
        )} · TP ${formatPrice(orb.shortPlan.takeProfit2R, inst.decimals)}`;
        chime = 'warning';
      } else if (
        (orb.signal === 'LONG_RETEST' || orb.signal === 'SHORT_RETEST') &&
        autoCfg.notifyOnRetestSetup &&
        vwapOk
      ) {
        const isLong = orb.signal === 'LONG_RETEST';
        const plan = isLong ? orb.longPlan : orb.shortPlan;
        fireKey = `${inst.symbol}:${orb.signal}`;
        title = `ORB ${isLong ? 'Long' : 'Short'} Retest: ${inst.symbol}`;
        body = `Pullback retest near ${formatPrice(
          isLong ? orb.orHigh : orb.orLow,
          inst.decimals,
        )}. Entry ${formatPrice(plan.entryPrice, inst.decimals)} · SL ${formatPrice(
          plan.stopLoss,
          inst.decimals,
        )}`;
      } else if (
        autoCfg.notifyOnRsiExtremes &&
        (orb.rsi14 >= 72 || orb.rsi14 <= 28)
      ) {
        const overbought = orb.rsi14 >= 72;
        fireKey = `${inst.symbol}:${overbought ? 'RSI_OB' : 'RSI_OS'}`;
        title = `${overbought ? 'Overbought Short Watch' : 'Oversold Long Watch'}: ${
          inst.symbol
        }`;
        body = `RSI(14) reached ${orb.rsi14.toFixed(1)} at ${formatPrice(
          inst.price,
          inst.decimals,
        )}.`;
      }

      if (fireKey) {
        const lastFired = signalCooldownRef.current[fireKey] || 0;
        if (nowMs - lastFired >= cooldownMs) {
          signalCooldownRef.current[fireKey] = nowMs;
          emitNotification(title, body, 'ORB_SIGNAL', inst.symbol, chime);
        }
      }
    }
  }
}
