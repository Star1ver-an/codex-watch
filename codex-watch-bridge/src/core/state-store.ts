import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalEntry,
  ApprovalRisk,
  ThreadPhase,
  ThreadState,
} from '../types.js';

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
const SNAPSHOP_LIMIT = 30;

interface ApprovalWaiter {
  resolve: (decision: ApprovalDecision, note?: string) => void;
}

export class StateStore extends EventEmitter {
  private threads = new Map<string, ThreadState>();
  private phaseBeforeApproval = new Map<string, ThreadPhase>();
  private approvalWaiters = new Map<string, ApprovalWaiter>();
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
        break;
      case 'task_complete':
        if (t.phase !== 'waiting_approval') t.phase = 'idle';
        touch();
        break;
      case 'turn_aborted':
        if (t.phase !== 'waiting_approval') t.phase = 'aborted';
        touch();
        break;
      case 'item_completed':
        if (ev.detail) t.lastEvent = ev.detail;
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

    const approval: ApprovalEntry = {
      id: 'mcp-' + crypto.randomBytes(6).toString('hex'),
      title: opts.title.slice(0, 120),
      detail: opts.detail.slice(0, 600),
      risk: opts.risk,
      createdAtMs: Date.now(),
      source: 'mcp',
    };
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
        this.applyRolloutEvent(t.id, { tsMs: Date.now(), kind: 'approval_resolved', approvalId });
        this.emitChange(t.id);
        this.fireApprovalResult(approvalId, decision, note);
        return { threadId: t.id, title: t.title };
      }
    }
    return null;
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
    const approval: ApprovalEntry = {
      id: 'demo-' + crypto.randomBytes(6).toString('hex'),
      title: 'Run install command (demo)',
      detail: 'npm install left-pad --save-dev   # injected by bridge --demo',
      risk: 'medium',
      createdAtMs: Date.now(),
      source: 'demo',
    };
    this.applyRolloutEvent(t.id, { tsMs: Date.now(), kind: 'approval_request', approval });
    this.emitChange(t.id);
    return approval;
  }

  snapshot(limit = SNAPSHOP_LIMIT): ThreadState[] {
    return [...this.threads.values()]
      .sort((a, b) => b.lastActivityMs - a.lastActivityMs)
      .slice(0, limit)
      .map((t) => ({ ...t, pendingApprovals: [...t.pendingApprovals] }));
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
