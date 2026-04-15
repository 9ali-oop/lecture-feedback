import { createContext, useContext, useState, useEffect } from 'react';

type ViewMode = 'desktop' | 'phone';

interface ViewModeContextType {
  mode: ViewMode;
  toggle: () => void;
  isPhone: boolean;
}

const ViewModeContext = createContext<ViewModeContextType>({
  mode: 'desktop',
  toggle: () => {},
  isPhone: false,
});

export function ViewModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('viewMode') as ViewMode) || 'desktop';
  });

  useEffect(() => {
    localStorage.setItem('viewMode', mode);
  }, [mode]);

  const toggle = () => setMode((m) => (m === 'desktop' ? 'phone' : 'desktop'));

  return (
    <ViewModeContext.Provider value={{ mode, toggle, isPhone: mode === 'phone' }}>
      {mode === 'phone' ? (
        <div className="flex min-h-screen items-start justify-center bg-gray-200 dark:bg-gray-950 py-4">
          <div className="relative w-[390px] min-h-screen overflow-hidden rounded-3xl shadow-2xl ring-1 ring-gray-300 dark:ring-gray-700 bg-white dark:bg-gray-900">
            {children}
          </div>
        </div>
      ) : (
        children
      )}
    </ViewModeContext.Provider>
  );
}

export const useViewMode = () => useContext(ViewModeContext);
