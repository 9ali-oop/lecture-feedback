import { useTheme } from '../contexts/ThemeContext.tsx';
import { useViewMode } from '../contexts/ViewModeContext.tsx';

interface AccessibilityTogglesProps {
  // Layout variant. "header" = compact 4x4 icons used inside page headers;
  // "corner" = 5x5 icons used on full-bleed pages (Login, Register, Session)
  // where the controls float at the top-right of the viewport.
  variant?: 'header' | 'corner';
  // Drop the device-view toggle (used by full-bleed session pages where it
  // doesn't make sense — the layout is already responsive to the actual
  // viewport and the simulated phone frame just gets in the way).
  hideViewToggle?: boolean;
}

export default function AccessibilityToggles({
  variant = 'header',
  hideViewToggle = false,
}: AccessibilityTogglesProps) {
  const { resolved, toggle, dyslexiaMode, toggleDyslexia } = useTheme();
  const { mode, toggle: toggleView } = useViewMode();

  const iconSize = variant === 'corner' ? 'h-5 w-5' : 'h-4 w-4';
  // Using gray-500 (not gray-400) for icon colour — gray-400 on white only
  // hits 2.5:1 contrast, which fails WCAG AA (needs 4.5:1 for normal text,
  // 3:1 for large/icon graphics). gray-500 (#6b7280) on white hits 4.83:1.
  const btn = variant === 'corner'
    ? 'rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300'
    : 'rounded-lg p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300';
  const dyslexiaActive = dyslexiaMode
    ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:ring-brand-700'
    : '';

  return (
    <>
      {!hideViewToggle && (
        <button
          onClick={toggleView}
          className={btn}
          title={`Switch to ${mode === 'desktop' ? 'phone' : 'desktop'} view`}
          aria-label={`Switch to ${mode === 'desktop' ? 'phone' : 'desktop'} view`}
        >
          {mode === 'desktop' ? (
            <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          ) : (
            <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          )}
        </button>
      )}

      <button
        onClick={toggleDyslexia}
        className={`${btn} ${dyslexiaActive}`}
        title={`${dyslexiaMode ? 'Disable' : 'Enable'} dyslexia-friendly reading mode`}
        aria-label={`${dyslexiaMode ? 'Disable' : 'Enable'} dyslexia-friendly reading mode`}
        aria-pressed={dyslexiaMode}
      >
        <span className={`${iconSize} inline-flex items-center justify-center text-[13px] font-bold leading-none`}>
          Aa
        </span>
      </button>

      <button
        onClick={toggle}
        className={btn}
        title={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
        aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} mode`}
      >
        {resolved === 'dark' ? (
          <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ) : (
          <svg className={iconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        )}
      </button>
    </>
  );
}
