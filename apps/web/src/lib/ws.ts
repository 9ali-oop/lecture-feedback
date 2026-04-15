import type { WsClientMessage, WsServerMessage } from '@lecture-feedback/shared';

type MessageHandler = (msg: WsServerMessage) => void;

export class SessionSocket {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(
    private sessionId: string,
    private token: string,
  ) {}

  connect() {
    // Tear down any prior connection before opening a new one. Without this,
    // a reconnect (or a manual re-connect while the 3s reconnect timer is
    // also pending) leaves the previous ws's pingInterval running — each
    // reconnect doubles the ping rate — and the old WebSocket stays around
    // with its handlers pinned to `this`, only garbage-collected whenever
    // the browser notices. Belt-and-braces: cancel any pending reconnect
    // timer so we don't get two concurrent connect() calls.
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.pingInterval) { clearInterval(this.pingInterval); this.pingInterval = null; }
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      try { this.ws.close(); } catch { /* already closing */ }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    const url = `${protocol}://${host}/ws?token=${encodeURIComponent(this.token)}&sessionId=${encodeURIComponent(this.sessionId)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      // Defensive: also clear here in case a stale interval survived.
      if (this.pingInterval) clearInterval(this.pingInterval);
      this.pingInterval = setInterval(() => this.send({ type: 'PING' }), 30_000);
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsServerMessage;
        // Server-authoritative rejection — no point reconnecting. Without
        // this, a "Forbidden" response (e.g. student scanning a session they
        // can't access) would spin in a 3-second reconnect loop.
        if (msg.type === 'ERROR') {
          this.closed = true;
          if (this.pingInterval) clearInterval(this.pingInterval);
          if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        }
        this.handlers.forEach((h) => h(msg));
      } catch {
        // ignore malformed frames
      }
    };

    this.ws.onclose = () => {
      if (this.pingInterval) clearInterval(this.pingInterval);
      if (!this.closed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  disconnect() {
    this.closed = true;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
