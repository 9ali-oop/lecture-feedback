import { useEffect, useState } from 'react';

interface RequestPenModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}

/**
 * Full-screen modal for requesting annotation access. Replaces the inline
 * top-bar form that used to overflow on mobile.
 */
export default function RequestPenModal({ open, onClose, onSubmit }: RequestPenModalProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => { if (!open) setReason(''); }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-gray-900 p-5 sm:p-6 shadow-2xl ring-1 ring-gray-200 dark:ring-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Request the pen
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 min-h-[40px] min-w-[40px]"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          Tell the lecturer why you need to draw on the slide.
        </p>

        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. I'd like to circle the part I don't understand"
          maxLength={100}
          rows={3}
          autoFocus
          className="w-full resize-none rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800 px-4 py-3 text-base text-gray-900 dark:text-gray-100 outline-none transition placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:border-blue-500 focus:bg-white dark:focus:bg-gray-800 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40"
        />

        <div className="mt-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-gray-200 dark:border-gray-700 py-3 text-sm font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 min-h-[48px]"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (reason.trim()) {
                onSubmit(reason.trim());
                setReason('');
              }
            }}
            disabled={!reason.trim()}
            className="flex-1 rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40 min-h-[48px]"
          >
            Send request
          </button>
        </div>
      </div>
    </div>
  );
}
