import React, {useState} from 'react';
import {Fingerprint, KeyRound, Lock} from 'lucide-react';
import {verifyBiometricCredential, verifyPin} from '../services/biometricAuth';
import type {SecurityState} from '../types/trading';

interface SecurityLockModalProps {
  securityState: SecurityState;
  title?: string;
  subtitle?: string;
  onUnlock: () => void;
  onCancel?: () => void;
  canCancel?: boolean;
}

export const SecurityLockModal: React.FC<SecurityLockModalProps> = ({
  securityState,
  title = 'Kestrel Terminal Locked',
  subtitle = 'Verify your identity to access live trading and portfolio execution.',
  onUnlock,
  onCancel,
  canCancel = false,
}) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleBiometric = async () => {
    if (!securityState.credentialId) return;
    setBusy(true);
    setError(null);
    const res = await verifyBiometricCredential(securityState.credentialId);
    setBusy(false);
    if (res.success) {
      onUnlock();
    } else {
      setError(res.error || 'Biometric verification failed. Use PIN fallback.');
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!securityState.pinHash) return;
    setError(null);
    const ok = await verifyPin(pin, securityState.pinHash);
    if (ok) {
      setPin('');
      onUnlock();
    } else {
      setError('Incorrect 6-digit PIN.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B0E14]/90 backdrop-blur-md p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-[#242E42] bg-white dark:bg-[#121721] p-6 shadow-2xl space-y-5">
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-blue-600/15 text-blue-500 flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
            {title}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-300 text-center">
            {error}
          </div>
        )}

        {securityState.biometricEnrolled && securityState.credentialId && (
          <button
            type="button"
            disabled={busy}
            onClick={handleBiometric}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer min-h-[44px]"
          >
            <Fingerprint className="w-4 h-4" />
            <span>{busy ? 'Waiting for Biometric...' : 'Verify with Biometrics'}</span>
          </button>
        )}

        {securityState.pinConfigured && securityState.pinHash && (
          <form onSubmit={handlePinSubmit} className="space-y-2.5">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <KeyRound className="w-3.5 h-3.5" />
              <span>Enter 6-Digit PIN</span>
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              autoFocus={!securityState.biometricEnrolled}
              className="w-full rounded-xl border border-slate-200 dark:border-[#242E42] bg-slate-50 dark:bg-[#0D1119] px-4 py-2.5 text-center text-base font-mono tracking-[0.4em] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="w-full rounded-xl border border-slate-200 dark:border-[#263042] bg-slate-900 dark:bg-[#1B2232] py-2.5 text-xs font-semibold text-white hover:bg-slate-800 dark:hover:bg-[#232C40] transition-colors cursor-pointer min-h-[44px]"
            >
              Unlock with PIN
            </button>
          </form>
        )}

        {!securityState.biometricEnrolled && !securityState.pinConfigured && (
          <button
            type="button"
            onClick={onUnlock}
            className="w-full rounded-xl bg-blue-600 py-2.5 text-xs font-semibold text-white cursor-pointer"
          >
            Continue
          </button>
        )}

        {canCancel && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full py-2 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};
