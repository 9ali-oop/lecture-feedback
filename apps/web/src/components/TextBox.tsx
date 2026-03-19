import { useRef, useState, useEffect, useCallback } from 'react';

export interface TextBoxData {
  id: string;
  // Position & size as ratios (0–1) relative to canvas
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  fontFamily: string;
  fontSize: number; // px
  color: string;
}

interface TextBoxProps {
  data: TextBoxData;
  containerWidth: number;
  containerHeight: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (patch: Partial<TextBoxData>) => void;
  onDelete: () => void;
}

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLE_SIZE = 8;

const HANDLE_CURSORS: Record<HandleDir, string> = {
  nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
  e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
  sw: 'nesw-resize', w: 'ew-resize',
};

export default function TextBox({
  data, containerWidth, containerHeight, selected, onSelect, onUpdate, onDelete,
}: TextBoxProps) {
  const [editing, setEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const resizeRef = useRef<{
    handle: HandleDir;
    startX: number; startY: number;
    origX: number; origY: number; origW: number; origH: number;
  } | null>(null);

  // Convert ratios to pixels
  const px = data.x * containerWidth;
  const py = data.y * containerHeight;
  const pw = data.width * containerWidth;
  const ph = data.height * containerHeight;

  // ── Drag ────────────────────────────────────────────────────────
  const onDragStart = useCallback((e: React.MouseEvent) => {
    if (editing) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: data.x, origY: data.y };
  }, [data.x, data.y, editing, onSelect]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = (e.clientX - dragRef.current.startX) / containerWidth;
      const dy = (e.clientY - dragRef.current.startY) / containerHeight;
      onUpdate({
        x: Math.max(0, Math.min(1 - data.width, dragRef.current.origX + dx)),
        y: Math.max(0, Math.min(1 - data.height, dragRef.current.origY + dy)),
      });
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [containerWidth, containerHeight, data.width, data.height, onUpdate]);

  // ── Resize ──────────────────────────────────────────────────────
  const onResizeStart = useCallback((e: React.MouseEvent, handle: HandleDir) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect();
    resizeRef.current = {
      handle,
      startX: e.clientX, startY: e.clientY,
      origX: data.x, origY: data.y, origW: data.width, origH: data.height,
    };
  }, [data.x, data.y, data.width, data.height, onSelect]);

  useEffect(() => {
    const MIN_W = 40 / containerWidth;
    const MIN_H = 24 / containerHeight;

    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dx = (e.clientX - r.startX) / containerWidth;
      const dy = (e.clientY - r.startY) / containerHeight;
      let { origX: nx, origY: ny, origW: nw, origH: nh } = r;

      if (r.handle.includes('e')) nw = Math.max(MIN_W, r.origW + dx);
      if (r.handle.includes('w')) { nw = Math.max(MIN_W, r.origW - dx); nx = r.origX + r.origW - nw; }
      if (r.handle.includes('s')) nh = Math.max(MIN_H, r.origH + dy);
      if (r.handle.includes('n')) { nh = Math.max(MIN_H, r.origH - dy); ny = r.origY + r.origH - nh; }

      onUpdate({ x: Math.max(0, nx), y: Math.max(0, ny), width: nw, height: nh });
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [containerWidth, containerHeight, onUpdate]);

  // ── Double-click to edit ────────────────────────────────────────
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
    onSelect();
    setTimeout(() => textareaRef.current?.focus(), 0);
  }, [onSelect]);

  const handleBlur = useCallback(() => {
    setEditing(false);
  }, []);

  // ── Keyboard ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!editing) { e.preventDefault(); onDelete(); }
    }
    if (e.key === 'Escape') setEditing(false);
  }, [editing, onDelete]);

  // Handle positions relative to the box
  const handles: { dir: HandleDir; style: React.CSSProperties }[] = [
    { dir: 'nw', style: { top: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 } },
    { dir: 'n',  style: { top: -HANDLE_SIZE / 2, left: '50%', marginLeft: -HANDLE_SIZE / 2 } },
    { dir: 'ne', style: { top: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 } },
    { dir: 'e',  style: { top: '50%', right: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2 } },
    { dir: 'se', style: { bottom: -HANDLE_SIZE / 2, right: -HANDLE_SIZE / 2 } },
    { dir: 's',  style: { bottom: -HANDLE_SIZE / 2, left: '50%', marginLeft: -HANDLE_SIZE / 2 } },
    { dir: 'sw', style: { bottom: -HANDLE_SIZE / 2, left: -HANDLE_SIZE / 2 } },
    { dir: 'w',  style: { top: '50%', left: -HANDLE_SIZE / 2, marginTop: -HANDLE_SIZE / 2 } },
  ];

  return (
    <div
      className={`absolute ${selected ? 'ring-2 ring-blue-500' : 'hover:ring-1 hover:ring-blue-300'}`}
      style={{
        left: px, top: py, width: pw, height: ph,
        zIndex: selected ? 20 : 10,
      }}
      onMouseDown={onDragStart}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {editing ? (
        <textarea
          ref={textareaRef}
          className="h-full w-full resize-none border-none bg-transparent p-1 outline-none"
          style={{
            fontFamily: data.fontFamily,
            fontSize: data.fontSize,
            color: data.color,
            lineHeight: 1.3,
          }}
          value={data.content}
          onChange={(e) => onUpdate({ content: e.target.value })}
          onBlur={handleBlur}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div
          className="h-full w-full overflow-hidden whitespace-pre-wrap break-words p-1"
          style={{
            fontFamily: data.fontFamily,
            fontSize: data.fontSize,
            color: data.color,
            lineHeight: 1.3,
            userSelect: 'none',
          }}
        >
          {data.content || (
            <span className="text-gray-400 italic" style={{ fontSize: Math.min(data.fontSize, 14) }}>
              Double-click to type...
            </span>
          )}
        </div>
      )}

      {/* Resize handles */}
      {selected && handles.map(({ dir, style }) => (
        <div
          key={dir}
          className="absolute bg-white border-2 border-blue-500 rounded-sm"
          style={{
            width: HANDLE_SIZE, height: HANDLE_SIZE,
            cursor: HANDLE_CURSORS[dir],
            ...style,
          }}
          onMouseDown={(e) => onResizeStart(e, dir)}
        />
      ))}
    </div>
  );
}
