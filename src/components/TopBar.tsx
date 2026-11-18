import React from 'react';
import {
  BarChart3,
  Bell,
  Bot,
  Briefcase,
  CandlestickChart,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import type {ActiveTab} from '../types/trading';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  unreadAlerts: number;
  isLocked: boolean;
  onLockSession: () => void;
  biometricConfigured: boolean;
}

const NAV_ITEMS: {id: ActiveTab; label: string}[] = [
  {id: 'trade', label: 'Trade'},
  {id: 'bot', label: 'Bot Stats'},
  {id: 'portfolio', label: 'Portfolio'},
  {id: 'alerts', label: 'Alerts'},
  {id: 'reports', label: 'Reports'},
  {id: 'security', label: 'Security'},
];

export const TopBar: React.FC<TopBarProps> = ({
  activeTab,
  onSelectTab,
  unreadAlerts,
  isLocked,
  onLockSession,
  biometricConfigured,
}) => {
  return (
    <>
      {/* Desktop & Mobile Top Navigation Header — Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-13 lg:h-14 border-b border-slate-200 dark:border-[#1E2636] bg-white/95 dark:bg-[#0B0E14]/95 backdrop-blur-md">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-8 px-4 lg:px-6">
          {/* Zone 1: Brand Wordmark (single line, no descriptor/badges) */}
          <button
            type="button"
            onClick={() => onSelectTab('trade')}
            className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Kestrel
          </button>

          {/* Zone 2: 5 concise single-line nav links (desktop) */}
          <nav className="hidden lg:flex items-center gap-7" aria-label="Primary navigation">
            {NAV_ITEMS.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'text-slate-900 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <span>
                    {item.label}
                    {item.id === 'alerts' && unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}
                  </span>
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 dark:bg-blue-500" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={onLockSession}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] px-3.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-[#1B2232] transition-colors whitespace-nowrap shrink-0 min-h-[36px] cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-blue-500" />
              <span>
                {isLocked
                  ? 'Unlock'
                  : biometricConfigured
                  ? 'Lock Session'
                  : 'Security Lock'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Fixed Bottom Tab Bar (Thumb-Zone Ergonomics, <= 60px) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-[#1E2636] bg-white/95 dark:bg-[#0B0E14]/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-6 h-15">
          <MobileTab
            active={activeTab === 'trade'}
            onClick={() => onSelectTab('trade')}
            icon={<CandlestickChart className="w-5 h-5" />}
            label="Trade"
          />
          <MobileTab
            active={activeTab === 'bot'}
            onClick={() => onSelectTab('bot')}
            icon={<Bot className="w-5 h-5" />}
            label="Bot"
          />
          <MobileTab
            active={activeTab === 'portfolio'}
            onClick={() => onSelectTab('portfolio')}
            icon={<Briefcase className="w-5 h-5" />}
            label="Portfolio"
          />
          <MobileTab
            active={activeTab === 'alerts'}
            onClick={() => onSelectTab('alerts')}
            icon={<Bell className="w-5 h-5" />}
            label={unreadAlerts > 0 ? `Alerts (${unreadAlerts})` : 'Alerts'}
          />
          <MobileTab
            active={activeTab === 'reports'}
            onClick={() => onSelectTab('reports')}
            icon={<BarChart3 className="w-5 h-5" />}
            label="Reports"
          />
          <MobileTab
            active={activeTab === 'security'}
            onClick={() => onSelectTab('security')}
            icon={<ShieldCheck className="w-5 h-5" />}
            label="Security"
          />
        </div>
      </nav>
    </>
  );
};

const MobileTab: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({active, onClick, icon, label}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex flex-col items-center justify-center min-h-[44px] transition-colors cursor-pointer ${
      active
        ? 'text-blue-600 dark:text-blue-400'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
    }`}
  >
    {icon}
    <span className="mt-0.5 text-[10px] font-medium tracking-tight truncate max-w-[68px]">
      {label}
    </span>
  </button>
);
