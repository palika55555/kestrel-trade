import {z} from 'zod';

// Bounds are deliberately wider than the UI inputs so values tuned by the bot's
// auto-learn loop still round-trip, while absurd or malicious payloads are rejected.
export const botConfigUpdateSchema = z
  .object({
    enabled: z.boolean(),
    autoLearnEnabled: z.boolean(),
    useOrderFlowConfluence: z.boolean(),
    useMtfConfluence: z.boolean(),
    useMacroConfluence: z.boolean(),
    useSessionSpreadGuard: z.boolean(),
    useNewsGuard: z.boolean(),
    useKillzonesOnly: z.boolean(),
    useAtrRiskScaling: z.boolean(),
    riskPerTradePct: z.number().min(0).max(10),
    antiTiltCooldownMinutes: z.number().min(0).max(1440),
    staleTradeMinutes: z.number().min(0).max(1440),
    newsPauseMinutesBefore: z.number().int().min(0).max(240),
    newsPauseMinutesAfter: z.number().int().min(0).max(240),
    maxSpreadDollars: z.number().min(0).max(50),
    autoBreakEvenEnabled: z.boolean(),
    partialTpEnabled: z.boolean(),
    strategy: z.enum([
      'SMART_ENSEMBLE',
      'ORB_VWAP',
      'LIQUIDITY_SWEEP_SMC',
      'ORDERFLOW_LIQUIDITY',
      'EMA_MOMENTUM',
      'BOLLINGER_REVERSION',
    ]),
    lotSize: z.number().min(0.01).max(10),
    leverage: z.number().min(1).max(500),
    stopLossDollars: z.number().min(0.1).max(500),
    takeProfitDollars: z.number().min(0.1).max(1000),
    trailingStopDollars: z.number().min(0).max(200).nullable(),
    maxConcurrentPositions: z.number().int().min(1).max(10),
    cooldownSeconds: z.number().min(0).max(86_400),
    maxDailyLossDollars: z.number().min(1).max(1_000_000),
    minConfidence: z.number().min(0).max(100),
  })
  .partial();

export type BotConfigUpdate = z.infer<typeof botConfigUpdateSchema>;

export const closePositionSchema = z.object({
  fraction: z.number().gt(0).max(1).default(1),
});

export const positionRiskSchema = z.object({
  stopLoss: z.number().positive().nullable().default(null),
  takeProfit: z.number().positive().nullable().default(null),
});

export const brokerModeSchema = z.object({
  routingArmed: z.boolean(),
});

export const calendarQuerySchema = z.object({
  before: z.coerce.number().int().min(0).max(240).catch(15),
  after: z.coerce.number().int().min(0).max(240).catch(15),
});

export interface ValidationFailure {
  error: string;
  details: string[];
}

export type ParseResult<T> = {ok: true; data: T} | {ok: false; failure: ValidationFailure};

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): ParseResult<z.output<S>> {
  const result = schema.safeParse(input ?? {});
  if (result.success) return {ok: true, data: result.data};
  return {
    ok: false,
    failure: {
      error: 'Invalid request body',
      details: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    },
  };
}
