// ── Annotation data types ────────────────────────────────────────────────────

export interface Point {
  x: number; // normalized 0-1
  y: number; // normalized 0-1
}

export type AnnotationType = 'draw' | 'erase';

export interface Annotation {
  type: AnnotationType;
  points: Point[];
  color?: string;       // draw only
  width?: number;       // draw only (normalized 0-1 relative to canvas width)
  size?: number;        // erase only (normalized 0-1 relative to canvas width)
  timestamp: number;    // ms since session start, for ordering
}

export type DrawToolType = 'pointer' | 'pen' | 'laser' | 'eraser' | 'text';

// ── Annotation WS messages (lecturer → server → students) ───────────────────

export interface DrawStrokeMessage {
  type: 'DRAW_STROKE';
  points: Point[];
  color: string;
  width: number;       // normalized
  slideIndex: number;
  // Set by the server (pass-through from the lecturer's current mode) when
  // the lecturer is drawing on the shared whiteboard rather than on a slide.
  // Students who opted to stay on the slide view filter these out locally.
  whiteboard?: boolean;
}

export interface EraseStrokeMessage {
  type: 'ERASE_STROKE';
  points: Point[];
  size: number;        // normalized
  slideIndex: number;
  whiteboard?: boolean;
}

export interface ClearAnnotationsMessage {
  type: 'CLEAR_ANNOTATIONS';
  slideIndex: number;
}

export interface LaserMoveMessage {
  type: 'LASER_MOVE';
  x: number;           // normalized 0-1
  y: number;           // normalized 0-1
  slideIndex: number;
}

export interface LaserPauseMessage {
  type: 'LASER_PAUSE';
  x: number;
  y: number;
  slideIndex: number;
}

export interface LaserEndMessage {
  type: 'LASER_END';
}

export interface CursorPositionMessage {
  type: 'CURSOR_POSITION';
  x: number;
  y: number;
  tool: DrawToolType;
  slideIndex: number;
}

export interface CursorHideMessage {
  type: 'CURSOR_HIDE';
}

// ── Server → students only ──────────────────────────────────────────────────

export interface AnnotationSyncMessage {
  type: 'ANNOTATION_SYNC';
  slideIndex: number;
  annotations: Annotation[];
}
