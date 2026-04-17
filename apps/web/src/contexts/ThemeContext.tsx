import { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
  toggle: () => void;
  // Dyslexia-friendly reading mode — swaps the body font to Atkinson
  // Hyperlegible and loosens line-height, letter-spacing, and alignment.
  // Not a cure; roughly follows the British Dyslexia Association style guide.
  dyslexiaMode: boolean;
  setDyslexiaMode: (v: boolean) => void;
  toggleDyslexia: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemPreference(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem('theme') as Theme) || 'system';
  });
  const [dyslexiaMode, setDyslexiaModeState] = useState<boolean>(() => {
    return localStorage.getItem('dyslexiaMode') === '1';
  });

  const resolved = theme === 'system' ? getSystemPreference() : theme;

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem('theme', t);
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved, setTheme]);

  const setDyslexiaMode = useCallback((v: boolean) => {
    localStorage.setItem('dyslexiaMode', v ? '1' : '0');
    setDyslexiaModeState(v);
  }, []);

  const toggleDyslexia = useCallback(() => {
    setDyslexiaMode(!dyslexiaMode);
  }, [dyslexiaMode, setDyslexiaMode]);

  // Apply the class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [resolved]);

  useEffect(() => {
    const root = document.documentElement;
    if (dyslexiaMode) {
      root.classList.add('dyslexia');
    } else {
      root.classList.remove('dyslexia');
    }
  }, [dyslexiaMode]);

  // Listen for system preference changes when in 'system' mode
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setThemeState('system'); // force re-render
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme, toggle, dyslexiaMode, setDyslexiaMode, toggleDyslexia }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
