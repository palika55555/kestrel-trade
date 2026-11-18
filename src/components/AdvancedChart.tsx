import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  Minus,
  MousePointer,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  calculateBollinger,
  calculateEMA,
  calculateRSI,
  calculateVWAP,
  formatPrice,
} from '../services/tradingMath';
import type {
  Candle,
  ChartDrawing,
  ChartPoint,
  DrawingTool,
  IndicatorConfig,
  Instrument,
  ORBAnalysis,
  Position,
  PriceAlert,
  Timeframe,
} from '../types/trading';

interface AdvancedChartProps {
  instrument: Instrument;
  candles: Candle[];
  timeframe: Timeframe;
  onChangeTimeframe: (tf: Timeframe) => void;
  positions: Position[];
  alerts: PriceAlert[];
  orbAnalysis?: ORBAnalysis | null;
  drawings: ChartDrawing[];
  onAddDrawing: (drawing: ChartDrawing) => void;
  onClearDrawings: (symbol: string) => void;
  onQuickTrade: (side: 'BUY' | 'SELL') => void;
  isOnline: boolean;
  isDark: boolean;
}

const TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1H', '4H', '1D'];

export const AdvancedChart: React.FC<AdvancedChartProps> = ({
  instrument,
  candles,
  timeframe,
  onChangeTimeframe,
  positions,
  alerts,
  orbAnalysis,
  drawings,
  onAddDrawing,
  onClearDrawings,
  onQuickTrade,
  isOnline,
  isDark,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [indicators, setIndicators] = useState<IndicatorConfig>({
    ema20: true,
    ema50: true,
    bollinger: false,
    vwap: true,
    rsi: true,
    orb: true,
  });
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [activeTool, setActiveTool] = useState<DrawingTool>('CURSOR');
  const [draftPoints, setDraftPoints] = useState<ChartPoint[]>([]);

  // Viewport: how many candles visible & right offset
  const [visibleCount, setVisibleCount] = useState(72);
  const [rightOffset, setRightOffset] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{x: number; offset: number}>({x: 0, offset: 0});

  // Reset offset when changing symbol
  useEffect(() => {
    setRightOffset(0);
    setDraftPoints([]);
  }, [instrument.symbol, timeframe]);

  const symbolPositions = useMemo(
    () => positions.filter((p) => p.symbol === instrument.symbol),
    [positions, instrument.symbol],
  );
  const symbolAlerts = useMemo(
    () => alerts.filter((a) => a.symbol === instrument.symbol && a.active),
    [alerts, instrument.symbol],
  );
  const symbolDrawings = useMemo(
    () => drawings.filter((d) => d.symbol === instrument.symbol),
    [drawings, instrument.symbol],
  );

  // Precompute indicator series
  const indicatorData = useMemo(() => {
    return {
      ema20: indicators.ema20 ? calculateEMA(candles, 20) : [],
      ema50: indicators.ema50 ? calculateEMA(candles, 50) : [],
      bb: indicators.bollinger ? calculateBollinger(candles, 20, 2) : null,
      vwap: indicators.vwap ? calculateVWAP(candles) : [],
      rsi: indicators.rsi ? calculateRSI(candles, 14) : [],
    };
  }, [candles, indicators]);

  // Slice visible candles
  const viewBounds = useMemo(() => {
    const total = candles.length;
    const count = Math.min(total, Math.max(20, visibleCount));
    const endIdx = Math.max(count, total - rightOffset);
    const startIdx = Math.max(0, endIdx - count);
    return {startIdx, endIdx, count: endIdx - startIdx};
  }, [candles.length, visibleCount, rightOffset]);

  const getChartGeometry = useCallback(
    (width: number, height: number) => {
      const padLeft = 10;
      const padRight = 78;
      const padTop = 16;
      const padBottom = 26;
      const rsiHeight = indicators.rsi ? Math.max(70, Math.floor(height * 0.22)) : 0;
      const gap = indicators.rsi ? 10 : 0;
      const mainHeight = Math.max(140, height - padTop - padBottom - rsiHeight - gap);
      const plotWidth = Math.max(120, width - padLeft - padRight);
      const rsiTop = padTop + mainHeight + gap;

      const slice = candles.slice(viewBounds.startIdx, viewBounds.endIdx);
      let minP = Infinity;
      let maxP = -Infinity;

      for (let i = 0; i < slice.length; i++) {
        const c = slice[i];
        if (c.low < minP) minP = c.low;
        if (c.high > maxP) maxP = c.high;
        const absIdx = viewBounds.startIdx + i;
        if (indicators.bollinger && indicatorData.bb) {
          const u = indicatorData.bb.upper[absIdx];
          const l = indicatorData.bb.lower[absIdx];
          if (u !== null && u > maxP) maxP = u;
          if (l !== null && l < minP) minP = l;
        }
      }

      if (!Number.isFinite(minP) || !Number.isFinite(maxP)) {
        minP = instrument.price * 0.99;
        maxP = instrument.price * 1.01;
      }

      // Include current price & active position SL/TP within mild expansion
      minP = Math.min(minP, instrument.bid);
      maxP = Math.max(maxP, instrument.ask);

      const span = maxP - minP || instrument.tickSize * 10;
      minP -= span * 0.08;
      maxP += span * 0.08;

      const priceToY = (p: number) =>
        padTop + ((maxP - p) / (maxP - minP)) * mainHeight;
      const yToPrice = (y: number) =>
        maxP - ((y - padTop) / mainHeight) * (maxP - minP);

      const stepX = plotWidth / Math.max(1, viewBounds.count);
      const idxToX = (globalIdx: number) =>
        padLeft + (globalIdx - viewBounds.startIdx + 0.5) * stepX;

      return {
        padLeft,
        padRight,
        padTop,
        padBottom,
        plotWidth,
        mainHeight,
        rsiTop,
        rsiHeight,
        minP,
        maxP,
        stepX,
        priceToY,
        yToPrice,
        idxToX,
      };
    },
    [candles, viewBounds, indicators, indicatorData, instrument],
  );

  // Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Theme tokens
    const bg = isDark ? '#0D1119' : '#FFFFFF';
    const gridColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.07)';
    const axisText = isDark ? '#94A3B8' : '#64748B';
    const bullColor = '#10B981';
    const bearColor = '#EF4444';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const g = getChartGeometry(width, height);
    const slice = candles.slice(viewBounds.startIdx, viewBounds.endIdx);
    if (slice.length === 0) return;

    // 1. Horizontal Grid & Price Axis
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const priceLevels = 6;
    for (let i = 0; i <= priceLevels; i++) {
      const p = g.minP + ((g.maxP - g.minP) * i) / priceLevels;
      const y = Math.round(g.priceToY(p)) + 0.5;
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.padLeft, y);
      ctx.lineTo(g.padLeft + g.plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = axisText;
      ctx.fillText(formatPrice(p, instrument.decimals), g.padLeft + g.plotWidth + 6, y);
    }

    // Vertical Time Grid
    const timeStep = Math.max(1, Math.floor(slice.length / 6));
    for (let i = 0; i < slice.length; i += timeStep) {
      const x = Math.round(g.idxToX(viewBounds.startIdx + i)) + 0.5;
      ctx.strokeStyle = gridColor;
      ctx.beginPath();
      ctx.moveTo(x, g.padTop);
      ctx.lineTo(x, height - g.padBottom);
      ctx.stroke();

      const d = new Date(slice[i].time * 1000);
      const label =
        timeframe === '1D'
          ? d.toLocaleDateString([], {month: 'short', day: 'numeric'})
          : d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
      ctx.fillStyle = axisText;
      ctx.textAlign = 'center';
      ctx.fillText(label, x, height - g.padBottom + 13);
    }

    // 2. Volume Bars (bottom 18% of main pane)
    let maxVol = 1;
    for (const c of slice) if (c.volume > maxVol) maxVol = c.volume;
    const volHeight = g.mainHeight * 0.16;
    const candleW = Math.max(2, Math.min(14, g.stepX * 0.66));

    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      const x = g.idxToX(viewBounds.startIdx + i);
      const vh = (c.volume / maxVol) * volHeight;
      ctx.fillStyle =
        c.close >= c.open
          ? 'rgba(16, 185, 129, 0.18)'
          : 'rgba(239, 68, 68, 0.18)';
      ctx.fillRect(
        x - candleW / 2,
        g.padTop + g.mainHeight - vh,
        candleW,
        vh,
      );
    }

    // 3. Bollinger Bands
    if (indicators.bollinger && indicatorData.bb) {
      const drawBandLine = (arr: (number | null)[], stroke: string, dash: number[] = []) => {
        ctx.save();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.setLineDash(dash);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < slice.length; i++) {
          const v = arr[viewBounds.startIdx + i];
          if (v === null) continue;
          const x = g.idxToX(viewBounds.startIdx + i);
          const y = g.priceToY(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.restore();
      };
      drawBandLine(indicatorData.bb.upper, 'rgba(56, 189, 248, 0.55)');
      drawBandLine(indicatorData.bb.mid, 'rgba(56, 189, 248, 0.35)', [4, 4]);
      drawBandLine(indicatorData.bb.lower, 'rgba(56, 189, 248, 0.55)');
    }

    // 4. Candlesticks
    ctx.save();
    ctx.beginPath();
    ctx.rect(g.padLeft, g.padTop, g.plotWidth, g.mainHeight);
    ctx.clip();

    for (let i = 0; i < slice.length; i++) {
      const c = slice[i];
      const x = g.idxToX(viewBounds.startIdx + i);
      const yHigh = g.priceToY(c.high);
      const yLow = g.priceToY(c.low);
      const yOpen = g.priceToY(c.open);
      const yClose = g.priceToY(c.close);
      const bull = c.close >= c.open;
      const col = bull ? bullColor : bearColor;

      // Wick
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();

      // Body
      const bodyTop = Math.min(yOpen, yClose);
      const bodyH = Math.max(1.5, Math.abs(yClose - yOpen));
      ctx.fillStyle = col;
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    }

    // 5. Overlays: EMA 20, EMA 50, VWAP
    const drawOverlay = (arr: (number | null)[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const val = arr[viewBounds.startIdx + i];
        if (val === null || val === undefined) continue;
        const x = g.idxToX(viewBounds.startIdx + i);
        const y = g.priceToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    };

    if (indicators.ema20) drawOverlay(indicatorData.ema20, '#3B82F6');
    if (indicators.ema50) drawOverlay(indicatorData.ema50, '#F59E0B');
    if (indicators.vwap) drawOverlay(indicatorData.vwap, '#A855F7');

    // 6. User Drawings (Trendlines, Horizontals, Fibonacci)
    const timeToX = (t: number) => {
      // Find nearest candle or extrapolate
      for (let i = 0; i < candles.length; i++) {
        if (candles[i].time >= t) {
          return g.idxToX(i);
        }
      }
      return g.idxToX(candles.length - 1);
    };

    const renderDrawing = (
      type: ChartDrawing['type'],
      pts: ChartPoint[],
      color: string,
    ) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;

      if (type === 'HORIZONTAL' && pts.length >= 1) {
        const y = g.priceToY(pts[0].price);
        ctx.beginPath();
        ctx.moveTo(g.padLeft, y);
        ctx.lineTo(g.padLeft + g.plotWidth, y);
        ctx.stroke();
      } else if (type === 'TRENDLINE' && pts.length >= 2) {
        const x1 = timeToX(pts[0].time);
        const y1 = g.priceToY(pts[0].price);
        const x2 = timeToX(pts[1].time);
        const y2 = g.priceToY(pts[1].price);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (type === 'FIBONACCI' && pts.length >= 2) {
        const x1 = Math.min(timeToX(pts[0].time), timeToX(pts[1].time));
        const x2 = Math.max(timeToX(pts[0].time), timeToX(pts[1].time), x1 + 80);
        const pHigh = Math.max(pts[0].price, pts[1].price);
        const pLow = Math.min(pts[0].price, pts[1].price);
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 1];
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        levels.forEach((lvl) => {
          const price = pHigh - (pHigh - pLow) * lvl;
          const y = g.priceToY(price);
          ctx.strokeStyle = lvl === 0.618 || lvl === 0.5 ? '#F59E0B' : 'rgba(59,130,246,0.65)';
          ctx.setLineDash(lvl === 0 || lvl === 1 ? [] : [3, 3]);
          ctx.beginPath();
          ctx.moveTo(x1, y);
          ctx.lineTo(x2, y);
          ctx.stroke();
          ctx.fillStyle = isDark ? '#CBD5E1' : '#334155';
          ctx.fillText(
            `${(lvl * 100).toFixed(1)}% (${formatPrice(price, instrument.decimals)})`,
            x1 + 4,
            y - 6,
          );
        });
      }
      ctx.restore();
    };

    symbolDrawings.forEach((d) => renderDrawing(d.type, d.points, d.color));
    if (draftPoints.length === 1 && activeTool !== 'CURSOR') {
      const y = g.priceToY(draftPoints[0].price);
      const x = timeToX(draftPoints[0].time);
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 7. Position Entry, Stop-Loss, Take-Profit, and Alert Horizontal Overlays
    const drawPriceTagLine = (price: number, color: string, label: string, dashed = false) => {
      const y = g.priceToY(price);
      if (y < g.padTop || y > g.padTop + g.mainHeight) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      if (dashed) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(g.padLeft, y);
      ctx.lineTo(g.padLeft + g.plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = color;
      const textW = ctx.measureText(label).width + 10;
      ctx.fillRect(g.padLeft + 6, y - 9, textW, 17);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, g.padLeft + 11, y);
      ctx.restore();
    };

    symbolPositions.forEach((pos) => {
      drawPriceTagLine(
        pos.entryPrice,
        '#3B82F6',
        `${pos.side} ${pos.quantity} @ ${formatPrice(pos.entryPrice, instrument.decimals)}`,
      );
      if (pos.stopLoss) {
        drawPriceTagLine(
          pos.stopLoss,
          '#EF4444',
          `SL ${formatPrice(pos.stopLoss, instrument.decimals)}`,
          true,
        );
      }
      if (pos.takeProfit) {
        drawPriceTagLine(
          pos.takeProfit,
          '#10B981',
          `TP ${formatPrice(pos.takeProfit, instrument.decimals)}`,
          true,
        );
      }
    });

    symbolAlerts.forEach((al) => {
      drawPriceTagLine(
        al.targetPrice,
        '#F59E0B',
        `ALERT ${formatPrice(al.targetPrice, instrument.decimals)}`,
        true,
      );
    });

    // 7b. Opening Range Breakout (ORB) Band & Levels
    if (indicators.orb && orbAnalysis) {
      const yHigh = g.priceToY(orbAnalysis.orHigh);
      const yLow = g.priceToY(orbAnalysis.orLow);
      const yMid = g.priceToY(orbAnalysis.orMid);
      const bandTop = Math.max(g.padTop, Math.min(yHigh, yLow));
      const bandBot = Math.min(g.padTop + g.mainHeight, Math.max(yHigh, yLow));
      if (bandBot > bandTop) {
        ctx.save();
        ctx.fillStyle = isDark
          ? 'rgba(59, 130, 246, 0.06)'
          : 'rgba(37, 99, 235, 0.05)';
        ctx.fillRect(g.padLeft, bandTop, g.plotWidth, bandBot - bandTop);
        ctx.restore();
      }
      drawPriceTagLine(
        orbAnalysis.orHigh,
        '#059669',
        `OR HIGH ${formatPrice(orbAnalysis.orHigh, instrument.decimals)}`,
        true,
      );
      drawPriceTagLine(
        orbAnalysis.orLow,
        '#DC2626',
        `OR LOW ${formatPrice(orbAnalysis.orLow, instrument.decimals)}`,
        true,
      );
      if (yMid >= g.padTop && yMid <= g.padTop + g.mainHeight) {
        ctx.save();
        ctx.strokeStyle = isDark
          ? 'rgba(148, 163, 184, 0.35)'
          : 'rgba(100, 116, 139, 0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(g.padLeft, yMid);
        ctx.lineTo(g.padLeft + g.plotWidth, yMid);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore(); // unclip main pane

    // 8. Live Last Price Dashed Line + Axis Pill
    const lastY = Math.min(
      g.padTop + g.mainHeight,
      Math.max(g.padTop, g.priceToY(instrument.price)),
    );
    const lastCandle = candles[candles.length - 1];
    const priceBull = lastCandle ? lastCandle.close >= lastCandle.open : true;
    const liveCol = priceBull ? bullColor : bearColor;

    ctx.save();
    ctx.strokeStyle = liveCol;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(g.padLeft, lastY);
    ctx.lineTo(g.padLeft + g.plotWidth, lastY);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = liveCol;
    ctx.fillRect(g.padLeft + g.plotWidth + 2, lastY - 10, g.padRight - 6, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      formatPrice(instrument.price, instrument.decimals),
      g.padLeft + g.plotWidth + 6,
      lastY,
    );

    // 9. RSI Sub-pane
    if (indicators.rsi) {
      ctx.save();
      ctx.strokeStyle = isDark ? '#1E2636' : '#E2E8F0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(g.padLeft, g.rsiTop);
      ctx.lineTo(g.padLeft + g.plotWidth, g.rsiTop);
      ctx.stroke();

      const rsiToY = (r: number) =>
        g.rsiTop + ((100 - r) / 100) * g.rsiHeight;

      // 70 / 30 lines
      [70, 30].forEach((lvl) => {
        const ry = rsiToY(lvl);
        ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(100,116,139,0.22)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(g.padLeft, ry);
        ctx.lineTo(g.padLeft + g.plotWidth, ry);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = axisText;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(String(lvl), g.padLeft + g.plotWidth + 6, ry);
      });

      // RSI curve
      ctx.strokeStyle = '#8B5CF6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const val = indicatorData.rsi[viewBounds.startIdx + i];
        if (val === null || val === undefined) continue;
        const x = g.idxToX(viewBounds.startIdx + i);
        const y = rsiToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Label
      const latestRsi = indicatorData.rsi[candles.length - 1];
      ctx.fillStyle = axisText;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(
        `RSI(14) ${latestRsi !== null && latestRsi !== undefined ? latestRsi.toFixed(1) : '--'}`,
        g.padLeft + 6,
        g.rsiTop + 10,
      );
      ctx.restore();
    }

    // 10. Crosshair
    if (hoverIdx !== null && hoverY !== null) {
      const x = g.idxToX(hoverIdx);
      ctx.save();
      ctx.strokeStyle = isDark ? 'rgba(226,232,240,0.3)' : 'rgba(15,23,42,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, g.padTop);
      ctx.lineTo(x, height - g.padBottom);
      ctx.moveTo(g.padLeft, hoverY);
      ctx.lineTo(g.padLeft + g.plotWidth, hoverY);
      ctx.stroke();

      if (hoverY >= g.padTop && hoverY <= g.padTop + g.mainHeight) {
        const hp = g.yToPrice(hoverY);
        ctx.fillStyle = isDark ? '#334155' : '#475569';
        ctx.fillRect(g.padLeft + g.plotWidth + 2, hoverY - 9, g.padRight - 6, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(
          formatPrice(hp, instrument.decimals),
          g.padLeft + g.plotWidth + 6,
          hoverY,
        );
      }
      ctx.restore();
    }
  }, [
    candles,
    viewBounds,
    indicators,
    indicatorData,
    instrument,
    symbolPositions,
    symbolAlerts,
    orbAnalysis,
    symbolDrawings,
    draftPoints,
    activeTool,
    hoverIdx,
    hoverY,
    isDark,
    timeframe,
    getChartGeometry,
  ]);

  // Pointer interactions
  const resolvePointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const g = getChartGeometry(rect.width, rect.height);
    const relIdx = Math.floor((x - g.padLeft) / g.stepX);
    const clampedIdx = Math.max(
      viewBounds.startIdx,
      Math.min(viewBounds.endIdx - 1, viewBounds.startIdx + relIdx),
    );
    const price = g.yToPrice(y);
    return {x, y, idx: clampedIdx, price, g};
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = resolvePointer(e.clientX, e.clientY);
    if (!pt) return;

    if (activeTool !== 'CURSOR') {
      const candle = candles[pt.idx];
      if (!candle) return;
      const chartPoint: ChartPoint = {time: candle.time, price: pt.price};

      if (activeTool === 'HORIZONTAL') {
        onAddDrawing({
          id: `drw-${Date.now()}`,
          symbol: instrument.symbol,
          type: 'HORIZONTAL',
          points: [chartPoint],
          color: '#38BDF8',
        });
        setActiveTool('CURSOR');
        return;
      }

      const nextDraft = [...draftPoints, chartPoint];
      if (nextDraft.length >= 2) {
        onAddDrawing({
          id: `drw-${Date.now()}`,
          symbol: instrument.symbol,
          type: activeTool,
          points: nextDraft.slice(0, 2),
          color: activeTool === 'TRENDLINE' ? '#3B82F6' : '#F59E0B',
        });
        setDraftPoints([]);
        setActiveTool('CURSOR');
      } else {
        setDraftPoints(nextDraft);
      }
      return;
    }

    setIsDragging(true);
    dragStartRef.current = {x: e.clientX, offset: rightOffset};
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = resolvePointer(e.clientX, e.clientY);
    if (!pt) return;
    setHoverIdx(pt.idx);
    setHoverY(pt.y);

    if (isDragging && activeTool === 'CURSOR') {
      const dx = e.clientX - dragStartRef.current.x;
      const candlesDelta = Math.round(dx / Math.max(4, pt.g.stepX));
      const maxOffset = Math.max(0, candles.length - 25);
      setRightOffset(
        Math.max(0, Math.min(maxOffset, dragStartRef.current.offset + candlesDelta)),
      );
    }
  };

  const handlePointerUp = () => setIsDragging(false);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 8 : -8;
    setVisibleCount((prev) => Math.max(24, Math.min(180, prev + delta)));
  };

  const activeCandle =
    hoverIdx !== null && candles[hoverIdx]
      ? candles[hoverIdx]
      : candles[candles.length - 1];

  return (
    <div className="flex flex-col bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
      {/* Chart Header: Symbol Specs + One-Click Quick Execution */}
      <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-[#1E2636] flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-display text-base font-bold text-slate-900 dark:text-white whitespace-nowrap">
              {instrument.symbol}
            </h1>
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate">
              {instrument.name} · {instrument.dataSource || instrument.exchange}
              {instrument.expiryDate ? ` · Exp ${instrument.expiryDate}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs font-mono tabular-nums">
            <span className="text-base font-semibold text-slate-900 dark:text-white">
              {formatPrice(instrument.price, instrument.decimals)}
            </span>
            <span
              className={
                instrument.changePct >= 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              {instrument.changePct >= 0 ? '+' : ''}
              {instrument.changePct.toFixed(2)}%
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              H {formatPrice(instrument.high24h, instrument.decimals)}
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              L {formatPrice(instrument.low24h, instrument.decimals)}
            </span>
            <span className="hidden sm:inline text-slate-500 dark:text-slate-400">
              Contract {instrument.contractSize.toLocaleString()} {instrument.unitLabel}
            </span>
          </div>
        </div>

        {/* One-Click Instant Trade Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!isOnline}
            onClick={() => onQuickTrade('SELL')}
            className="flex flex-col items-end rounded-lg bg-rose-600/10 hover:bg-rose-600/20 border border-rose-500/30 px-3 py-1.5 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
              Quick Sell
            </span>
            <span className="text-xs font-mono font-semibold text-rose-700 dark:text-rose-300 tabular-nums">
              {formatPrice(instrument.bid, instrument.decimals)}
            </span>
          </button>
          <button
            type="button"
            disabled={!isOnline}
            onClick={() => onQuickTrade('BUY')}
            className="flex flex-col items-start rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-500/30 px-3 py-1.5 transition-colors disabled:opacity-40 cursor-pointer"
          >
            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              Quick Buy
            </span>
            <span className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300 tabular-nums">
              {formatPrice(instrument.ask, instrument.decimals)}
            </span>
          </button>
        </div>
      </div>

      {/* Chart Toolbar: Timeframes, Indicators, Drawing Tools */}
      <div className="px-3 py-1.5 border-b border-slate-200 dark:border-[#1E2636] flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-[#0F141D]">
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onChangeTimeframe(tf)}
              className={`px-2 py-1 text-xs font-mono font-medium rounded transition-colors cursor-pointer ${
                timeframe === tf
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#1A2232]'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 relative">
          {/* Drawing Tools */}
          <div className="flex items-center gap-0.5 border-r border-slate-200 dark:border-[#242E42] pr-2">
            <ToolButton
              active={activeTool === 'CURSOR'}
              onClick={() => {
                setActiveTool('CURSOR');
                setDraftPoints([]);
              }}
              label="Crosshair & Pan"
              icon={<MousePointer className="w-3.5 h-3.5" />}
            />
            <ToolButton
              active={activeTool === 'TRENDLINE'}
              onClick={() => {
                setActiveTool('TRENDLINE');
                setDraftPoints([]);
              }}
              label="Draw Trendline"
              icon={<TrendingUp className="w-3.5 h-3.5" />}
            />
            <ToolButton
              active={activeTool === 'HORIZONTAL'}
              onClick={() => {
                setActiveTool('HORIZONTAL');
                setDraftPoints([]);
              }}
              label="Draw Horizontal Level"
              icon={<Minus className="w-3.5 h-3.5" />}
            />
            <ToolButton
              active={activeTool === 'FIBONACCI'}
              onClick={() => {
                setActiveTool('FIBONACCI');
                setDraftPoints([]);
              }}
              label="Draw Fibonacci Retracement"
              icon={<SlidersHorizontal className="w-3.5 h-3.5" />}
            />
            {symbolDrawings.length > 0 && (
              <ToolButton
                active={false}
                onClick={() => onClearDrawings(instrument.symbol)}
                label="Clear Drawings"
                icon={<Trash2 className="w-3.5 h-3.5 text-rose-500" />}
              />
            )}
          </div>

          {/* Indicators Dropdown */}
          <button
            type="button"
            onClick={() => setShowIndicatorMenu((s) => !s)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#1B2232] transition-colors cursor-pointer"
          >
            <Activity className="w-3.5 h-3.5 text-blue-500" />
            <span>Indicators</span>
          </button>

          {showIndicatorMenu && (
            <div className="absolute right-0 top-9 z-20 w-52 rounded-lg border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#151C28] p-2 shadow-xl space-y-1">
              {(
                [
                  {key: 'orb', label: 'Opening Range (ORB)'},
                  {key: 'ema20', label: 'EMA 20 (Blue)'},
                  {key: 'ema50', label: 'EMA 50 (Amber)'},
                  {key: 'bollinger', label: 'Bollinger Bands (20,2)'},
                  {key: 'vwap', label: 'Session VWAP'},
                  {key: 'rsi', label: 'RSI (14) Oscillator'},
                ] as {key: keyof IndicatorConfig; label: string}[]
              ).map((ind) => (
                <label
                  key={ind.key}
                  className="flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-slate-100 dark:hover:bg-[#1E2636] cursor-pointer text-slate-700 dark:text-slate-200"
                >
                  <span>{ind.label}</span>
                  <input
                    type="checkbox"
                    checked={indicators[ind.key]}
                    onChange={(e) =>
                      setIndicators((prev) => ({
                        ...prev,
                        [ind.key]: e.target.checked,
                      }))
                    }
                    className="accent-blue-600"
                  />
                </label>
              ))}
            </div>
          )}

          {/* Zoom Controls */}
          <button
            type="button"
            onClick={() => setVisibleCount((v) => Math.max(24, v - 14))}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-200/70 dark:hover:bg-[#1A2232] cursor-pointer"
            aria-label="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setVisibleCount((v) => Math.min(180, v + 14))}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded hover:bg-slate-200/70 dark:hover:bg-[#1A2232] cursor-pointer"
            aria-label="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* OHLCV Readout Strip */}
      <div className="px-3.5 py-1 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums border-b border-slate-100 dark:border-[#19202E] bg-white dark:bg-[#0D1119] text-slate-600 dark:text-slate-400">
        {activeCandle ? (
          <div className="flex flex-wrap items-center gap-3">
            <span>O {formatPrice(activeCandle.open, instrument.decimals)}</span>
            <span>H {formatPrice(activeCandle.high, instrument.decimals)}</span>
            <span>L {formatPrice(activeCandle.low, instrument.decimals)}</span>
            <span
              className={
                activeCandle.close >= activeCandle.open
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }
            >
              C {formatPrice(activeCandle.close, instrument.decimals)}
            </span>
            <span>Vol {activeCandle.volume.toLocaleString()}</span>
          </div>
        ) : (
          <span>Loading OHLCV...</span>
        )}
        {activeTool !== 'CURSOR' && (
          <span className="text-blue-500 font-sans font-medium">
            {activeTool === 'HORIZONTAL'
              ? 'Click chart to place horizontal level'
              : draftPoints.length === 0
              ? `Click chart for start point (${activeTool.toLowerCase()})`
              : 'Click chart for end point'}
          </span>
        )}
      </div>

      {/* Main Canvas Viewport */}
      <div
        ref={containerRef}
        className="relative w-full h-[360px] sm:h-[420px] lg:h-[440px] select-none touch-none"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => {
            setHoverIdx(null);
            setHoverY(null);
            setIsDragging(false);
          }}
          onWheel={handleWheel}
          className={activeTool === 'CURSOR' ? 'cursor-crosshair' : 'cursor-cell'}
        />
      </div>
    </div>
  );
};

const ToolButton: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}> = ({active, onClick, label, icon}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    className={`p-1.5 rounded transition-colors cursor-pointer ${
      active
        ? 'bg-blue-600 text-white'
        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-[#1B2232]'
    }`}
  >
    {icon}
  </button>
);
