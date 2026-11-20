import {useEffect, useState} from 'react';

export function useTheme() {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    const saved = localStorage.getItem('kestrel_theme');
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('kestrel_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  return {isDark, setIsDark};
}
