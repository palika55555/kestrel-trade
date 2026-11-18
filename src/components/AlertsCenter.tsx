import React, {useRef, useState} from 'react';
import {
  Bell,
  BellRing,
  Bot,
  CheckCheck,
  Download,
  Plus,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type {PushPermissionState} from '../services/notifications';
import {formatPrice} from '../services/tradingMath';
import type {
  AlertNotification,
  Instrument,
  NotificationAutomationConfig,
  ORBAnalysis,
  ORBWindowMinutes,
  PriceAlert,
  RiskSettings,
  StagedOrderPreset,
} from '../types/trading';

interface AlertsCenterProps {
  instruments: Instrument[];
  priceAlerts: PriceAlert[];
  notifications: AlertNotification[];
  pushPermission: PushPermissionState;
  riskSettings: RiskSettings;
  automationConfig: NotificationAutomationConfig;
  orbScanner: ORBAnalysis[];
  onRequestPushPermission: () => void;
  onSendTestPush: () => void;
  onCreateAlert: (alert: {
    symbol: string;
    condition: 'ABOVE' | 'BELOW';
    targetPrice: number;
    note?: string;
  }) => void;
  onDeleteAlert: (id: string) => void;
  onMarkAllRead: () => void;
  onUpdateRiskSettings: (next: RiskSettings) => void;
  onUpdateAutomationConfig: (next: NotificationAutomationConfig) => void;
  onImportRulesPayload: (jsonText: string) => {ok: boolean; message: string};
  onStageFromScanner: (preset: StagedOrderPreset) => void;
}

export const AlertsCenter: React.FC<AlertsCenterProps> = ({
  instruments,
  priceAlerts,
  notifications,
  pushPermission,
  riskSettings,
  automationConfig,
  orbScanner,
  onRequestPushPermission,
  onSendTestPush,
  onCreateAlert,
  onDeleteAlert,
  onMarkAllRead,
  onUpdateRiskSettings,
  onUpdateAutomationConfig,
  onImportRulesPayload,
  onStageFromScanner,
}) => {
  const [symbol, setSymbol] = useState(instruments[0]?.symbol || 'ES1!');
  const [condition, setCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const selectedInst = instruments.find((i) => i.symbol === symbol) || instruments[0];
  const [targetPrice, setTargetPrice] = useState(
    selectedInst ? String((selectedInst.price * 1.005).toFixed(selectedInst.decimals)) : '',
  );
  const [note, setNote] = useState('');
  const [importText, setImportText] = useState('');
  const [showImportBox, setShowImportBox] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ok: boolean; message: string} | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSymbolChange = (nextSym: string) => {
    setSymbol(nextSym);
    const inst = instruments.find((i) => i.symbol === nextSym);
    if (inst) {
      const mult = condition === 'ABOVE' ? 1.005 : 0.995;
      setTargetPrice((inst.price * mult).toFixed(inst.decimals));
    }
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(targetPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    onCreateAlert({
      symbol,
      condition,
      targetPrice: price,
      note: note.trim() || undefined,
    });
    setNote('');
  };

  const handleExportRules = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      automationConfig,
      priceAlerts: priceAlerts.filter((a) => a.active),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kestrel-orb-automation-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const res = onImportRulesPayload(content);
      setImportFeedback(res);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const instrumentsMap = new Map(instruments.map((i) => [i.symbol, i]));

  return (
    <div className="space-y-5">
      {/* Push Notification Permissions & Channel Controls */}
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400">
            <BellRing className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Notification Automation &amp; Automated Stop-Loss Triggers
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Browser permission:{' '}
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                {pushPermission}
              </span>{' '}
              · Live ORB breakouts, retests, price alerts, and stop-loss executions dispatch automatically.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#242E42] cursor-pointer">
            <Volume2 className="w-3.5 h-3.5 text-slate-400" />
            <span>Audio Chime</span>
            <input
              type="checkbox"
              checked={riskSettings.enableAudioChime}
              onChange={(e) =>
                onUpdateRiskSettings({
                  ...riskSettings,
                  enableAudioChime: e.target.checked,
                })
              }
              className="accent-blue-600"
            />
          </label>

          {pushPermission !== 'granted' && pushPermission !== 'unsupported' && (
            <button
              type="button"
              onClick={onRequestPushPermission}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Enable Push Notifications
            </button>
          )}

          <button
            type="button"
            onClick={onSendTestPush}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] transition-colors cursor-pointer"
          >
            Send Test Alert
          </button>
        </div>
      </div>

      {/* ORB Notification Automation Engine + Import/Export Rules */}
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-[#1E2636] pb-3">
          <div className="flex items-center gap-2.5">
            <Bot className="w-4 h-4 text-blue-500" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                ORB Signal &amp; Notification Automation Rules
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Continuously scans all markets for Opening Range Long/Short breakouts and retest triggers
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import Rules JSON</span>
            </button>
            <button
              type="button"
              onClick={() => setShowImportBox((s) => !s)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] cursor-pointer"
            >
              Paste JSON
            </button>
            <button
              type="button"
              onClick={handleExportRules}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Rules</span>
            </button>
          </div>
        </div>

        {importFeedback && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              importFeedback.ok
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
            }`}
          >
            {importFeedback.message}
          </div>
        )}

        {showImportBox && (
          <div className="space-y-2 rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] p-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Paste Automation Config &amp; Alert Rules JSON
            </label>
            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"automationConfig": {"enabled": true, "orbWindowMinutes": 15, "notifyOnLongBreakout": true, "notifyOnShortBreakout": true}, "priceAlerts": []}'
              className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-white dark:bg-[#121721] p-2.5 text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowImportBox(false)}
                className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-[#263042] text-slate-600 dark:text-slate-300 cursor-pointer"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const res = onImportRulesPayload(importText);
                  setImportFeedback(res);
                  if (res.ok) setShowImportBox(false);
                }}
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              >
                Apply Imported Rules
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2.5 cursor-pointer">
            <span className="font-medium text-slate-800 dark:text-slate-200">
              Enable Auto-Alerts
            </span>
            <input
              type="checkbox"
              checked={automationConfig.enabled}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  enabled: e.target.checked,
                })
              }
              className="accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2.5 cursor-pointer">
            <span className="text-slate-700 dark:text-slate-300">
              Notify Long Breakouts
            </span>
            <input
              type="checkbox"
              checked={automationConfig.notifyOnLongBreakout}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  notifyOnLongBreakout: e.target.checked,
                })
              }
              className="accent-emerald-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2.5 cursor-pointer">
            <span className="text-slate-700 dark:text-slate-300">
              Notify Short Breakouts
            </span>
            <input
              type="checkbox"
              checked={automationConfig.notifyOnShortBreakout}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  notifyOnShortBreakout: e.target.checked,
                })
              }
              className="accent-rose-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2.5 cursor-pointer">
            <span className="text-slate-700 dark:text-slate-300">
              Notify Retest Setups
            </span>
            <input
              type="checkbox"
              checked={automationConfig.notifyOnRetestSetup}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  notifyOnRetestSetup: e.target.checked,
                })
              }
              className="accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2.5 cursor-pointer">
            <span className="text-slate-700 dark:text-slate-300">
              Require VWAP Confluence
            </span>
            <input
              type="checkbox"
              checked={automationConfig.requireVwapConfluence}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  requireVwapConfluence: e.target.checked,
                })
              }
              className="accent-blue-600"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2.5 cursor-pointer">
            <span className="text-slate-700 dark:text-slate-300">
              RSI Extremes (&gt;70 / &lt;30)
            </span>
            <input
              type="checkbox"
              checked={automationConfig.notifyOnRsiExtremes}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  notifyOnRsiExtremes: e.target.checked,
                })
              }
              className="accent-blue-600"
            />
          </label>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2">
            <span className="text-slate-700 dark:text-slate-300">ORB Window</span>
            <select
              value={automationConfig.orbWindowMinutes}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  orbWindowMinutes: Number(e.target.value) as ORBWindowMinutes,
                })
              }
              className="rounded border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] px-2 py-1 font-mono text-xs"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] px-3 py-2">
            <span className="text-slate-700 dark:text-slate-300">Cooldown (min)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={automationConfig.cooldownMinutes}
              onChange={(e) =>
                onUpdateAutomationConfig({
                  ...automationConfig,
                  cooldownMinutes: Math.max(1, Number(e.target.value) || 10),
                })
              }
              className="w-16 rounded border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#121721] px-2 py-1 text-right font-mono text-xs"
            />
          </div>
        </div>
      </div>

      {/* Multi-Asset Live ORB Scanner Matrix */}
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Multi-Asset ORB Scanner ({automationConfig.orbWindowMinutes}m Window)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Real-time Opening Range High/Low triggers showing exact Long and Short setups across all instruments
            </p>
          </div>
          <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
            {orbScanner.length} scanned
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#1E2636] text-[11px] font-medium text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4">Contract</th>
                <th className="py-2.5 px-3 text-right">Last</th>
                <th className="py-2.5 px-3 text-right">OR Low – High</th>
                <th className="py-2.5 px-3">Signal &amp; Bias</th>
                <th className="py-2.5 px-3 text-right">Confluence</th>
                <th className="py-2.5 px-3 text-right">Long Trigger</th>
                <th className="py-2.5 px-3 text-right">Short Trigger</th>
                <th className="py-2.5 px-4 text-right">Stage Trade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1A2130] text-xs">
              {orbScanner.map((row) => {
                const dec = instrumentsMap.get(row.symbol)?.decimals ?? 2;
                const biasCls =
                  row.bias === 'LONG'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : row.bias === 'SHORT'
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-slate-500 dark:text-slate-400';

                return (
                  <tr
                    key={row.symbol}
                    className="h-11 hover:bg-slate-50 dark:hover:bg-[#161D2A]"
                  >
                    <td className="py-2 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {row.symbol}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {formatPrice(row.currentPrice, dec)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatPrice(row.orLow, dec)} – {formatPrice(row.orHigh, dec)}
                    </td>
                    <td className={`py-2 px-3 font-mono font-medium ${biasCls}`}>
                      {row.signal.replace('_', ' ')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {row.confidenceScore}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                      &gt; {formatPrice(row.longPlan.entryPrice, dec)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">
                      &lt; {formatPrice(row.shortPlan.entryPrice, dec)}
                    </td>
                    <td className="py-2 px-4 text-right whitespace-nowrap space-x-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onStageFromScanner({
                            symbol: row.symbol,
                            side: 'BUY',
                            type:
                              row.signal === 'LONG_BREAKOUT' ||
                              row.signal === 'LONG_RETEST'
                                ? 'MARKET'
                                : 'STOP',
                            triggerPrice:
                              row.signal === 'LONG_BREAKOUT' ||
                              row.signal === 'LONG_RETEST'
                                ? undefined
                                : row.longPlan.entryPrice,
                            stopLoss: row.longPlan.stopLoss,
                            takeProfit: row.longPlan.takeProfit2R,
                            sourceLabel: `ORB ${row.windowMinutes}m LONG`,
                            nonce: Date.now(),
                          })
                        }
                        className="px-2 py-1 text-[11px] font-semibold rounded bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-600/25 cursor-pointer"
                      >
                        Long
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onStageFromScanner({
                            symbol: row.symbol,
                            side: 'SELL',
                            type:
                              row.signal === 'SHORT_BREAKOUT' ||
                              row.signal === 'SHORT_RETEST'
                                ? 'MARKET'
                                : 'STOP',
                            triggerPrice:
                              row.signal === 'SHORT_BREAKOUT' ||
                              row.signal === 'SHORT_RETEST'
                                ? undefined
                                : row.shortPlan.entryPrice,
                            stopLoss: row.shortPlan.stopLoss,
                            takeProfit: row.shortPlan.takeProfit2R,
                            sourceLabel: `ORB ${row.windowMinutes}m SHORT`,
                            nonce: Date.now(),
                          })
                        }
                        className="px-2 py-1 text-[11px] font-semibold rounded bg-rose-600/15 text-rose-600 dark:text-rose-400 hover:bg-rose-600/25 cursor-pointer"
                      >
                        Short
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Create Price Alert Form + Active Alerts */}
        <div className="lg:col-span-5 space-y-4">
          <form
            onSubmit={handleCreate}
            className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Create Price Alert
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Instrument
                </label>
                <select
                  value={symbol}
                  onChange={(e) => handleSymbolChange(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                >
                  {instruments.map((inst) => (
                    <option key={inst.symbol} value={inst.symbol}>
                      {inst.symbol} ({formatPrice(inst.price, inst.decimals)})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Trigger Condition
                </label>
                <select
                  value={condition}
                  onChange={(e) =>
                    setCondition(e.target.value as 'ABOVE' | 'BELOW')
                  }
                  className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-2.5 py-2 text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="ABOVE">Price Crosses Above</option>
                  <option value="BELOW">Price Crosses Below</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Target Price
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={targetPrice}
                  onChange={(e) => setTargetPrice(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Breakout level"
                  className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Arm Price Alert</span>
            </button>
          </form>

          {/* Armed Price Alerts List */}
          <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Active Price Alerts ({priceAlerts.filter((a) => a.active).length})
              </h3>
            </div>
            {priceAlerts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No price alerts configured.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-[#1A2130]">
                {priceAlerts.map((al) => {
                  const inst = instrumentsMap.get(al.symbol);
                  const dec = inst?.decimals ?? 2;
                  return (
                    <div
                      key={al.id}
                      className="px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {al.symbol}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 font-mono">
                            {al.condition === 'ABOVE' ? '≥' : '≤'}{' '}
                            {formatPrice(al.targetPrice, dec)}
                          </span>
                          <span
                            className={`text-[11px] font-medium ${
                              al.active
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {al.active ? 'Armed' : 'Triggered'}
                          </span>
                        </div>
                        {al.note && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {al.note}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteAlert(al.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded cursor-pointer"
                        aria-label="Delete alert"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Notification Event Log */}
        <div className="lg:col-span-7 bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-[#1E2636] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Notification &amp; Trigger Log
              </h3>
            </div>
            {notifications.some((n) => !n.read) && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
              No notifications dispatched yet. ORB Long/Short signals, price alerts, automated stop-loss triggers, and trade fills will appear here.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-[#1A2130] max-h-[540px] overflow-y-auto">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-4 py-3 flex items-start justify-between gap-3 text-xs ${
                    !n.read ? 'bg-blue-50/40 dark:bg-blue-950/15' : ''
                  }`}
                >
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-semibold ${
                          n.category === 'STOP_LOSS' || n.category === 'MARGIN_WARNING'
                            ? 'text-rose-600 dark:text-rose-400'
                            : n.category === 'TAKE_PROFIT'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : n.category === 'ORB_SIGNAL'
                            ? 'text-blue-600 dark:text-blue-400'
                            : n.category === 'PRICE_ALERT'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {n.title}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(n.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{n.body}</p>
                  </div>
                  {!n.read && (
                    <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 shrink-0">
                      New
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
