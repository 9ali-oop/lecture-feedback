import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * Screen-reader live region for announcing dynamic state changes that a
 * sighted user can see but a blind user would otherwise miss.
 *
 * Usage:
 *   const { announce } = useLiveAnnouncer();
 *   announce('Slide 3 of 10');
 *
 * The message is pushed into a visually hidden `div` with `aria-live="polite"`
 * and `aria-atomic="true"`. We alternate between two buffers so identical
 * consecutive messages still re-trigger the screen reader (otherwise NVDA
 * and VoiceOver silently ignore a repeat).
 *
 * Keep messages short (5-10 words). Screen readers queue `polite` updates
 * so users aren't interrupted mid-sentence.
 */

interface LiveAnnouncerContext {
  announce: (message: string, priority?: 'polite' | 'assertive') => void;
}

const Ctx = createContext<LiveAnnouncerContext | null>(null);

export function LiveRegionProvider({ children }: { children: React.ReactNode }) {
  const [politeA, setPoliteA] = useState('');
  const [politeB, setPoliteB] = useState('');
  const [assertiveA, setAssertiveA] = useState('');
  const [assertiveB, setAssertiveB] = useState('');
  // Alternate between the two buffers so repeat announcements still fire.
  const flipRef = useRef(false);

  const announce = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const useA = flipRef.current;
    flipRef.current = !flipRef.current;
    if (priority === 'assertive') {
      if (useA) { setAssertiveA(trimmed); setAssertiveB(''); }
      else { setAssertiveB(trimmed); setAssertiveA(''); }
    } else {
      if (useA) { setPoliteA(trimmed); setPoliteB(''); }
      else { setPoliteB(trimmed); setPoliteA(''); }
    }
  }, []);

  // Visually hidden — not display:none (screen readers skip that) and not
  // visibility:hidden (same). The "clip" pattern below is the standard
  // technique used by WAI and the Tailwind sr-only utility.
  const srOnly: React.CSSProperties = {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  };

  return (
    <Ctx.Provider value={{ announce }}>
      {children}
      <div aria-live="polite" aria-atomic="true" style={srOnly}>{politeA}</div>
      <div aria-live="polite" aria-atomic="true" style={srOnly}>{politeB}</div>
      <div aria-live="assertive" aria-atomic="true" role="alert" style={srOnly}>{assertiveA}</div>
      <div aria-live="assertive" aria-atomic="true" role="alert" style={srOnly}>{assertiveB}</div>
    </Ctx.Provider>
  );
}

export function useLiveAnnouncer(): LiveAnnouncerContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback when used outside the provider (tests, isolated components) —
    // silently no-ops so callers don't have to guard.
    return { announce: () => {} };
  }
  return ctx;
}

/**
 * Small declarative helper: render to trigger an announcement when `message`
 * changes. Handy for components that want aria-live without threading the
 * hook through props.
 */
export function Announce({ message, priority = 'polite' }: { message: string; priority?: 'polite' | 'assertive' }) {
  const { announce } = useLiveAnnouncer();
  useEffect(() => {
    if (message) announce(message, priority);
  }, [message, priority, announce]);
  return null;
}
