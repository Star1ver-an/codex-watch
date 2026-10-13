import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type {
  ServerToWatchMsg,
  HelloMsg,
  ApprovalResultMsg,
  ApprovalRequestCreateMsg,
  WatchToServerMsg,
  ThreadState,
} from '../types.js';
import { StateStore } from '../core/state-store.js';

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const DEBOUNCE_MS = 200;

interface ClientConn {
  ws: WebSocket;
  role: 'watch' | 'mcp';
  authed: boolean;
  alive: boolean;
  debounceTimers: Map<string, NodeJS.Timeout>;
}

export class WsServer {
  private wss: WebSocketServer | undefined;
  private clients = new Set<ClientConn>();
  private heartbeat: NodeJS.Timeout | undefined;
  private token: string;
  private pin: string;
  private fingerprint: string;
  private store: StateStore;
  private onThreadHandler: (threadId: string) => void;
  private onApprovalHandler: (threadId: string, approval: unknown) => void;

  constructor(store: StateStore, token: string, pin: string, fingerprint: string) {
    this.store = store;
    this.token = token;
    this.pin = pin;
    this.fingerprint = fingerprint;
    this.onThreadHandler = (threadId) => this.queueThreadUpdate(threadId);
    this.onApprovalHandler = (threadId, approval) =>
      this.sendToRole('watch', {
        type: 'approval_request',
        threadId,
        threadTitle: this.threadTitle(threadId),
        approval: approval as any,
      });
  }

  start(opts: { port?: number; server?: import('node:http').Server; label?: string }): Promise<void> {
    const label = opts.label ?? 'ws';
    return new Promise((resolve, reject) => {
      const wssOpts: any = opts.server ? { server: opts.server } : { port: opts.port };
      this.wss = new WebSocketServer(wssOpts);
      this.wss.on('error', (err) => reject(err));
      this.wss.on('connection', (ws, req) => this.onConnection(ws, req));

      this.store.on('thread', this.onThreadHandler);
      this.store.on('approval', this.onApprovalHandler);

      this.heartbeat = setInterval(() => {
        for (const c of this.clients) {
          if (!c.alive) {
            c.ws.terminate();
            continue;
          }
          c.alive = false;
          c.ws.ping();
        }
      }, HEARTBEAT_MS);

      if (opts.port) {
        this.wss.once('listening', () => {
          console.log(`[ws-server] ${label} listening`);
          resolve();
        });
      } else {
        console.log(`[ws-server] ${label} attached to http server`);
        resolve();
      }
    });
  }

  stop(): void {
    this.store.off('thread', this.onThreadHandler);
    this.store.off('approval', this.onApprovalHandler);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.clients) c.ws.terminate();
    this.wss?.close();
  }

  // ---- connection lifecycle ----

  private onConnection(ws: WebSocket, _req: IncomingMessage) {
    const conn: ClientConn = { ws, role: 'watch', authed: false, alive: true, debounceTimers: new Map() };
    this.clients.add(conn);

    const authTimer = setTimeout(() => {
      if (!conn.authed) {
        send(conn, { type: 'error', code: 'auth_timeout', message: 'hello with valid token required' });
        ws.close(4001, 'auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    ws.on('pong', () => { conn.alive = true; });
    ws.on('message', (data) => {
      let msg: WatchToServerMsg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (msg.type === 'hello') {
        const hello = msg as HelloMsg;
        const pin = (hello as unknown as { pin?: string }).pin;
        if (typeof pin === 'string' && pin.length > 0) {
          if (pin === this.pin) {
            send(conn, { type: 'pair_ok', token: this.token, fingerprint: this.fingerprint });
            console.log('[ws-server] PIN pairing succeeded');
            ws.close(1000, 'paired');
          } else {
            send(conn, { type: 'error', code: 'bad_pin', message: 'invalid pairing pin' });
            ws.close(4004, 'invalid pin');
          }
          return;
        }
        if (!this.checkToken(hello.token)) {
          send(conn, { type: 'error', code: 'bad_token', message: 'invalid token' });
          ws.close(4003, 'invalid token');
          return;
        }
        conn.authed = true;
        conn.role = hello.device === 'mcp' ? 'mcp' : 'watch';
        clearTimeout(authTimer);
        send(conn, { type: 'welcome', server: 'codex-watch-bridge', protocol: 1 });
        send(conn, { type: 'snapshot', threads: this.store.snapshot().map(compactThread), serverTimeMs: Date.now() });
        console.log(`[ws-server] client authed (device=${hello.device ?? 'unknown'}, total=${this.clients.size})`);
        return;
      }
      if (!conn.authed) return;
      if (msg.type === 'approval_result') {
        this.handleApprovalResult(msg as ApprovalResultMsg);
        return;
      }
      if (msg.type === 'approval_request_create') {
        this.handleApprovalCreate(conn, msg as unknown as ApprovalRequestCreateMsg);
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      for (const t of conn.debounceTimers.values()) clearTimeout(t);
      this.clients.delete(conn);
      console.log(`[ws-server] client disconnected (total=${this.clients.size})`);
    });
    ws.on('error', () => { /* handled by close */ });
  }

  private handleApprovalCreate(conn: ClientConn, msg: ApprovalRequestCreateMsg) {
    if (conn.role !== 'mcp') {
      send(conn, { type: 'error', code: 'forbidden', message: 'approval_request_create requires mcp device' });
      return;
    }
    const { approval, threadId } = this.store.createApproval({
      title: String(msg.title ?? '审批请求'),
      detail: String(msg.detail ?? ''),
      risk: msg.risk ?? 'unknown',
      timeoutMin: msg.timeoutMin,
    });
    send(conn, { type: 'approval_request_created', reqId: msg.reqId, approvalId: approval.id, threadId });
    console.log(`[ws-server] MCP approval created: ${approval.id} (${msg.title})`);
    this.store.onceApprovalResult(approval.id, (decision, note) => {
      this.sendToRole('mcp', {
        type: 'approval_request_result',
        reqId: msg.reqId,
        approvalId: approval.id,
        decision,
        note,
      });
    });
  }

  private handleApprovalResult(msg: ApprovalResultMsg) {
    const hit = this.store.resolveApprovalFromWatch(msg.approvalId, msg.decision, msg.note);
    if (hit) {
      console.log(`[ws-server] approval ${msg.decision.toUpperCase()} for "${msg.approvalId}" (thread "${hit.title}")${msg.note ? ` note: ${msg.note}` : ''}`);
    } else {
      console.log(`[ws-server] approval result for unknown id: ${msg.approvalId}`);
    }
  }

  private checkToken(token: string): boolean {
    const a = Buffer.from(String(token));
    const b = Buffer.from(this.token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  private threadTitle(threadId: string): string {
    const t = this.store.snapshot(500).find((x) => x.id === threadId);
    return t?.title ?? threadId;
  }

  private queueThreadUpdate(threadId: string) {
    for (const c of this.clients) {
      if (!c.authed) continue;
      if (c.debounceTimers.has(threadId)) continue;
      const timer = setTimeout(() => {
        c.debounceTimers.delete(threadId);
        const t = this.store.snapshot(500).find((x) => x.id === threadId);
        if (t) send(c, { type: 'thread_update', thread: compactThread(t) });
      }, DEBOUNCE_MS);
      if (typeof timer.unref === 'function') timer.unref();
      c.debounceTimers.set(threadId, timer);
    }
  }

  private sendToRole(role: 'mcp' | 'watch', msg: ServerToWatchMsg) {
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (c.authed && c.role === role && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(data);
      }
    }
  }
}

// The watch never renders preview text. Omitting it keeps reconnect snapshots
// small and avoids parsing long Codex previews on the watch main thread.
function compactThread(thread: ThreadState): ThreadState {
  const { preview: _preview, ...compact } = thread;
  return compact;
}

function send(conn: ClientConn, msg: ServerToWatchMsg) {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(msg));
  }
}
