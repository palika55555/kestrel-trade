import React, {useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
} from 'lucide-react';
import {formatCurrency} from '../services/tradingMath';
import type {BrokerStatus} from '../types/trading';

interface BrokerConnectionCardProps {
  brokerStatus: BrokerStatus | null;
  isOnline: boolean;
  onSyncBroker: () => Promise<void>;
  onToggleRouting: (armed: boolean) => Promise<void>;
}

export const BrokerConnectionCard: React.FC<BrokerConnectionCardProps> = ({
  brokerStatus,
  isOnline,
  onSyncBroker,
  onToggleRouting,
}) => {
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);
  const [selectedGuide, setSelectedGuide] = useState<'OANDA' | 'METAAPI' | 'CTRADER' | 'WEBHOOK'>('OANDA');

  const configured = Boolean(brokerStatus?.configured);
  const armed = Boolean(brokerStatus?.routingArmed);
  const provider = brokerStatus?.provider || 'SIMULATION';

  const handleSync = async () => {
    setSyncing(true);
    try {
      await onSyncBroker();
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async () => {
    setToggling(true);
    try {
      await onToggleRouting(!armed);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              armed
                ? 'bg-emerald-500/15 text-emerald-500'
                : configured
                ? 'bg-blue-500/15 text-blue-500'
                : 'bg-slate-100 dark:bg-[#19202E] text-slate-500 dark:text-slate-400'
            }`}
          >
            <Link2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Real Broker Execution Bridge
              </h2>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
                  armed
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : configured
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'bg-slate-100 dark:bg-[#1A2130] text-slate-500 dark:text-slate-400'
                }`}
              >
                {armed
                  ? `LIVE ROUTING ARMED · ${provider}`
                  : configured
                  ? `CONNECTED (DISARMED) · ${provider}`
                  : 'PAPER SIMULATION ONLY'}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Server-side execution adapter for 24/7 XAU/USD Bot (OANDA v20, MT4/MT5 via MetaApi, or Broker Webhook).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!isOnline || syncing}
            onClick={handleSync}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#263042] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-[#1B2232] disabled:opacity-40 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            <span>Sync Broker</span>
          </button>

          <button
            type="button"
            disabled={!isOnline || !configured || toggling}
            onClick={handleToggle}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
              armed
                ? 'bg-rose-600 text-white hover:bg-rose-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>{armed ? 'Disarm Real Broker' : 'Arm Real Broker Routing'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSetupGuide((s) => !s)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#263042] text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1B2232] cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{showSetupGuide ? 'Hide Setup' : 'How to Connect'}</span>
          </button>
        </div>
      </div>

      {/* Broker Account Telemetry */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Account Bridge</div>
          <div className="mt-1 text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {brokerStatus?.accountLabel || 'Paper Simulation Ledger'}
          </div>
          <div className="mt-0.5 text-[10px] font-mono text-slate-400 uppercase">
            {brokerStatus?.environment || 'practice'} mode
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Broker Balance</div>
          <div className="mt-1 text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
            {brokerStatus?.balance !== null && brokerStatus?.balance !== undefined
              ? `${formatCurrency(brokerStatus.balance)} ${brokerStatus.currency}`
              : '--'}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            {configured ? 'Press Sync Broker to refresh' : 'Set secrets to connect'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Broker Equity / NAV</div>
          <div className="mt-1 text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
            {brokerStatus?.equity !== null && brokerStatus?.equity !== undefined
              ? `${formatCurrency(brokerStatus.equity)} ${brokerStatus.currency}`
              : '--'}
          </div>
          <div className="mt-0.5 text-[10px] font-mono text-slate-400">
            Open broker trades: {brokerStatus?.openPositionsCount ?? 0}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 dark:border-[#1E2636] bg-slate-50 dark:bg-[#0D1119] p-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400">Last Routed Order</div>
          <div className="mt-1 text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
            {brokerStatus?.lastOrderSummary || 'No live orders yet'}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-400">
            {brokerStatus?.lastSyncedAt
              ? `Synced ${new Date(brokerStatus.lastSyncedAt).toLocaleTimeString()}`
              : 'Not synced'}
          </div>
        </div>
      </div>

      {brokerStatus?.lastError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Broker API notice: {brokerStatus.lastError}</span>
        </div>
      )}

      {!configured && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <strong>Bezpečné serverové pripojenie:</strong> API kľúče brokera sa nikdy neukladajú do prehliadača. Zapíš ich do súboru <code>.env</code> v koreňovom priečinku projektu a reštartuj server — potom sa tlačidlo <strong>Arm Real Broker Routing</strong> automaticky odomkne.
          </div>
        </div>
      )}

      {configured && !armed && (
        <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 px-3 py-2 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>
            Broker <strong>{provider}</strong> je pripojený na serveri, ale smerovanie príkazov je zatiaľ bezpečne vypnuté. Keď budeš pripravený obchodovať na broker účte, klikni na <strong>Arm Real Broker Routing</strong>.
          </span>
        </div>
      )}

      {showSetupGuide && (
        <div className="rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] p-3.5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Vyber brokera a doplň kľúče do .env (server-side):
            </span>
            <div className="flex items-center gap-1">
              {(['OANDA', 'METAAPI', 'CTRADER', 'WEBHOOK'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setSelectedGuide(g)}
                  className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                    selectedGuide === g
                      ? 'bg-blue-600 text-white'
                      : 'bg-white dark:bg-[#141B29] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-[#242E42]'
                  }`}
                >
                  {g === 'OANDA'
                    ? 'OANDA (XAU/USD)'
                    : g === 'METAAPI'
                    ? 'MT4 / MT5 (MetaApi)'
                    : g === 'CTRADER'
                    ? 'cTrader Open API'
                    : 'Custom Webhook'}
                </button>
              ))}
            </div>
          </div>

          {selectedGuide === 'OANDA' && (
            <div className="space-y-2 text-slate-600 dark:text-slate-300">
              <p>
                Priame API napojenie na <strong>OANDA v20</strong> (najprv odporúčame <code>practice</code> demo účet, neskôr prepnúť <code>OANDA_ENV=live</code>):
              </p>
              <pre className="p-2.5 rounded bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto">
{`# .env
OANDA_API_TOKEN="tvoj_oanda_token"
OANDA_ACCOUNT_ID="101-004-XXXXXXX-001"
OANDA_ENV="practice"`}
              </pre>
            </div>
          )}

          {selectedGuide === 'METAAPI' && (
            <div className="space-y-2 text-slate-600 dark:text-slate-300">
              <p>
                Pre ľubovoľného <strong>MT4 / MT5 brokera</strong> (IC Markets, Pepperstone, FTMO, XM, Exness...) cez <strong>MetaApi Cloud</strong>:
              </p>
              <pre className="p-2.5 rounded bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto">
{`# .env
METAAPI_TOKEN="tvoj_metaapi_token"
METAAPI_ACCOUNT_ID="uuid_uctu_z_metaapi"
METAAPI_SYMBOL_XAU="XAUUSD"`}
              </pre>
            </div>
          )}

          {selectedGuide === 'CTRADER' && (
            <div className="space-y-2 text-slate-600 dark:text-slate-300">
              <p>
                Priame napojenie na <strong>cTrader Open API</strong> bez MetaApi. Zaregistruj aplikáciu na openapi.ctrader.com s Redirect URL nižšie, doplň kľúče, reštartuj server a klikni na Pripojiť:
              </p>
              <pre className="p-2.5 rounded bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto">
{`# .env
CTRADER_CLIENT_ID="tvoj_client_id"
CTRADER_CLIENT_SECRET="tvoj_client_secret"
CTRADER_REDIRECT_URI="http://localhost:3000/api/ctrader/callback"
CTRADER_ENV="demo"`}
              </pre>
              <a
                href="/api/ctrader/connect"
                className="inline-block px-3 py-1.5 rounded bg-blue-600 text-white font-medium hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
              >
                Pripojiť cTrader účet
              </a>
            </div>
          )}

          {selectedGuide === 'WEBHOOK' && (
            <div className="space-y-2 text-slate-600 dark:text-slate-300">
              <p>
                Pre vlastný MT5 Python bridge / cTrader / webhook endpoint (server odošle JSON pre OPEN, CLOSE, PARTIAL_CLOSE):
              </p>
              <pre className="p-2.5 rounded bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto">
{`# .env
BROKER_WEBHOOK_URL="https://tvoj-bridge.example.com/trade"
BROKER_WEBHOOK_SECRET="tajny_bearer_kluc"`}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
