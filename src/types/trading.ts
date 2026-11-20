export type AssetClass =
  | 'FUTURES'
  | 'COMMODITY_FUTURES'
  | 'FX_CFD'
  | 'INDEX_CFD'
  | 'CRYPTO_CFD';

export type ContractType = 'FUTURE' | 'CFD';

export type Timeframe = '1m' | '5m' | '15m' | '1H' | '4H' | '1D';

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP';

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface Instrument {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  contractType: ContractType;
  exchange: string;
  contractSize: number;
  unitLabel: string;
  tickSize: number;
  tickValue: number;
  decimals: number;
  maxLeverage: number;
  initialMarginRate: number;
  maintenanceMarginRate: number;
  overnightSwapLong: number;
  overnightSwapShort: number;
  commissionPerUnit: number;
  expiryDate?: string;
  price: number;
  bid: number;
  ask: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  changePct: number;
  sparkline: number[];
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  dataSource?: string;
  feedStatus?: 'LIVE' | 'FALLBACK';
}

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Position {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  leverage: number;
  marginUsed: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopDistance: number | null;
  peakFavorablePrice: number;
  openedAt: number;
  commissionPaid: number;
  source?: 'MANUAL' | 'XAU_BOT';
  botStrategy?: XauBotStrategy;
  botConfidence?: number;
  breakEvenMoved?: boolean;
  partialTpTaken?: boolean;
  brokerOrderId?: string;
  brokerProvider?: BrokerProvider;
}

export interface PendingOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  type: 'LIMIT' | 'STOP';
  quantity: number;
  triggerPrice: number;
  leverage: number;
  stopLoss: number | null;
  takeProfit: number | null;
  createdAt: number;
}

export type ExecutionAction =
  | 'OPEN'
  | 'CLOSE'
  | 'PARTIAL_CLOSE'
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'TRAILING_STOP'
  | 'LIQUIDATION';

export interface TradeExecution {
  id: string;
  symbol: string;
  side: OrderSide;
  action: ExecutionAction;
  quantity: number;
  price: number;
  realizedPnl: number;
  fee: number;
  timestamp: number;
  notes?: string;
  source?: 'MANUAL' | 'XAU_BOT';
}

export interface PriceAlert {
  id: string;
  symbol: string;
  condition: 'ABOVE' | 'BELOW';
  targetPrice: number;
  active: boolean;
  createdAt: number;
  triggeredAt?: number;
  note?: string;
}

export type AlertCategory =
  | 'PRICE_ALERT'
  | 'STOP_LOSS'
  | 'TAKE_PROFIT'
  | 'MARGIN_WARNING'
  | 'EXECUTION'
  | 'ORB_SIGNAL'
  | 'SYSTEM';

export interface AlertNotification {
  id: string;
  title: string;
  body: string;
  category: AlertCategory;
  symbol?: string;
  timestamp: number;
  read: boolean;
}

export type ORBWindowMinutes = 15 | 30 | 60;

export type ORBSignalState =
  | 'LONG_BREAKOUT'
  | 'LONG_RETEST'
  | 'SHORT_BREAKOUT'
  | 'SHORT_RETEST'
  | 'INSIDE_RANGE';

export interface ORBTradePlan {
  side: OrderSide;
  entryPrice: number;
  stopLoss: number;
  takeProfit1R: number;
  takeProfit2R: number;
  conditionSummary: string;
}

export interface ORBAnalysis {
  symbol: string;
  windowMinutes: ORBWindowMinutes;
  orHigh: number;
  orLow: number;
  orMid: number;
  rangeWidth: number;
  rangeWidthPct: number;
  rangeStartTime: number;
  rangeEndTime: number;
  currentPrice: number;
  vwap: number;
  ema20: number;
  rsi14: number;
  volumeRatio: number;
  signal: ORBSignalState;
  bias: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidenceScore: number; // 0-100 deterministic confluence
  confluenceChecks: {
    label: string;
    passed: boolean;
    detail: string;
  }[];
  longPlan: ORBTradePlan;
  shortPlan: ORBTradePlan;
  rationale: string;
}

export interface NotificationAutomationConfig {
  enabled: boolean;
  orbWindowMinutes: ORBWindowMinutes;
  notifyOnLongBreakout: boolean;
  notifyOnShortBreakout: boolean;
  notifyOnRetestSetup: boolean;
  requireVwapConfluence: boolean;
  requireVolumeSurge: boolean;
  minVolumeRatio: number;
  notifyOnRsiExtremes: boolean;
  cooldownMinutes: number;
  autoStageTicketOnSignal: boolean;
  monitoredSymbols: string[]; // empty = monitor all instruments
}

export interface StagedOrderPreset {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  triggerPrice?: number;
  stopLoss: number;
  takeProfit: number;
  sourceLabel: string;
  nonce: number;
}

export type XauBotStrategy =
  | 'ORB_VWAP'
  | 'EMA_MOMENTUM'
  | 'BOLLINGER_REVERSION'
  | 'ORDERFLOW_LIQUIDITY';

export interface XauBotConfig {
  enabled: boolean;
  autoLearnEnabled: boolean;
  useOrderFlowConfluence: boolean;
  useMtfConfluence: boolean;
  useMacroConfluence: boolean;
  useSessionSpreadGuard: boolean;
  useNewsGuard: boolean;
  newsPauseMinutesBefore: number;
  newsPauseMinutesAfter: number;
  maxSpreadDollars: number;
  autoBreakEvenEnabled: boolean;
  partialTpEnabled: boolean;
  strategy: XauBotStrategy;
  lotSize: number;
  leverage: number;
  stopLossDollars: number;
  takeProfitDollars: number;
  trailingStopDollars: number | null;
  maxConcurrentPositions: number;
  cooldownSeconds: number;
  maxDailyLossDollars: number;
  minConfidence: number;
}

export interface XauBotLogEntry {
  id: string;
  timestamp: number;
  level: 'INFO' | 'SIGNAL' | 'EXECUTION' | 'RISK' | 'LEARN';
  message: string;
}

export interface XauBotTradeRecord {
  id: string;
  positionId: string;
  symbol: string;
  side: OrderSide;
  strategy: XauBotStrategy;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  grossPnl: number;
  fee: number;
  netPnl: number;
  exitAction: ExecutionAction;
  confidenceAtEntry: number;
  stopLossDollars: number;
  takeProfitDollars: number;
  openedAt: number;
  closedAt: number;
}

export interface XauBotAdaptationEvent {
  id: string;
  timestamp: number;
  triggerTradeCount: number;
  summary: string;
  changes: string[];
  reason: string;
}

export interface EODReport {
  id: string;
  date: string; // YYYY-MM-DD
  startingEquity: number;
  endingEquity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  swapFees: number;
  commissions: number;
  netPnl: number;
  returnPct: number;
  tradesCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  peakMarginUsed: number;
  assetBreakdown: Record<string, number>;
  settledAt: number;
}

export interface RiskSettings {
  maxDailyDrawdownPct: number;
  maxAssetExposurePct: number;
  marginCallLevelPct: number;
  stopOutLevelPct: number;
  defaultRiskPct: number;
  requireBiometricForOrders: boolean;
  enablePushNotifications: boolean;
  enableAudioChime: boolean;
}

export interface SecurityState {
  biometricEnrolled: boolean;
  credentialId: string | null;
  pinConfigured: boolean;
  pinHash: string | null;
  isLocked: boolean;
  lastUnlockedAt: number | null;
  authMethod: 'WEBAUTHN' | 'PIN' | null;
}

export type DrawingTool = 'CURSOR' | 'TRENDLINE' | 'HORIZONTAL' | 'FIBONACCI';

export interface ChartPoint {
  time: number;
  price: number;
}

export interface ChartDrawing {
  id: string;
  symbol: string;
  type: 'TRENDLINE' | 'HORIZONTAL' | 'FIBONACCI';
  points: ChartPoint[];
  color: string;
}

export interface IndicatorConfig {
  ema20: boolean;
  ema50: boolean;
  bollinger: boolean;
  vwap: boolean;
  rsi: boolean;
  orb: boolean;
}

export interface MarketPrint {
  id: string;
  price: number;
  size: number;
  side: OrderSide;
  timestamp: number;
  source: 'KRAKEN_TRADE' | 'BBO_TICK';
}

export type LiquidityZoneType =
  | 'BSL'
  | 'SSL'
  | 'POC'
  | 'VAH'
  | 'VAL'
  | 'FVG_BULL'
  | 'FVG_BEAR'
  | 'USER_PENDING';

export interface LiquidityZone {
  id: string;
  label: string;
  type: LiquidityZoneType;
  price: number;
  secondaryPrice?: number;
  strength: number; // 1-100
  sideBias: OrderSide | 'NEUTRAL';
  description: string;
}

export interface VolumeProfileRow {
  priceLow: number;
  priceHigh: number;
  priceMid: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  isPoc: boolean;
  inValueArea: boolean;
}

export interface FootprintClusterRow {
  priceLow: number;
  priceHigh: number;
  priceMid: number;
  bidVolume: number;
  askVolume: number;
  delta: number;
  totalVolume: number;
  imbalance: 'BUY' | 'SELL' | 'NONE';
  isBarPoc: boolean;
}

export interface BarDeltaPoint {
  time: number;
  delta: number;
  cvd: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
}

export interface OrderFlowSnapshot {
  symbol: string;
  timestamp: number;
  buyPressurePct: number;
  sellPressurePct: number;
  cvd: number;
  bookImbalancePct: number; // >50 means heavier bids
  totalBidDepth: number;
  totalAskDepth: number;
  tickBuyCount: number;
  tickSellCount: number;
  atr14: number;
  atrPct: number;
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';
  pocPrice: number;
  vahPrice: number;
  valPrice: number;
  volumeProfile: VolumeProfileRow[];
  footprintClusters: FootprintClusterRow[];
  barDeltas: BarDeltaPoint[];
  stackedImbalance: 'BULLISH_STACK' | 'BEARISH_STACK' | 'NONE';
  absorptionSignal: 'BULLISH_ABSORPTION' | 'BEARISH_ABSORPTION' | 'NONE';
  cvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  liquidityZones: LiquidityZone[];
  verdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  verdictScore: number; // 0-100 bullishness
  pullbackSetup: {
    side: OrderSide;
    orderType: 'LIMIT';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rationale: string;
  };
  breakoutSetup: {
    side: OrderSide;
    orderType: 'STOP';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    rationale: string;
  };
}

export interface CotPositioning {
  marketName: string;
  reportDate: string;
  openInterest: number;
  managedMoneyLong: number;
  managedMoneyShort: number;
  managedMoneyNet: number;
  managedMoneyNetChange: number;
  commercialNet: number;
  swapDealerNet: number;
  retailNet: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface InstitutionalGoldContext {
  cot: CotPositioning | null;
  gvz: number | null;
  gvzChangePct: number;
  vix: number | null;
  vixChangePct: number;
  gldPrice: number | null;
  gldChangePct: number;
  gldVolume: number;
  paxgPrice: number | null;
  paxgBuyVolumeOz: number;
  paxgSellVolumeOz: number;
  paxgNetDeltaOz: number;
  paxgBuyPct: number;
  paxgBookBidPct: number;
  paxgLargePrints: Array<{
    id: string;
    price: number;
    sizeOz: number;
    side: OrderSide;
    timestamp: number;
  }>;
  compositeBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  compositeScore: number;
  volatilityAlert: boolean;
  summary: string;
  updatedAt: number;
}

export interface MacroGoldContext {
  dxyPrice: number;
  dxyChangePct: number;
  us10yYield: number;
  us10yChangePct: number;
  xauSpotPrice: number;
  gcFuturesPrice: number;
  gcBasis: number;
  macroBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  macroScore: number;
  updatedAt: number;
  live?: boolean;
}

export interface MtfTimeframeTrend {
  timeframe: Timeframe;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ema9: number;
  ema21: number;
  rsi14: number;
  close: number;
}

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  timestamp: number;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
}

export interface EconomicCalendarSnapshot {
  events: EconomicEvent[];
  nextHighImpactUsd: EconomicEvent | null;
  activeGuardEvent: EconomicEvent | null;
  minutesToNextHighUsd: number | null;
  newsGuardActive: boolean;
  source: string;
  updatedAt: number;
}

export type BrokerProvider = 'SIMULATION' | 'OANDA' | 'METAAPI' | 'WEBHOOK';

export interface BrokerStatus {
  provider: BrokerProvider;
  configured: boolean;
  environment: 'practice' | 'live';
  routingArmed: boolean;
  accountLabel: string;
  currency: string;
  balance: number | null;
  equity: number | null;
  unrealizedPnl: number | null;
  marginUsed: number | null;
  openPositionsCount: number;
  lastSyncedAt: number | null;
  lastOrderSummary: string | null;
  lastError: string | null;
}

export interface ServerBotState {
  enabled: boolean;
  config: XauBotConfig;
  positions: Position[];
  closedTrades: XauBotTradeRecord[];
  executions: TradeExecution[];
  logs: XauBotLogEntry[];
  /** All-time P&L (realized across all days + open positions). */
  netPnl: number;
  /** Today's P&L (Europe/Bratislava day), used for the daily loss limit. */
  dailyPnl?: number;
  /** Realized P&L of trades that fell out of the 200-trade history. */
  archivedRealizedPnl?: number;
  /** Day (YYYY-MM-DD) the bot was paused by the daily loss limit; it resumes the next day. */
  dailyLossPausedDay?: string;
  lastEvaluatedAt: number;
  brokerRoutingArmed?: boolean;
  brokerStatus?: BrokerStatus;
  machineId?: string;
  bootId?: string;
  storagePersistent?: boolean;
}

export type ActiveTab = 'trade' | 'bot' | 'portfolio' | 'alerts' | 'reports' | 'security';
