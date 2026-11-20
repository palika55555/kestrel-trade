import type {OrderSide, OrderType, XauBotStrategy} from '../types/trading';

export interface PendingOrderPayload {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity: number;
  triggerPrice?: number;
  leverage: number;
  stopLoss: number | null;
  takeProfit: number | null;
  trailingStopDistance: number | null;
  source?: 'MANUAL' | 'XAU_BOT';
  note?: string;
  botStrategy?: XauBotStrategy;
  botConfidence?: number;
}
