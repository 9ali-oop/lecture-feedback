import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

interface JoinQrOverlayProps {
  sessionId: string;
  open: boolean;
  onClose: () => void;
}

type Mode = 'lan' | 'tunnel' | 'custom';
const URL_KEY = 'lf.joinBaseUrl';
const MODE_KEY = 'lf.joinMode';

/**
 * Full-screen overlay with a QR code for students to scan and join the session.
 *
 * In dev the lecturer opens the app via http://localhost:5173, which phones can't
 * reach. The API exposes /api/dev/join-urls returning two candidate base URLs:
 *   - LAN: the laptop's own 192.168/10.* address — works when the phone is on the
 *     same Wi-Fi. Most reliable, no third-party DNS involved.
 *   - Tunnel: the current Cloudflare quick-tunnel URL (written by
 *     scripts/dev-tunnel.mjs when `pnpm tunnel` is running). Needed when the phone
 *     is on mobile data or a different network, but UK mobile carriers and many
 *     home ISPs filter trycloudflare.com so this can silently NXDOMAIN on the phone.
 *
 * The overlay shows both as tabs so the lecturer picks whichever reaches the phone.
 * A custom URL override is kept as an escape hatch.
 */
export default function JoinQrOverlay({ sessionId, open, onClose }: JoinQrOverlayProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const originIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);

  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [customUrl, setCustomUrl] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(URL_KEY) ?? '';
  });
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return 'lan';
    return (localStorage.getItem(MODE_KEY) as Mode | null) ?? 'lan';
  });

  // When origin isn't localhost (e.g. lecturer opens the tunnel URL directly),
  // the current page origin is the right base — skip all the discovery.
  const resolvedBase = useMemo(() => {
    if (!originIsLocal) return origin;
    if (mode === 'tunnel' && tunnelUrl) return tunnelUrl;
    if (mode === 'lan' && lanUrls.length > 0) return lanUrls[0];
    if (mode === 'custom' && customUrl) return customUrl.replace(/\/+$/, '');
    // Auto-fallback: prefer LAN, then tunnel, then saved custom
    if (lanUrls.length > 0) return lanUrls[0];
    if (tunnelUrl) return tunnelUrl;
    return customUrl.replace(/\/+$/, '');
  }, [originIsLocal, origin, mode, tunnelUrl, lanUrls, customUrl]);

  const joinUrl = resolvedBase ? `${resolvedBase}/join/${sessionId}` : '';
  const needsBaseUrl = !resolvedBase || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(resolvedBase);

  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // Fetch live LAN + tunnel URLs whenever the overlay opens on localhost.
  useEffect(() => {
    if (!open || !originIsLocal) return;
    let cancelled = false;
    const port = window.location.port || '5173';
    fetch(`/api/dev/join-urls?port=${port}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { tunnel: string | null; lan: string[] } | null) => {
        if (cancelled || !body) return;
        setTunnelUrl(body.tunnel);
        setLanUrls(body.lan ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, originIsLocal]);

  // Regenerate the QR whenever the target URL changes
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

  // Persist mode and custom URL
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(MODE_KEY, mode);
  }, [mode]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (customUrl) localStorage.setItem(URL_KEY, customUrl);
  }, [customUrl]);

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

  const showTabs = originIsLocal && (lanUrls.length > 0 || tunnelUrl);

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
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Open your phone camera, point it at the code
        </p>

        {showTabs && (
          <div className="mb-5 flex gap-1 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
            <TabButton
              active={mode === 'lan'}
              disabled={lanUrls.length === 0}
              onClick={() => setMode('lan')}
              title="Works when the phone is on the same Wi-Fi as the laptop"
            >
              Same Wi-Fi
            </TabButton>
            <TabButton
              active={mode === 'tunnel'}
              disabled={!tunnelUrl}
              onClick={() => setMode('tunnel')}
              title="Works over mobile data or any network. May be blocked by some carriers."
            >
              Any network
            </TabButton>
            <TabButton
              active={mode === 'custom'}
              disabled={false}
              onClick={() => setMode('custom')}
              title="Paste your own URL (e.g. ngrok, laptop hotspot IP)"
            >
              Custom
            </TabButton>
          </div>
        )}

        {needsBaseUrl ? (
          <div className="w-full max-w-lg rounded-2xl bg-amber-50 dark:bg-amber-900/20 p-6 ring-1 ring-amber-200 dark:ring-amber-800">
            <p className="mb-3 text-sm font-semibold text-amber-900 dark:text-amber-300">
              Set your participant URL
            </p>
            <p className="mb-4 text-xs text-amber-800 dark:text-amber-400">
              No LAN or tunnel URL was discovered. Paste the URL participants should use —
              e.g. <code className="font-mono">http://192.168.1.42:{portHint}</code> or a tunnel URL.
            </p>
            <input
              type="text"
              value={customUrl}
              onChange={(e) => {
                setCustomUrl(e.target.value);
                setMode('custom');
              }}
              placeholder={`http://192.168.x.x:${portHint}`}
              className="w-full rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-mono text-gray-900 dark:text-gray-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200 dark:focus:ring-amber-900/50"
              autoFocus
            />
            <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-500">
              Tip: run <code className="font-mono">pnpm tunnel</code> in another terminal, or run
              {' '}<code className="font-mono">ipconfig</code> and use your Wi-Fi IPv4.
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

            {mode === 'custom' && originIsLocal && (
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder={`http://192.168.x.x:${portHint}`}
                className="mt-4 w-full max-w-lg rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2.5 text-sm font-mono text-gray-900 dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200 dark:focus:ring-brand-900/50"
              />
            )}

            <div className="mt-6 text-center">
              <p className="text-xs uppercase tracking-widest text-gray-400 dark:text-gray-500">
                Or go to
              </p>
              <p className="mt-1 break-all font-mono text-sm text-gray-700 dark:text-gray-300">
                {joinUrl}
              </p>
              {mode === 'lan' && lanUrls.length > 1 && (
                <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                  Other LAN addresses:{' '}
                  {lanUrls.slice(1).map((u, i) => (
                    <button
                      key={u}
                      onClick={() => {
                        setLanUrls([u, ...lanUrls.filter((x) => x !== u)]);
                      }}
                      className="font-mono underline hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {u}{i < lanUrls.length - 2 ? ', ' : ''}
                    </button>
                  ))}
                </p>
              )}
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

function TabButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        'rounded-lg px-4 py-2 text-xs font-semibold transition ' +
        (active
          ? 'bg-white text-gray-900 shadow dark:bg-gray-950 dark:text-gray-100'
          : disabled
            ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200')
      }
    >
      {children}
    </button>
  );
}
