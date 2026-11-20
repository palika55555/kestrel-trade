import React, {type Dispatch, type SetStateAction} from 'react';
import {X} from 'lucide-react';
import type {AlertNotification} from '../../types/trading';

interface ToastStackProps {
  toastQueue: AlertNotification[];
  setToastQueue: Dispatch<SetStateAction<AlertNotification[]>>;
}

/** Actionable toast notification stack (top-right). Renders nothing when empty. */
export function ToastStack({toastQueue, setToastQueue}: ToastStackProps) {
  if (toastQueue.length === 0) return null;
  return (
    <div className="fixed top-16 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] space-y-2 pointer-events-none">
      {toastQueue.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-xl border border-slate-200 dark:border-[#283348] bg-white/95 dark:bg-[#141A26]/95 backdrop-blur-md p-3 shadow-xl flex items-start justify-between gap-2 text-xs"
        >
          <div className="min-w-0">
            <div className="font-semibold text-slate-900 dark:text-white">
              {t.title}
            </div>
            <div className="text-slate-600 dark:text-slate-300 mt-0.5">
              {t.body}
            </div>
          </div>
          <button
            type="button"
            onClick={() =>
              setToastQueue((prev) => prev.filter((item) => item.id !== t.id))
            }
            className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
