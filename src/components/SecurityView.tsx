import React, {useEffect, useState} from 'react';
import {CheckCircle2, Fingerprint, KeyRound, Lock, ShieldCheck} from 'lucide-react';
import {
  enrollBiometricCredential,
  hashPin,
  isPlatformBiometricAvailable,
  verifyBiometricCredential,
} from '../services/biometricAuth';
import type {RiskSettings, SecurityState} from '../types/trading';
import {AuditLogPanel} from './AuditLogPanel';

interface SecurityViewProps {
  securityState: SecurityState;
  riskSettings: RiskSettings;
  onUpdateSecurity: (next: SecurityState) => void;
  onUpdateRiskSettings: (next: RiskSettings) => void;
  onLockNow: () => void;
}

export const SecurityView: React.FC<SecurityViewProps> = ({
  securityState,
  riskSettings,
  onUpdateSecurity,
  onUpdateRiskSettings,
  onLockNow,
}) => {
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');

  useEffect(() => {
    isPlatformBiometricAvailable().then(setWebAuthnSupported);
  }, []);

  const handleEnrollBiometric = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    const res = await enrollBiometricCredential('Kestrel Desk Trader');
    if (res.success && res.credentialId) {
      onUpdateSecurity({
        ...securityState,
        biometricEnrolled: true,
        credentialId: res.credentialId,
        authMethod: 'WEBAUTHN',
      });
      setStatusMsg('Platform biometric passkey enrolled via WebAuthn.');
    } else {
      setErrorMsg(res.error || 'Unable to enroll biometric passkey.');
    }
  };

  const handleVerifyTest = async () => {
    setErrorMsg(null);
    setStatusMsg(null);
    if (!securityState.credentialId) return;
    const res = await verifyBiometricCredential(securityState.credentialId);
    if (res.success) {
      setStatusMsg('Biometric identity verified successfully.');
    } else {
      setErrorMsg(res.error || 'Biometric verification failed.');
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (!/^\d{6}$/.test(pinInput)) {
      setErrorMsg('Security PIN must be exactly 6 digits.');
      return;
    }
    if (pinInput !== confirmPinInput) {
      setErrorMsg('PIN entries do not match.');
      return;
    }
    const pinHash = await hashPin(pinInput);
    onUpdateSecurity({
      ...securityState,
      pinConfigured: true,
      pinHash,
    });
    setPinInput('');
    setConfirmPinInput('');
    setStatusMsg('6-digit cryptographic PIN saved locally.');
  };

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="font-display text-lg font-bold text-slate-900 dark:text-white">
          Biometric Authentication & Session Security
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Hardware-backed WebAuthn passkeys (Face ID, Touch ID, Windows Hello) and SHA-256 PIN protection
        </p>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* WebAuthn Biometric Card */}
        <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400">
                <Fingerprint className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Biometric Passkey (WebAuthn)
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {webAuthnSupported === null
                    ? 'Checking device capability...'
                    : webAuthnSupported
                    ? 'Platform authenticator available'
                    : 'Platform authenticator restricted in preview · Use PIN fallback'}
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-medium ${
                securityState.biometricEnrolled
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-400'
              }`}
            >
              {securityState.biometricEnrolled ? 'Enrolled' : 'Not enrolled'}
            </span>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Enroll your device&apos;s biometric sensor to lock your trading workstation and optionally gate instant order execution.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleEnrollBiometric}
              className="px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              {securityState.biometricEnrolled
                ? 'Re-enroll Biometric'
                : 'Enroll Biometric Passkey'}
            </button>
            {securityState.biometricEnrolled && (
              <button
                type="button"
                onClick={handleVerifyTest}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1B2232] transition-colors cursor-pointer"
              >
                Verify Prompt
              </button>
            )}
          </div>
        </div>

        {/* 6-Digit PIN Card */}
        <form
          onSubmit={handleSavePin}
          className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-5 space-y-3.5"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2.5 rounded-lg bg-slate-100 dark:bg-[#1A2232] text-slate-700 dark:text-slate-300">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  6-Digit Fallback PIN
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  SHA-256 salted hash stored locally on device
                </p>
              </div>
            </div>
            <span
              className={`text-xs font-medium ${
                securityState.pinConfigured
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-400'
              }`}
            >
              {securityState.pinConfigured ? 'Configured' : 'Not set'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                New 6-Digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                Confirm PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirmPinInput}
                onChange={(e) =>
                  setConfirmPinInput(e.target.value.replace(/\D/g, ''))
                }
                placeholder="••••••"
                className="w-full rounded-lg border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-[#263042] bg-slate-900 dark:bg-[#1E2636] text-white hover:bg-slate-800 dark:hover:bg-[#283247] transition-colors cursor-pointer"
          >
            {securityState.pinConfigured ? 'Update 6-Digit PIN' : 'Save 6-Digit PIN'}
          </button>
        </form>
      </div>

      {/* Execution & Session Lock Policy */}
      <div className="bg-white dark:bg-[#121721] border border-slate-200 dark:border-[#1E2636] rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Trade Execution & Session Controls
            </h3>
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={riskSettings.requireBiometricForOrders}
                onChange={(e) =>
                  onUpdateRiskSettings({
                    ...riskSettings,
                    requireBiometricForOrders: e.target.checked,
                  })
                }
                className="accent-blue-600"
              />
              <span>Require biometric / PIN confirmation before instant order execution</span>
            </label>
          </div>
        </div>

        <button
          type="button"
          onClick={onLockNow}
          disabled={!securityState.biometricEnrolled && !securityState.pinConfigured}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Lock Terminal Now</span>
        </button>
      </div>

      <AuditLogPanel />
    </div>
  );
};
