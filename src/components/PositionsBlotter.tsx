import React, {useState} from 'react';
import {Edit3, X} from 'lucide-react';
import {
  computeUnrealizedPnl,
  formatCurrency,
  formatPrice,
} from '../services/tradingMath';
import type {
  Instrument,
  PendingOrder,
  Position,
  TradeExecution,
} from '../types/trading';

interface PositionsBlotterProps {
  positions: Position[];
  pendingOrders: PendingOrder[];
  executions: TradeExecution[];
  instrumentsMap: Map<string, Instrument>;
  isOnline: boolean;
  onSelectSymbol: (symbol: string) => void;
  onClosePosition: (positionId: string, fraction?: number) => void;
  onUpdatePositionRisk: (
    positionId: string,
    stopLoss: number | null,
    takeProfit: number | null,
  ) => void;
  onCancelPendingOrder: (orderId: string) => void;
  onFlattenAll: () => void;
}

type BlotterTab = 'POSITIONS' | 'ORDERS' | 'HISTORY';

export const PositionsBlotter: React.FC<PositionsBlotterProps> = ({
  positions,
  pendingOrders,
  executions,
  instrumentsMap,
  isOnline,
  onSelectSymbol,
  onClosePosition,
  onUpdatePositionRisk,
  onCancelPendingOrder,
  onFlattenAll,
}) => {
  const [tab, setTab] = useState<BlotterTab>('POSITIONS');
  const [editingPos, setEditingPos] = useState<Position | null>(null);
  const [editSl, setEditSl] = useState('');
  const [editTp, setEditTp] = useState('');

  const openEditModal = (pos: Position) => {
    setEditingPos(pos);
    setEditSl(pos.stopLoss ? String(pos.stopLoss) : '');
    setEditTp(pos.takeProfit ? String(pos.takeProfit) : '');
  };

  const saveEditRisk = () => {
    if (!editingPos) return;
    const sl = parseFloat(editSl);
    const tp = parseFloat(editTp);
    onUpdatePositionRisk(
      editingPos.id,
      Number.isFinite(sl) && sl > 0 ? sl : null,
      Number.isFinite(tp) && tp > 0 ? tp : null,
    );
    setEditingPos(null);
  };

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
      {/* Header Tabs */}
      <div className="px-3.5 py-2 border-b border-slate-200 dark:border-[#1E2636] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <BlotterTabBtn
            active={tab === 'POSITIONS'}
            onClick={() => setTab('POSITIONS')}
            label={`Open Positions (${positions.length})`}
          />
          <BlotterTabBtn
            active={tab === 'ORDERS'}
            onClick={() => setTab('ORDERS')}
            label={`Pending Orders (${pendingOrders.length})`}
          />
          <BlotterTabBtn
            active={tab === 'HISTORY'}
            onClick={() => setTab('HISTORY')}
            label={`Trade Blotter (${executions.length})`}
          />
        </div>

        {positions.length > 0 && (
          <button
            type="button"
            disabled={!isOnline}
            onClick={onFlattenAll}
            className="px-2.5 py-1 text-xs font-medium rounded-md border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            Close All Positions
          </button>
        )}
      </div>

      {/* Content */}
      <div className="overflow-x-auto">
        {tab === 'POSITIONS' && (
          positions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No open CFD or Futures positions. Place an order in the Order Ticket to begin.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-3.5">Instrument</th>
                  <th className="py-2 px-3">Side</th>
                  <th className="py-2 px-3 text-right">Size</th>
                  <th className="py-2 px-3 text-right">Entry</th>
                  <th className="py-2 px-3 text-right">Mark</th>
                  <th className="py-2 px-3 text-right">SL / TP</th>
                  <th className="py-2 px-3 text-right">Margin</th>
                  <th className="py-2 px-3 text-right">Unrealized P&L</th>
                  <th className="py-2 px-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
                {positions.map((pos) => {
                  const inst = instrumentsMap.get(pos.symbol);
                  const decimals = inst?.decimals ?? 2;
                  const mark = inst
                    ? pos.side === 'BUY'
                      ? inst.bid
                      : inst.ask
                    : pos.entryPrice;
                  const pnl = inst ? computeUnrealizedPnl(pos, inst) : 0;
                  const roe = pos.marginUsed > 0 ? (pnl / pos.marginUsed) * 100 : 0;
                  const positive = pnl >= 0;

                  return (
                    <tr
                      key={pos.id}
                      className="hover:bg-slate-50 dark:hover:bg-[#161D2A] transition-colors h-11"
                    >
                      <td className="py-2 px-3.5 font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(pos.symbol)}
                          className="hover:text-blue-500 cursor-pointer"
                        >
                          {pos.symbol}
                        </button>
                        <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                          {pos.leverage}x{pos.source === 'XAU_BOT' ? ' · Bot' : ''}
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span
                          className={`font-medium ${
                            pos.side === 'BUY'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {pos.side === 'BUY' ? 'Long' : 'Short'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {pos.quantity}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatPrice(pos.entryPrice, decimals)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatPrice(mark, decimals)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {pos.stopLoss ? formatPrice(pos.stopLoss, decimals) : '--'} /{' '}
                        {pos.takeProfit ? formatPrice(pos.takeProfit, decimals) : '--'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatCurrency(pos.marginUsed)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          positive
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {positive ? '+' : ''}
                        {formatCurrency(pnl)}{' '}
                        <span className="text-[11px] font-normal opacity-80">
                          ({positive ? '+' : ''}
                          {roe.toFixed(1)}%)
                        </span>
                      </td>
                      <td className="py-2 px-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditModal(pos)}
                            className="p-1.5 rounded text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-[#1E2636] cursor-pointer"
                            title="Edit Stop-Loss / Take-Profit"
                            aria-label="Edit SL/TP"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={!isOnline}
                            onClick={() => onClosePosition(pos.id, 0.5)}
                            className="px-2 py-1 rounded text-[11px] font-medium border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1E2636] disabled:opacity-40 cursor-pointer"
                          >
                            50%
                          </button>
                          <button
                            type="button"
                            disabled={!isOnline}
                            onClick={() => onClosePosition(pos.id, 1)}
                            className="px-2 py-1 rounded text-[11px] font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 cursor-pointer"
                          >
                            Close
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === 'ORDERS' && (
          pendingOrders.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No active Limit or Stop orders pending execution.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-3.5">Instrument</th>
                  <th className="py-2 px-3">Type · Side</th>
                  <th className="py-2 px-3 text-right">Size</th>
                  <th className="py-2 px-3 text-right">Trigger Price</th>
                  <th className="py-2 px-3 text-right">SL / TP</th>
                  <th className="py-2 px-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
                {pendingOrders.map((ord) => {
                  const dec = instrumentsMap.get(ord.symbol)?.decimals ?? 2;
                  return (
                    <tr key={ord.id} className="h-11 hover:bg-slate-50 dark:hover:bg-[#161D2A]">
                      <td className="py-2 px-3.5 font-semibold text-slate-900 dark:text-slate-100">
                        {ord.symbol}
                      </td>
                      <td className="py-2 px-3">
                        <span className="text-slate-600 dark:text-slate-300">
                          {ord.type} ·{' '}
                        </span>
                        <span
                          className={
                            ord.side === 'BUY'
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'text-rose-600 dark:text-rose-400 font-medium'
                          }
                        >
                          {ord.side}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {ord.quantity}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {formatPrice(ord.triggerPrice, dec)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-[11px] text-slate-500 dark:text-slate-400">
                        {ord.stopLoss ? formatPrice(ord.stopLoss, dec) : '--'} /{' '}
                        {ord.takeProfit ? formatPrice(ord.takeProfit, dec) : '--'}
                      </td>
                      <td className="py-2 px-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => onCancelPendingOrder(ord.id)}
                          className="px-2.5 py-1 rounded text-[11px] font-medium border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1E2636] cursor-pointer"
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}

        {tab === 'HISTORY' && (
          executions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              No executions logged yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <th className="py-2 px-3.5">Time</th>
                  <th className="py-2 px-3">Instrument</th>
                  <th className="py-2 px-3">Event</th>
                  <th className="py-2 px-3 text-right">Size</th>
                  <th className="py-2 px-3 text-right">Fill Price</th>
                  <th className="py-2 px-3 text-right">Fee</th>
                  <th className="py-2 px-3.5 text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
                {executions.slice(0, 25).map((ex) => {
                  const dec = instrumentsMap.get(ex.symbol)?.decimals ?? 2;
                  return (
                    <tr key={ex.id} className="h-10 hover:bg-slate-50 dark:hover:bg-[#161D2A]">
                      <td className="py-2 px-3.5 font-mono text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {new Date(ex.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                        {ex.symbol}
                        {ex.source === 'XAU_BOT' && (
                          <span className="ml-1.5 text-[11px] font-normal text-blue-500">
                            · Bot
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {ex.action.replace('_', ' ')} · {ex.side}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {ex.quantity}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                        {formatPrice(ex.price, dec)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {formatCurrency(ex.fee)}
                      </td>
                      <td
                        className={`py-2 px-3.5 text-right font-mono tabular-nums font-medium ${
                          ex.realizedPnl > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : ex.realizedPnl < 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {ex.realizedPnl === 0
                          ? '--'
                          : `${ex.realizedPnl > 0 ? '+' : ''}${formatCurrency(ex.realizedPnl)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>

      {/* Inline SL/TP Edit Modal */}
      {editingPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] p-5 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Modify Risk Levels — {editingPos.symbol}
              </h3>
              <button
                type="button"
                onClick={() => setEditingPos(null)}
                className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Stop-Loss Price
                </label>
                <input
                  type="number"
                  step="any"
                  value={editSl}
                  onChange={(e) => setEditSl(e.target.value)}
                  placeholder="Leave blank to clear"
                  className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                  Take-Profit Price
                </label>
                <input
                  type="number"
                  step="any"
                  value={editTp}
                  onChange={(e) => setEditTp(e.target.value)}
                  placeholder="Leave blank to clear"
                  className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingPos(null)}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditRisk}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              >
                Save Levels
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const BlotterTabBtn: React.FC<{
  active: boolean;
  onClick: () => void;
  label: string;
}> = ({active, onClick, label}) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
      active
        ? 'bg-slate-100 dark:bg-[#1B2232] text-slate-900 dark:text-white'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
    }`}
  >
    {label}
  </button>
);
