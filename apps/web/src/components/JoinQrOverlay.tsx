import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

interface JoinQrOverlayProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'lf.joinBaseUrl';

/**
 * Full-screen overlay showing a big QR code that students scan to join the session
 * anonymously.
 *
 * Base URL handling: the lecturer typically opens the app via http://localhost:5173
 * on their own laptop, but participant phones can't reach localhost. So we let the
 * lecturer paste the URL their participants should use (e.g. their phone-hotspot IP
 * or a Cloudflare tunnel URL), and persist it in localStorage so it sticks between
 * sessions.
 */
export default function JoinQrOverlay({ sessionId, open, onClose }: JoinQrOverlayProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const originIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);

  // Default base URL: if the page origin is something publicly reachable (a real IP
  // or tunnel URL), use it. If it's localhost, fall back to whatever the lecturer
  // last used, or empty.
  const [baseUrl, setBaseUrl] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const saved = localStorage.getItem(STORAGE_KEY) ?? '';
    return originIsLocal ? saved : origin;
  });

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const joinUrl = cleanBase ? `${cleanBase}/join/${sessionId}` : '';
  const needsBaseUrl = !cleanBase || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(cleanBase);

  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // Regenerate the QR whenever the URL changes
  useEffect(() => {
    if (!open || !joinUrl || needsBaseUrl) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 720,
      color: { dark: '#0f172a', light: '#ffffff' },
    }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [open, joinUrl, needsBaseUrl]);

  // Persist the base URL (only when it's not the fallback localhost)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (cleanBase && !/^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(cleanBase)) {
      localStorage.setItem(STORAGE_KEY, cleanBase);
    }
  }, [cleanBase]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const portHint = useMemo(() => {
    try {
      const u = new URL(origin);
      return u.port || '5173';
    } catch {
      return '5173';
    }
  }, [origin]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-white dark:bg-gray-950"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col items-center px-6 py-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-2 top-2 rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
          title="Close (Esc)"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 className="mb-2 text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Scan to join
        </h2>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
          Open your phone camera, point it at the code
        </p>

        {needsBaseUrl ? (
          <div className="w-full max-w-lg rounded-2xl bg-amber-50 dark:bg-amber-900/20 p-6 ring-1 ring-amber-200 dark:ring-amber-800">
            <p className="mb-3 text-sm font-semibold text-amber-900 dark:text-amber-300">
              Set your participant URL first
            </p>
            <p className="mb-4 text-xs text-amber-800 dark:text-amber-400">
              Your page is running on <code className="font-mono">localhost</code>, which phones can't reach.
              Paste the URL participants should use — e.g. your laptop's hotspot IP like
              {' '}<code className="font-mono">http://192.168.43.1:{portHint}</code> or a Cloudflare tunnel URL.
            </p>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={`http://192.168.x.x:${portHint}`}
              className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-mono text-gray-900 dark:text-gray-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-900/50"
              autoFocus
            />
            <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-500">
              Run <code className="font-mono">ipconfig</code> in a terminal and use the IPv4 address of your
              Wi-Fi adapter. We'll remember it for next time.
            </p>
          </div>
        ) : (
          <>
            <div className="rounded-3xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:ring-gray-700">
              {dataUrl ? (
                <img src={dataUrl} alt="QR code to join session" className="h-[55vh] max-h-[720px] w-auto" />
              ) : (
                <div className="flex h-[55vh] w-[55vh] items-center justify-center">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-300 border-t-brand-600" />
                </div>
              )}
            </div>

            <div className="mt-6 text-center">
              <p className="text-xs uppercase tracking-widest text-gray-400 dark:text-gray-500">
                Or go to
              </p>
              <p className="mt-1 break-all font-mono text-sm text-gray-700 dark:text-gray-300">
                {joinUrl}
              </p>
              <button
                onClick={() => {
                  const next = prompt('New participant base URL (e.g. http://192.168.43.1:5173)', cleanBase);
                  if (next !== null) setBaseUrl(next);
                }}
                className="mt-2 text-[11px] text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-300"
              >
                change URL
              </button>
            </div>
          </>
        )}

        <p className="mt-6 text-xs text-gray-400 dark:text-gray-500">
          Press <kbd className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono ring-1 ring-gray-200 dark:ring-gray-700">Esc</kbd> or click anywhere to close
        </p>
      </div>
    </div>
  );
}
