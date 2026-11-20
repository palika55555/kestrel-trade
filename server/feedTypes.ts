export interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
          volume?: Array<number | null>;
        }>;
      };
    }>;
  };
}

export interface SwissquoteQuote {
  spreadProfilePrices?: Array<{
    spreadProfile: string;
    bid: number;
    ask: number;
  }>;
}

export interface KrakenTickerResponse {
  error?: string[];
  result?: Record<
    string,
    {
      a: [string, string, string];
      b: [string, string, string];
      c: [string, string];
      v: [string, string];
      h: [string, string];
      l: [string, string];
      o: string;
    }
  >;
}

export interface KrakenOHLCResponse {
  error?: string[];
  result?: Record<string, Array<[number, string, string, string, string, string, string, number]>>;
}

export interface KrakenDepthResponse {
  error?: string[];
  result?: Record<
    string,
    {
      asks: Array<[string, string, number]>;
      bids: Array<[string, string, number]>;
    }
  >;
}

export interface KrakenTradesResponse {
  error?: string[];
  result?: Record<
    string,
    Array<[string, string, number, 'b' | 's', 'm' | 'l', string]>
  >;
}

export interface SpreadTier {
  profile: string;
  bid: number;
  ask: number;
}


export interface ForexFactoryRawEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
}
