import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type {
  ServerToWatchMsg,
  HelloMsg,
  ApprovalResultMsg,
  ApprovalRequestCreateMsg,
  TaskControlMsg,
  ThreadMessageMsg,
  WatchInstructionCompleteMsg,
  WatchInstructionGetMsg,
  WatchToServerMsg,
  ThreadState,
} from '../types.js';
import { StateStore } from '../core/state-store.js';
import { queueCodexMessage } from '../core/codex-dispatch.js';

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 30_000;
const DEBOUNCE_MS = 1_000;

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
  private onInstructionHandler: (instruction: unknown) => void;

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
    this.onInstructionHandler = (instruction) =>
      this.sendToRole('watch', { type: 'watch_instruction_update', instruction } as any);
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
      this.store.on('instruction_update', this.onInstructionHandler);

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
        return;
      }
      if (msg.type === 'task_control') {
        this.handleTaskControl(conn, msg as TaskControlMsg);
        return;
      }
      if (msg.type === 'thread_message') {
        this.handleThreadMessage(conn, msg as ThreadMessageMsg);
        return;
      }
      if (msg.type === 'watch_instruction_get') {
        this.handleWatchInstructionGet(conn, msg as WatchInstructionGetMsg);
        return;
      }
      if (msg.type === 'watch_instruction_complete') {
        this.handleWatchInstructionComplete(conn, msg as WatchInstructionCompleteMsg);
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

  private handleTaskControl(conn: ClientConn, msg: TaskControlMsg) {
    const threadId = String(msg.threadId ?? '');
    const result = this.store.handleTaskControl(
      threadId,
      msg.action,
      typeof msg.reason === 'string' ? msg.reason.slice(0, 160) : undefined,
      `watch:${conn.role}`,
    );
    send(conn, {
      type: 'control_result',
      threadId,
      action: msg.action,
      accepted: result.accepted,
      supported: result.supported,
      message: result.message,
      tsMs: Date.now(),
    });
    console.log(`[ws-server] task control ${msg.action}: ${result.message}`);
  }

  private async handleThreadMessage(conn: ClientConn, msg: ThreadMessageMsg) {
    const threadId = String(msg.threadId ?? '');
    const source = msg.source === 'watch_voice' ? 'watch_voice' : 'watch_quick_reply';
    const result = this.store.recordThreadMessage(
      threadId,
      String(msg.text ?? ''),
      source,
      typeof msg.requestId === 'string' ? msg.requestId : undefined,
    );

    let accepted = result.accepted;
    let message = result.message;
    if (result.accepted && result.id) {
      const dispatch = await queueCodexMessage(
        threadId,
        buildQueuePrompt(result.id, String(msg.text ?? '')),
      );
      if (dispatch.ok) {
        this.store.markWatchInstructionDispatched(result.id);
        message = '已投递到 Codex 会话，等待回应';
      } else {
        message = `已进入本地收件箱；Codex 会话投递失败：${dispatch.output || 'unknown error'}`;
      }
      console.log(`[ws-server] codex queue ${result.id}: ${dispatch.ok ? 'ok' : dispatch.output}`);
    }

    send(conn, {
      type: 'control_result',
      threadId,
      action: 'send_message',
      accepted,
      supported: true,
      message,
      tsMs: Date.now(),
      requestId: result.id,
    });
    console.log(`[ws-server] watch message ${result.id}: ${message}`);
  }

  private async handleWatchInstructionGet(conn: ClientConn, msg: WatchInstructionGetMsg) {
    if (conn.role !== 'mcp') {
      send(conn, { type: 'error', code: 'forbidden', message: 'watch_instruction_get requires mcp device' });
      return;
    }
    const threadId = typeof msg.threadId === 'string' ? msg.threadId : undefined;
    const waitSeconds = Number.isFinite(msg.waitSeconds) ? Number(msg.waitSeconds) : 10;
    const instructions = await this.store.waitForWatchInstructions(
      String(msg.reqId ?? ''),
      threadId,
      waitSeconds,
    );
    this.store.markWatchInstructionsDelivered(
      instructions.map((item) => item.id),
      'codex-poll',
    );
    send(conn, {
      type: 'watch_instruction_get_result',
      reqId: msg.reqId,
      instructions,
    });
  }

  private handleWatchInstructionComplete(conn: ClientConn, msg: WatchInstructionCompleteMsg) {
    if (conn.role !== 'mcp') {
      send(conn, { type: 'error', code: 'forbidden', message: 'watch_instruction_complete requires mcp device' });
      return;
    }
    const result = this.store.completeWatchInstruction(
      String(msg.id ?? ''),
      msg.status === 'failed' ? 'failed' : 'completed',
      typeof msg.result === 'string' ? msg.result : undefined,
    );
    send(conn, {
      type: 'watch_instruction_complete_result',
      reqId: msg.reqId,
      accepted: result.accepted,
      instruction: result.instruction,
      message: result.message,
    });
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
      action: typeof msg.action === 'string' ? msg.action : undefined,
      targetPath: typeof msg.targetPath === 'string' ? msg.targetPath : undefined,
      affectedFiles: Array.isArray(msg.affectedFiles)
        ? msg.affectedFiles.filter((v): v is string => typeof v === 'string')
        : undefined,
      commandPreview: typeof msg.commandPreview === 'string' ? msg.commandPreview : undefined,
      reasons: Array.isArray(msg.reasons)
        ? msg.reasons.filter((v): v is string => typeof v === 'string')
        : undefined,
      reversible: typeof msg.reversible === 'boolean' ? msg.reversible : undefined,
      metadata: msg.metadata && typeof msg.metadata === 'object' && !Array.isArray(msg.metadata)
        ? msg.metadata as Record<string, unknown>
        : undefined,
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

function buildQueuePrompt(id: string, request: string): string {
  const clean = request.trim();
  const mapped = clean === '输出当前进展摘要'
    ? '请基于当前对话的最新进展，直接回复一条简短摘要（不超过 200 字）。不要开始新的修改。'
    : clean === '只分析问题，不要修改代码'
      ? '请分析当前问题并给出结论。不要修改任何文件。'
      : clean === '先停下来，等我回来'
        ? '请暂停推进当前任务，保存当前上下文，等待用户回来后再继续。'
        : clean;

  return `[Codex Watch #${id}] ${mapped}\n这是用户从手表发来的快捷指令，请直接在当前对话中回应。`;
}

function send(conn: ClientConn, msg: ServerToWatchMsg) {
  if (conn.ws.readyState === WebSocket.OPEN) {
    conn.ws.send(JSON.stringify(msg));
  }
}
