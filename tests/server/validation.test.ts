import {describe, expect, it} from 'vitest';
import {createServerBotDefaultConfig} from '../../server/botDefaults.ts';
import {
  botConfigUpdateSchema,
  brokerModeSchema,
  calendarQuerySchema,
  closePositionSchema,
  parseInput,
  positionRiskSchema,
} from '../../server/validation.ts';

describe('botConfigUpdateSchema', () => {
  it('accepts a partial update with valid values', () => {
    const result = parseInput(botConfigUpdateSchema, {lotSize: 0.5, strategy: 'EMA_MOMENTUM', enabled: true});
    expect(result).toEqual({ok: true, data: {lotSize: 0.5, strategy: 'EMA_MOMENTUM', enabled: true}});
  });

  it('accepts every field of the server default config', () => {
    const defaults = createServerBotDefaultConfig();
    const result = parseInput(botConfigUpdateSchema, defaults);
    expect(result).toEqual({ok: true, data: defaults});
  });

  it('accepts the legacy default config unchanged', () => {
    const defaults = {
      enabled: false,
      autoLearnEnabled: true,
      useOrderFlowConfluence: true,
      useMtfConfluence: true,
      useMacroConfluence: true,
      useSessionSpreadGuard: true,
      useNewsGuard: true,
      newsPauseMinutesBefore: 15,
      newsPauseMinutesAfter: 15,
      maxSpreadDollars: 1.2,
      autoBreakEvenEnabled: true,
      partialTpEnabled: true,
      strategy: 'ORB_VWAP',
      lotSize: 0.1,
      leverage: 15,
      stopLossDollars: 8,
      takeProfitDollars: 16,
      trailingStopDollars: null,
      maxConcurrentPositions: 3,
      cooldownSeconds: 25,
      maxDailyLossDollars: 1200,
      minConfidence: 55,
    };
    expect(parseInput(botConfigUpdateSchema, defaults).ok).toBe(true);
  });

  it.each([
    ['maxConcurrentPositions above 10', {maxConcurrentPositions: 9999}],
    ['negative lot size', {lotSize: -1}],
    ['fractional concurrent positions', {maxConcurrentPositions: 2.5}],
    ['unknown strategy', {strategy: 'YOLO'}],
    ['risk per trade above 10%', {riskPerTradePct: 50}],
    ['string where number expected', {stopLossDollars: '8'}],
    ['enabled as string', {enabled: 'true'}],
    ['confidence above 100', {minConfidence: 150}],
  ])('rejects %s', (_label, body) => {
    const result = parseInput(botConfigUpdateSchema, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.error).toBe('Invalid request body');
      expect(result.failure.details.length).toBeGreaterThan(0);
    }
  });

  it('strips unknown keys instead of passing them through', () => {
    const result = parseInput(botConfigUpdateSchema, {lotSize: 1, __proto__evil: true, positions: []});
    expect(result).toEqual({ok: true, data: {lotSize: 1}});
  });

  it('treats a missing body as an empty update', () => {
    expect(parseInput(botConfigUpdateSchema, undefined)).toEqual({ok: true, data: {}});
  });
});

describe('closePositionSchema', () => {
  it('defaults fraction to a full close', () => {
    expect(parseInput(closePositionSchema, {})).toEqual({ok: true, data: {fraction: 1}});
  });

  it.each([0, -0.5, 1.5])('rejects fraction %s', (fraction) => {
    expect(parseInput(closePositionSchema, {fraction}).ok).toBe(false);
  });
});

describe('positionRiskSchema', () => {
  it('allows clearing SL/TP with null', () => {
    expect(parseInput(positionRiskSchema, {stopLoss: null, takeProfit: 2500})).toEqual({
      ok: true,
      data: {stopLoss: null, takeProfit: 2500},
    });
  });

  it('rejects non-positive prices', () => {
    expect(parseInput(positionRiskSchema, {stopLoss: 0}).ok).toBe(false);
  });
});

describe('brokerModeSchema', () => {
  it('requires a real boolean so "false" strings cannot arm routing', () => {
    expect(parseInput(brokerModeSchema, {routingArmed: 'false'}).ok).toBe(false);
    expect(parseInput(brokerModeSchema, {}).ok).toBe(false);
    expect(parseInput(brokerModeSchema, {routingArmed: true})).toEqual({ok: true, data: {routingArmed: true}});
  });
});

describe('calendarQuerySchema', () => {
  it('coerces query strings and falls back to 15 on garbage', () => {
    expect(calendarQuerySchema.parse({before: '30', after: 'abc'})).toEqual({before: 30, after: 15});
    expect(calendarQuerySchema.parse({before: '9999'})).toEqual({before: 15, after: 15});
  });
});
