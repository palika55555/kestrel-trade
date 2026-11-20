import React, {type Dispatch, type SetStateAction} from 'react';
import {AlertsCenter} from '../../components/AlertsCenter';
import {
  requestNotificationPermission,
  type PushPermissionState,
} from '../../services/notifications';
import type {
  ActiveTab,
  AlertNotification,
  Instrument,
  NotificationAutomationConfig,
  ORBAnalysis,
  PriceAlert,
  RiskSettings,
  StagedOrderPreset,
} from '../../types/trading';
import type {EmitNotification} from '../market/tickContext';
import type {MobileTradePanel} from '../trade/types';

interface AlertsTabProps {
  instruments: Instrument[];
  selectedInstrument: Instrument | null;
  priceAlerts: PriceAlert[];
  setPriceAlerts: Dispatch<SetStateAction<PriceAlert[]>>;
  notifications: AlertNotification[];
  setNotifications: Dispatch<SetStateAction<AlertNotification[]>>;
  pushPermission: PushPermissionState;
  setPushPermission: Dispatch<SetStateAction<PushPermissionState>>;
  riskSettings: RiskSettings;
  setRiskSettings: Dispatch<SetStateAction<RiskSettings>>;
  automationConfig: NotificationAutomationConfig;
  setAutomationConfig: Dispatch<SetStateAction<NotificationAutomationConfig>>;
  orbScanner: ORBAnalysis[];
  emitNotification: EmitNotification;
  setSelectedSymbol: Dispatch<SetStateAction<string>>;
  setStagedOrderPreset: Dispatch<SetStateAction<StagedOrderPreset | null>>;
  setActiveTab: Dispatch<SetStateAction<ActiveTab>>;
  setMobileTradePanel: Dispatch<SetStateAction<MobileTradePanel>>;
}

/** Alerts tab: price alerts, notification feed, push settings and ORB automation rules. */
export function AlertsTab({
  instruments,
  selectedInstrument,
  priceAlerts,
  setPriceAlerts,
  notifications,
  setNotifications,
  pushPermission,
  setPushPermission,
  riskSettings,
  setRiskSettings,
  automationConfig,
  setAutomationConfig,
  orbScanner,
  emitNotification,
  setSelectedSymbol,
  setStagedOrderPreset,
  setActiveTab,
  setMobileTradePanel,
}: AlertsTabProps) {
  return (
    <AlertsCenter
      instruments={instruments}
      priceAlerts={priceAlerts}
      notifications={notifications}
      pushPermission={pushPermission}
      riskSettings={riskSettings}
      automationConfig={automationConfig}
      orbScanner={orbScanner}
      onRequestPushPermission={async () => {
        const res = await requestNotificationPermission();
        setPushPermission(res);
      }}
      onSendTestPush={() =>
        emitNotification(
          'Kestrel Alert Test',
          `${selectedInstrument?.symbol || 'ES1!'} push alert channel is active.`,
          'SYSTEM',
          selectedInstrument?.symbol,
          'alert',
        )
      }
      onCreateAlert={({symbol, condition, targetPrice, note}) => {
        const newAlert: PriceAlert = {
          id: `alrt-${Date.now()}`,
          symbol,
          condition,
          targetPrice,
          active: true,
          createdAt: Date.now(),
          note,
        };
        setPriceAlerts((prev) => [newAlert, ...prev]);
      }}
      onDeleteAlert={(id) =>
        setPriceAlerts((prev) => prev.filter((a) => a.id !== id))
      }
      onMarkAllRead={() =>
        setNotifications((prev) => prev.map((n) => ({...n, read: true})))
      }
      onUpdateRiskSettings={setRiskSettings}
      onUpdateAutomationConfig={setAutomationConfig}
      onImportRulesPayload={(jsonText) => {
        try {
          const parsed = JSON.parse(jsonText) as {
            automationConfig?: Partial<NotificationAutomationConfig>;
            priceAlerts?: Partial<PriceAlert>[];
          };
          if (!parsed || typeof parsed !== 'object') {
            return {ok: false, message: 'Invalid JSON structure.'};
          }
          if (parsed.automationConfig) {
            setAutomationConfig((prev) => ({
              ...prev,
              ...parsed.automationConfig,
            }));
          }
          let importedAlerts = 0;
          if (Array.isArray(parsed.priceAlerts)) {
            const validAlerts: PriceAlert[] = parsed.priceAlerts
              .filter(
                (a) =>
                  typeof a.symbol === 'string' &&
                  (a.condition === 'ABOVE' || a.condition === 'BELOW') &&
                  typeof a.targetPrice === 'number' &&
                  a.targetPrice > 0,
              )
              .map((a, idx) => ({
                id: `alrt-imp-${Date.now()}-${idx}`,
                symbol: a.symbol!,
                condition: a.condition!,
                targetPrice: a.targetPrice!,
                active: true,
                createdAt: Date.now(),
                note: a.note || 'Imported automation rule',
              }));
            importedAlerts = validAlerts.length;
            if (validAlerts.length > 0) {
              setPriceAlerts((prev) => [...validAlerts, ...prev]);
            }
          }
          return {
            ok: true,
            message: `Imported automation rules${
              importedAlerts > 0 ? ` and ${importedAlerts} price alert(s)` : ''
            } successfully.`,
          };
        } catch {
          return {
            ok: false,
            message: 'Could not parse JSON. Verify syntax and try again.',
          };
        }
      }}
      onStageFromScanner={(preset) => {
        setSelectedSymbol(preset.symbol);
        setStagedOrderPreset(preset);
        setActiveTab('trade');
        setMobileTradePanel('ORDER');
      }}
    />
  );
}
