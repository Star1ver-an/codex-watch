import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalEntry,
  ApprovalRisk,
  TaskControlAction,
  ThreadPhase,
  ThreadState,
  TimelineEvent,
  TimelineEventKind,
  WatchInstruction,
  WatchInstructionStatus,
} from '../types.js';
import { approvalWithMetadata, type ApprovalMetadata } from './approval-metadata.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RolloutEvent {
  tsMs: number;
  kind:
    | 'task_started'
    | 'task_complete'
    | 'turn_aborted'
    | 'item_completed'
    | 'token_count'
    | 'approval_request'
    | 'approval_resolved'
    | 'context'
    | 'other';
  detail?: string;
  tokens?: number;
  approval?: ApprovalEntry;
  approvalId?: string;
  cwd?: string;
  model?: string;
  approvalPolicy?: string;
  title?: string;
  agent?: string;
  isSubagent?: boolean;
}

export interface SqliteThreadRow {
  id: string;
  title: string | null;
  preview: string | null;
  cwd: string | null;
  model: string | null;
  approval_mode: string | null;
  tokens_used: number | null;
  updated_at_ms: number | null;
  recency_at_ms: number | null;
}

const RUNNING_STALE_MS = 10 * 60 * 1000;   // running -> idle after 10 min silence
const APPROVAL_TTL_MS = 15 * 60 * 1000;    // pending approvals expire after 15 min
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_LOG_PATH = path.join(__dirname, '..', '..', 'approval-audit.jsonl');
const CONTROL_AUDIT_LOG_PATH = path.join(__dirname, '..', '..', 'task-control-audit.jsonl');
const MESSAGE_AUDIT_LOG_PATH = path.join(__dirname, '..', '..', 'watch-message-audit.jsonl');
const TIMELINE_LIMIT = 20;
const WATCH_INSTRUCTION_TTL_MS = 30 * 60 * 1000;
const SNAPSHOP_LIMIT = 30;

interface ApprovalWaiter {
  resolve: (decision: ApprovalDecision, note?: string) => void;
}

interface InstructionWaiter {
  threadId?: string;
  timer: NodeJS.Timeout;
  resolve: (items: WatchInstruction[]) => void;
}

export class StateStore extends EventEmitter {
  private threads = new Map<string, ThreadState>();
  private phaseBeforeApproval = new Map<string, ThreadPhase>();
  private approvalWaiters = new Map<string, ApprovalWaiter>();
  private watchInstructions = new Map<string, WatchInstruction>();
  private pendingCodexDispatch = new Map<string, { id: string; dispatchedAtMs: number }>();
  private instructionWaiters = new Map<string, InstructionWaiter>();
  private sweeper: NodeJS.Timeout | undefined;

  constructor() {
    super();
    this.sweeper = setInterval(() => this.sweep(), 30 * 1000);
    if (this.sweeper.unref) this.sweeper.unref();
  }

  dispose() {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  // ---- mutation entry points ----

  upsertFromSqlite(rows: SqliteThreadRow[]) {
    for (const row of rows) {
      const existing = this.threads.get(row.id);
      const title = row.title || row.preview?.slice(0, 60) || 'Untitled';
      if (!existing) {
        this.threads.set(row.id, {
          id: row.id,
          title,
          preview: row.preview ?? undefined,
          cwd: row.cwd ?? undefined,
          model: row.model ?? undefined,
          approvalPolicy: row.approval_mode ?? undefined,
          tokensUsed: row.tokens_used ?? undefined,
          lastActivityMs: row.recency_at_ms ?? row.updated_at_ms ?? Date.now(),
          phase: 'unknown',
          pendingApprovals: [],
          timeline: [],
        });
        this.emitChange(row.id);
      } else {
        let dirty = false;
        if (existing.title !== title) { existing.title = title; dirty = true; }
        if (row.preview && existing.preview !== row.preview) { existing.preview = row.preview; dirty = true; }
        if (row.tokens_used != null && existing.tokensUsed !== row.tokens_used) { existing.tokensUsed = row.tokens_used; dirty = true; }
        if (row.model && existing.model !== row.model) { existing.model = row.model; dirty = true; }
        if (row.approval_mode && existing.approvalPolicy !== row.approval_mode) { existing.approvalPolicy = row.approval_mode; dirty = true; }
        const sqliteMs = row.recency_at_ms ?? row.updated_at_ms ?? 0;
        if (sqliteMs > existing.lastActivityMs) { existing.lastActivityMs = sqliteMs; dirty = true; }
        if (dirty) this.emitChange(row.id);
      }
    }
  }

  applyRolloutEvent(threadId: string, ev: RolloutEvent) {
    let t = this.threads.get(threadId);
    if (!t) {
      t = {
        id: threadId,
        title: 'Live session',
        lastActivityMs: ev.tsMs,
        phase: 'unknown',
        pendingApprovals: [],
      };
      this.threads.set(threadId, t);
    }
    let dirty = false;
    const touch = () => {
      if (ev.tsMs > t!.lastActivityMs) { t!.lastActivityMs = ev.tsMs; dirty = true; }
    };

    switch (ev.kind) {
      case 'task_started':
        t.phase = 'running';
        touch();
        this.pushTimeline(t, ev.tsMs, 'started', ev.agent ? `${ev.agent} 开始` : '任务开始', ev.detail);
        break;
      case 'task_complete':
        if (t.phase !== 'waiting_approval') t.phase = 'idle';
        touch();
        this.pushTimeline(t, ev.tsMs, 'completed', ev.agent ? `${ev.agent} 完成` : '任务完成', ev.detail);
        break;
      case 'turn_aborted':
        if (t.phase !== 'waiting_approval') t.phase = 'aborted';
        touch();
        this.pushTimeline(t, ev.tsMs, 'aborted', ev.agent ? `${ev.agent} 中断` : '任务中断', ev.detail);
        break;
      case 'item_completed':
        if (ev.detail) {
          const agentDetail = ev.agent ? `[${ev.agent}] ${ev.detail}` : ev.detail;
          t.lastEvent = agentDetail;
          this.pushTimeline(
            t,
            ev.tsMs,
            'item_completed',
            ev.agent ? `${ev.agent} · ${summarizeTimelineDetail(ev.detail)}` : summarizeTimelineDetail(ev.detail),
            agentDetail,
          );
        }
        touch();
        break;
      case 'token_count':
        if (ev.tokens != null) t.tokensUsed = ev.tokens;
        touch();
        break;
      case 'context':
        if (ev.cwd) t.cwd = ev.cwd;
        if (ev.model) t.model = ev.model;
        if (ev.approvalPolicy) t.approvalPolicy = ev.approvalPolicy;
        if (ev.title) t.title = ev.title;
        touch();
        break;
      case 'approval_request':
        if (ev.approval) {
          if (!t.pendingApprovals.some((a) => a.id === ev.approval!.id)) {
            t.pendingApprovals.push(ev.approval);
          }
          this.phaseBeforeApproval.set(threadId, t.phase);
          t.phase = 'waiting_approval';
          touch();
          this.pushTimeline(t, ev.tsMs, 'approval_requested', ev.approval.title, ev.approval.commandPreview ?? ev.approval.detail);
          this.emit('approval', threadId, ev.approval);
        }
        break;
      case 'approval_resolved':
        if (ev.approvalId) {
          const before = t.pendingApprovals.length;
          t.pendingApprovals = t.pendingApprovals.filter((a) => a.id !== ev.approvalId);
          if (t.pendingApprovals.length !== before) {
            const prev = this.phaseBeforeApproval.get(threadId);
            if (prev && t.phase === 'waiting_approval') t.phase = prev;
            this.phaseBeforeApproval.delete(threadId);
            touch();
            this.pushTimeline(t, ev.tsMs, 'approval_resolved', '审批已处理', ev.approvalId);
          }
        }
        break;
      default:
        touch();
    }
    if (dirty) this.emitChange(threadId);
  }

  /**
   * Create an approval request coming from the MCP channel (agent-initiated).
   * Attached to the most plausible active thread (running first, then most recent),
   * or a synthetic thread when none exists.
   */
  createApproval(opts: {
    title: string;
    detail: string;
    risk: ApprovalRisk;
    timeoutMin?: number;
    action?: string;
    targetPath?: string;
    affectedFiles?: string[];
    commandPreview?: string;
    reasons?: string[];
    reversible?: boolean;
    metadata?: Record<string, unknown>;
  }): { approval: ApprovalEntry; threadId: string } {
    const all = [...this.threads.values()];
    const target =
      all.filter((t) => t.phase === 'running').sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0] ??
      all.sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0] ?? {
        id: 'mcp-approvals',
        title: 'Codex 审批',
        lastActivityMs: 0,
        phase: 'idle' as ThreadPhase,
        pendingApprovals: [],
      };
    if (!this.threads.has(target.id)) this.threads.set(target.id, target);

    const metadata: ApprovalMetadata = {
      action: opts.action,
      targetPath: opts.targetPath,
      affectedFiles: opts.affectedFiles,
      commandPreview: opts.commandPreview,
      reasons: opts.reasons,
      reversible: opts.reversible,
      metadata: opts.metadata,
    };
    const approval = approvalWithMetadata({
      id: 'mcp-' + crypto.randomBytes(6).toString('hex'),
      title: opts.title.slice(0, 120),
      detail: opts.detail.slice(0, 600),
      risk: opts.risk,
      createdAtMs: Date.now(),
      source: 'mcp' as const,
      ...metadata,
    }, { command: opts.commandPreview ?? opts.detail, cwd: opts.targetPath, files: opts.affectedFiles });
    this.applyRolloutEvent(target.id, {
      tsMs: Date.now(),
      kind: 'approval_request',
      approval,
    });
    this.emitChange(target.id);

    const timeoutMin = Math.max(1, Math.min(opts.timeoutMin ?? 10, 30));
    const timer = setTimeout(() => {
      this.fireApprovalResult(approval.id, 'timeout');
    }, timeoutMin * 60 * 1000);
    if (timer.unref) timer.unref();

    return { approval, threadId: target.id };
  }

  /**
   * Register a one-shot waiter for the decision of an approval.
   */
  onceApprovalResult(approvalId: string, cb: (decision: ApprovalDecision, note?: string) => void) {
    this.approvalWaiters.set(approvalId, { resolve: cb });
  }

  resolveApprovalFromWatch(
    approvalId: string,
    decision: 'approve' | 'reject',
    note?: string,
  ): { threadId: string; title: string } | null {
    for (const t of this.threads.values()) {
      const a = t.pendingApprovals.find((x) => x.id === approvalId);
      if (a) {
        this.auditApproval(a, t.id, t.title, decision, note);
        this.applyRolloutEvent(t.id, { tsMs: Date.now(), kind: 'approval_resolved', approvalId });
        this.emitChange(t.id);
        this.fireApprovalResult(approvalId, decision, note);
        return { threadId: t.id, title: t.title };
      }
    }
    return null;
  }

  private auditApproval(
    approval: ApprovalEntry,
    threadId: string,
    threadTitle: string,
    decision: 'approve' | 'reject' | 'timeout',
    note?: string,
  ) {
    const record = {
      atMs: Date.now(),
      approvalId: approval.id,
      threadId,
      threadTitle,
      decision,
      note,
      risk: approval.risk,
      source: approval.source,
      title: approval.title,
      commandPreview: approval.commandPreview,
      targetPath: approval.targetPath,
      affectedFiles: approval.affectedFiles,
    };
    try {
      fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Auditing is best effort; approval flow must remain available.
    }
  }

  handleTaskControl(
    threadId: string,
    action: TaskControlAction,
    reason?: string,
    deviceId = 'watch',
  ): { accepted: boolean; supported: boolean; message: string; threadTitle?: string } {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return { accepted: false, supported: false, message: '任务不存在或已被清理' };
    }

    const now = Date.now();
    const audit = (supported: boolean, accepted: boolean, message: string) => {
      this.auditControl(threadId, thread.title, action, reason, supported, accepted, message, deviceId);
      this.pushTimeline(thread, now, 'control_requested', controlTitle(action), message);
      this.emitChange(threadId);
    };

    if (action === 'cancel_approval') {
      const pending = thread.pendingApprovals[0];
      if (!pending) {
        const message = '当前没有待审批请求';
        audit(true, false, message);
        return { accepted: false, supported: true, message, threadTitle: thread.title };
      }
      const result = this.resolveApprovalFromWatch(pending.id, 'reject', reason || '手表请求取消审批');
      const message = result ? '已取消当前待审批请求' : '取消审批失败，请求已被处理';
      audit(true, !!result, message);
      return { accepted: !!result, supported: true, message, threadTitle: thread.title };
    }

    // Codex desktop currently has no authenticated bridge API for stopping or
    // pausing a running turn. Record intent safely instead of pretending it worked.
    const message = when(action, {
      stop: '已记录停止请求；当前 Codex 版本未开放远程终止接口',
      pause: '已记录暂停请求；当前 Codex 版本未开放远程暂停接口',
      resume: '已记录继续请求；当前 Codex 版本未开放远程继续接口',
      retry: '已记录重试请求；当前 Codex 版本未开放远程重试接口',
    }) || '控制请求已记录';
    audit(false, false, message);
    return { accepted: false, supported: false, message, threadTitle: thread.title };
  }

  recordThreadMessage(
    threadId: string,
    text: string,
    source: 'watch_quick_reply' | 'watch_voice' = 'watch_quick_reply',
    requestId?: string,
  ): { accepted: boolean; message: string; threadTitle?: string; id?: string } {
    const thread = this.threads.get(threadId);
    const clean = text.trim().slice(0, 240);
    if (!thread) return { accepted: false, message: '任务不存在或已被清理' };
    if (!clean) return { accepted: false, message: '内容不能为空' };

    const now = Date.now();
    const id = requestId?.trim() || ('wi-' + crypto.randomBytes(6).toString('hex'));
    const instruction: WatchInstruction = {
      id,
      threadId,
      threadTitle: thread.title,
      text: clean,
      source,
      status: 'queued',
      createdAtMs: now,
    };
    this.watchInstructions.set(id, instruction);
    this.pruneInstructions(now);

    const record = {
      atMs: now,
      id,
      threadId,
      threadTitle: thread.title,
      text: clean,
      source,
    };
    try {
      fs.appendFileSync(MESSAGE_AUDIT_LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Audit failure must not break the response path.
    }

    const message = '已提交到 Codex 收件箱，等待 Codex 拉取';
    this.auditControl(threadId, thread.title, 'send_message', clean, true, true, message, source);
    this.pushTimeline(thread, now, 'message', '手表快捷指令', clean);
    this.emitChange(threadId);
    this.emitInstruction(instruction);
    this.resolveInstructionWaiters();
    return { accepted: true, message, threadTitle: thread.title, id };
  }

  waitForWatchInstructions(
    reqId: string,
    threadId: string | undefined,
    waitSeconds = 10,
  ): Promise<WatchInstruction[]> {
    const available = this.queuedWatchInstructions(threadId);
    if (available.length > 0) return Promise.resolve(available);

    const waitMs = Math.max(0, Math.min(waitSeconds, 30)) * 1000;
    if (waitMs === 0) return Promise.resolve([]);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.instructionWaiters.delete(reqId);
        resolve([]);
      }, waitMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.instructionWaiters.set(reqId, { threadId, timer, resolve });
    });
  }

  markWatchInstructionsDelivered(ids: string[], consumer = 'codex'): WatchInstruction[] {
    const delivered: WatchInstruction[] = [];
    for (const id of ids) {
      const instruction = this.watchInstructions.get(id);
      if (!instruction || instruction.status !== 'queued') continue;
      instruction.status = 'delivered';
      instruction.deliveredAtMs = Date.now();
      const thread = this.threads.get(instruction.threadId);
      if (thread) {
        this.pushTimeline(
          thread,
          instruction.deliveredAtMs,
          'message',
          'Codex 已接收快捷指令',
          instruction.text,
        );
        this.emitChange(thread.id);
      }
      this.emitInstruction(instruction);
      delivered.push(instruction);
    }
    if (delivered.length > 0) {
      console.log(`[watch-instructions] delivered ${delivered.length} to ${consumer}`);
      this.resolveInstructionWaiters();
    }
    return delivered;
  }

  markWatchInstructionDispatched(id: string): WatchInstruction | undefined {
    const instruction = this.watchInstructions.get(id);
    if (!instruction || instruction.status !== 'queued') return instruction;
    instruction.status = 'dispatched';
    instruction.deliveredAtMs = Date.now();
    this.pendingCodexDispatch.set(instruction.threadId, {
      id,
      dispatchedAtMs: instruction.deliveredAtMs ?? Date.now(),
    });
    const thread = this.threads.get(instruction.threadId);
    if (thread) {
      this.pushTimeline(
        thread,
        instruction.deliveredAtMs,
        'message',
        '快捷指令已投递到 Codex 会话',
        instruction.text,
      );
      this.emitChange(instruction.threadId);
    }
    this.emitInstruction(instruction);
    return instruction;
  }

  recordAgentMessage(
    threadId: string,
    text: string,
    tsMs = Date.now(),
    originThreadId = threadId,
    isSubagent = false,
  ) {
    const clean = text.trim();
    if (!clean) return;

    const pending = this.pendingCodexDispatch.get(threadId);
    const belongsToDispatchedTurn =
      !!pending &&
      !isSubagent &&
      originThreadId === threadId &&
      tsMs >= pending.dispatchedAtMs;

    // Subagent and pre-dispatch assistant messages must never satisfy a quick
    // instruction. Earlier this caused an older child reply to be shown as the
    // answer before the parent agent had actually responded.
    if (!belongsToDispatchedTurn) return;

    const thread = this.threads.get(threadId);
    if (!thread) return;

    const summary = clean.replace(/\s+/g, ' ').slice(0, 240);
    thread.lastEvent = `MSG: ${summary}`;
    this.pushTimeline(thread, tsMs, 'message', 'Codex 回应', summary);
    this.pendingCodexDispatch.delete(threadId);
    this.completeWatchInstruction(pending.id, 'completed', clean.slice(0, 30_000));
  }

  completeWatchInstruction(
    id: string,
    status: 'completed' | 'failed',
    result?: string,
  ): { accepted: boolean; instruction?: WatchInstruction; message: string } {
    const instruction = this.watchInstructions.get(id);
    if (!instruction) {
      return { accepted: false, message: '快捷指令不存在或已过期' };
    }
    if (instruction.status === 'completed' || instruction.status === 'failed') {
      return { accepted: true, instruction, message: '快捷指令已完成' };
    }

    instruction.status = status;
    instruction.completedAtMs = Date.now();
    instruction.result = result?.trim().slice(0, 30_000);
    const thread = this.threads.get(instruction.threadId);
    if (thread) {
      this.pushTimeline(
        thread,
        instruction.completedAtMs,
        'message',
        status === 'completed' ? 'Codex 已回应快捷指令' : 'Codex 处理快捷指令失败',
        instruction.result ?? instruction.text,
      );
      this.emitChange(thread.id);
    }
    this.emitInstruction(instruction);
    return {
      accepted: true,
      instruction,
      message: status === 'completed' ? '快捷指令已完成' : '快捷指令处理失败',
    };
  }

  private queuedWatchInstructions(threadId?: string): WatchInstruction[] {
    this.pruneInstructions(Date.now());
    return [...this.watchInstructions.values()]
      .filter((item) => item.status === 'queued' && (!threadId || item.threadId === threadId))
      .sort((a, b) => a.createdAtMs - b.createdAtMs);
  }

  private resolveInstructionWaiters() {
    for (const [reqId, waiter] of [...this.instructionWaiters.entries()]) {
      const items = this.queuedWatchInstructions(waiter.threadId);
      if (items.length === 0) continue;
      clearTimeout(waiter.timer);
      this.instructionWaiters.delete(reqId);
      waiter.resolve(items);
    }
  }

  private pruneInstructions(now = Date.now()) {
    for (const [id, instruction] of [...this.watchInstructions.entries()]) {
      if (now - instruction.createdAtMs <= WATCH_INSTRUCTION_TTL_MS) continue;
      if (instruction.status === 'queued' || instruction.status === 'delivered') {
        instruction.status = 'expired';
        this.emitInstruction(instruction);
      }
      this.watchInstructions.delete(id);
    }
  }

  private emitInstruction(instruction: WatchInstruction) {
    this.emit('instruction_update', { ...instruction });
  }

  private pushTimeline(
    thread: ThreadState,
    tsMs: number,
    kind: TimelineEventKind,
    title: string,
    detail?: string,
  ) {
    const event: TimelineEvent = {
      id: `${tsMs}:${kind}:${crypto.createHash('sha1').update(`${title}|${detail ?? ''}`).digest('hex').slice(0, 10)}`,
      tsMs,
      kind,
      title: title.slice(0, 120),
      detail: detail?.slice(0, 240),
    };
    if (thread.timeline?.some((item) => item.id === event.id)) return;
    thread.timeline = [event, ...(thread.timeline ?? [])].slice(0, TIMELINE_LIMIT);
  }

  private auditControl(
    threadId: string,
    threadTitle: string,
    action: TaskControlAction | 'send_message',
    reason: string | undefined,
    supported: boolean,
    accepted: boolean,
    result: string,
    deviceId: string,
  ) {
    const record = {
      atMs: Date.now(),
      threadId,
      threadTitle,
      action,
      reason,
      supported,
      accepted,
      result,
      deviceId,
    };
    try {
      fs.appendFileSync(CONTROL_AUDIT_LOG_PATH, JSON.stringify(record) + '\n', 'utf-8');
    } catch {
      // Auditing is best effort.
    }
  }

  injectDemoApproval(threadId?: string): ApprovalEntry | null {
    let t = threadId ? this.threads.get(threadId) : undefined;
    if (!t) {
      t = [...this.threads.values()].sort((a, b) => b.lastActivityMs - a.lastActivityMs)[0];
    }
    if (!t) {
      t = {
        id: 'demo-thread',
        title: 'Demo thread',
        lastActivityMs: Date.now(),
        phase: 'idle',
        pendingApprovals: [],
      };
      this.threads.set(t.id, t);
    }
    const approval = approvalWithMetadata({
      id: 'demo-' + crypto.randomBytes(6).toString('hex'),
      title: 'Run install command (demo)',
      detail: 'npm install left-pad --save-dev   # injected by bridge --demo',
      risk: 'medium',
      createdAtMs: Date.now(),
      source: 'demo' as const,
    }, { command: 'npm install left-pad --save-dev' });
    this.applyRolloutEvent(t.id, { tsMs: Date.now(), kind: 'approval_request', approval });
    this.emitChange(t.id);
    return approval;
  }

  snapshot(limit = SNAPSHOP_LIMIT): ThreadState[] {
    return [...this.threads.values()]
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .slice(0, limit)
      .map((t) => ({ ...t, pendingApprovals: [...t.pendingApprovals], timeline: [...(t.timeline ?? [])] }));
  }

  // ---- internals ----

  private fireApprovalResult(approvalId: string, decision: ApprovalDecision, note?: string) {
    const waiter = this.approvalWaiters.get(approvalId);
    if (waiter) {
      this.approvalWaiters.delete(approvalId);
      try { waiter.resolve(decision, note); } catch { /* ignore */ }
    }
  }

  private sweep() {
    const now = Date.now();
    this.pruneInstructions(now);
    for (const t of this.threads.values()) {
      let dirty = false;
      if ((t.phase === 'running' || t.phase === 'unknown') && now - t.lastActivityMs > RUNNING_STALE_MS) {
        t.phase = 'idle';
        dirty = true;
      }
      if (t.pendingApprovals.length > 0) {
        const expired = t.pendingApprovals.filter((a) => now - a.createdAtMs >= APPROVAL_TTL_MS);
        if (expired.length > 0) {
          t.pendingApprovals = t.pendingApprovals.filter((a) => now - a.createdAtMs < APPROVAL_TTL_MS);
          if (t.phase === 'waiting_approval') {
            const prev = this.phaseBeforeApproval.get(t.id);
            t.phase = prev ?? 'idle';
            this.phaseBeforeApproval.delete(t.id);
          }
          for (const a of expired) this.fireApprovalResult(a.id, 'timeout');
          dirty = true;
        }
      }
      if (dirty) this.emitChange(t.id);
    }
  }

  private emitChange(threadId: string) {
    this.emit('thread', threadId);
  }
}

function summarizeTimelineDetail(detail: string): string {
  const clean = detail.replace(/\s+/g, ' ').trim();
  if (clean.startsWith('CMD:')) return '执行命令';
  if (clean.startsWith('MSG:')) return '生成回复';
  if (clean.toLowerCase() === 'thinking...') return '思考中';
  return '完成一个步骤';
}

function controlTitle(action: TaskControlAction | 'send_message'): string {
  switch (action) {
    case 'stop': return '请求停止';
    case 'pause': return '请求暂停';
    case 'resume': return '请求继续';
    case 'retry': return '请求重试';
    case 'cancel_approval': return '取消审批';
    case 'send_message': return '发送快捷指令';
  }
}

function when<T extends string, R>(value: T, cases: Record<T, R>): R | undefined {
  return cases[value];
}
