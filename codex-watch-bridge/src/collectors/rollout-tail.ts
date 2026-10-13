import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { StateStore, type RolloutEvent } from '../core/state-store.js';
import type { ApprovalEntry } from '../types.js';
import { sessionsDir } from '../config.js';

const INITIAL_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;
const INITIAL_SCAN_MAX_FILES = 25;
const INITIAL_TAIL_BYTES = 256 * 1024;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface TrackedFile {
  path: string;
  offset: number;
  threadId?: string;
  knownThreadIds: Set<string>;
}

const DEBUG = process.env.DEBUG === '1';

export class RolloutTail {
  private store: StateStore;
  private dir: string;
  private watcher: fs.FSWatcher | undefined;
  private tracked = new Map<string, TrackedFile>();
  private pending = new Set<string>();
  private unknownEventTypes = new Set<string>();

  constructor(store: StateStore) {
    this.store = store;
    this.dir = sessionsDir();
  }

  async start(): Promise<void> {
    await this.initialScan();
    try {
      this.watcher = fs.watch(this.dir, { recursive: true }, (event, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        const full = path.join(this.dir, filename);
        this.schedulePump(full);
      });
    } catch (err) {
      console.error('[rollout-tail] fs.watch failed:', err);
    }
    console.log(`[rollout-tail] watching ${this.dir} (tracking ${this.tracked.size} files)`);
  }

  stop() {
    this.watcher?.close();
  }

  // ---- initial scan: recent files, head (session_meta) + tail (recent events) ----

  private async initialScan(): Promise<void> {
    let files: string[] = [];
    const walk = (d: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && e.name.endsWith('.jsonl')) files.push(p);
      }
    };
    walk(this.dir);
    const cutoff = Date.now() - INITIAL_SCAN_WINDOW_MS;
    files = files
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .filter((x) => x.m >= cutoff)
      .sort((a, b) => b.m - a.m)
      .slice(0, INITIAL_SCAN_MAX_FILES)
      .map((x) => x.f);

    for (const f of files) {
      try {
        const st = fs.statSync(f);
        const tf: TrackedFile = { path: f, offset: st.size, knownThreadIds: new Set() };
        this.tracked.set(f, tf);

        // Head: capture session_meta (first lines)
        const head = await readHeadLines(f, 8 * 1024);
        for (const line of head) this.handleLine(tf, line, true);

        // Tail: recent events
        const tailBytes = Math.min(INITIAL_TAIL_BYTES, st.size);
        const tailLines = await readTailLines(f, tailBytes);
        const cutoffMs = Date.now() - INITIAL_SCAN_WINDOW_MS;
        for (const line of tailLines) this.handleLine(tf, line, false, cutoffMs);
      } catch (err) {
        console.error(`[rollout-tail] initial scan error for ${f}:`, err);
      }
    }
  }

  // ---- live tailing ----

  private schedulePump(full: string) {
    if (this.pending.has(full)) return;
    this.pending.add(full);
    setImmediate(() => {
      this.pending.delete(full);
      this.pump(full).catch((err) => console.error(`[rollout-tail] pump error ${full}:`, err));
    });
  }

  private async pump(full: string): Promise<void> {
    let tf = this.tracked.get(full);
    if (!tf) {
      try {
        fs.statSync(full);
      } catch {
        return; // deleted
      }
      tf = { path: full, offset: 0, knownThreadIds: new Set() };
      this.tracked.set(full, tf);
      if (DEBUG) console.log(`[rollout-tail] new file: ${full}`);
    }
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      return;
    }
    if (st.size < tf.offset) tf.offset = 0; // truncated/rotated
    if (st.size === tf.offset) return;

    const stream = fs.createReadStream(full, { start: tf.offset });
    let remainder: Buffer = Buffer.alloc(0);
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      tf.offset += chunk.length;
      let buf = Buffer.concat([remainder, chunk]);
      let idx: number;
      while ((idx = buf.indexOf(0x0a)) !== -1) {
        const line = buf.subarray(0, idx);
        buf = buf.subarray(idx + 1);
        this.handleLine(tf, line.toString('utf-8'), false);
      }
      remainder = buf;
    }
    if (remainder.length > 0) {
      // Partial line without trailing newline yet: process it (events are written line-complete in practice).
      this.handleLine(tf, remainder.toString('utf-8'), false);
    }
  }

  // ---- line dispatch ----

  private handleLine(tf: TrackedFile, raw: string, fromHead: boolean, minTsMs = 0) {
    const line = raw.trim();
    if (!line || line[0] !== '{') return;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return;
    }
    const tsMs = parseTs(obj?.timestamp) ?? Date.now();
    if (minTsMs && tsMs < minTsMs) return;

    const type = obj?.type as string | undefined;
    const payload = obj?.payload ?? {};

    // Resolve thread id
    let threadId: string | undefined;
    if (type === 'session_meta') {
      threadId = payload.id || payload.session_id;
      if (threadId) tf.threadId = threadId;
    } else if (type === 'event_msg' || type === 'response_item') {
      threadId = payload.thread_id || tf.threadId;
    }
    if (!threadId) {
      const m = path.basename(tf.path).match(UUID_RE);
      threadId = m ? m[0] : tf.threadId;
    }
    if (!threadId) return; // cannot attribute yet

    const push = (ev: RolloutEvent) => this.store.applyRolloutEvent(threadId!, ev);

    if (type === 'session_meta') {
      push({ tsMs, kind: 'context', cwd: payload.cwd });
      return;
    }
    if (type === 'turn_context') {
      push({
        tsMs,
        kind: 'context',
        cwd: payload.cwd,
        model: payload.model,
        approvalPolicy: payload.approval_policy,
      });
      return;
    }
    if (type !== 'event_msg') return; // response_item/token_usage_record/world_state ignored for M1

    const pt = payload.type as string | undefined;
    if (!pt) return;

    switch (pt) {
      case 'task_started':
        push({ tsMs, kind: 'task_started' });
        return;
      case 'task_complete':
        push({ tsMs, kind: 'task_complete' });
        return;
      case 'turn_aborted':
        push({ tsMs, kind: 'turn_aborted' });
        return;
      case 'token_count': {
        const tokens = payload?.info?.total_token_usage?.total_tokens;
        push({ tsMs, kind: 'token_count', tokens: typeof tokens === 'number' ? tokens : undefined });
        return;
      }
      case 'item_completed':
        push({ tsMs, kind: 'item_completed', detail: summarizeItem(payload.item) });
        return;
      default:
        break;
    }

    // Generic approval detection (system approval payloads are rare in current history;
    // match by name so future event shapes are picked up).
    if (/approval/i.test(pt)) {
      if (/request/i.test(pt)) {
        const approval: ApprovalEntry = {
          id: payload.call_id || payload.id || `evt-${obj.ordinal ?? tsMs}`,
          title: approvalTitle(payload, pt),
          detail: JSON.stringify(payload).slice(0, 600),
          risk: guessRisk(payload),
          createdAtMs: tsMs,
          source: 'rollout',
        };
        push({ tsMs, kind: 'approval_request', approval });
        if (DEBUG) console.log(`[rollout-tail] approval request detected: ${JSON.stringify(approval).slice(0, 200)}`);
      } else {
        const approvalId = payload.call_id || payload.id;
        push({ tsMs, kind: 'approval_resolved', approvalId });
      }
      return;
    }

    if (DEBUG && !this.unknownEventTypes.has(pt)) {
      this.unknownEventTypes.add(pt);
      console.log(`[rollout-tail] (info) ignoring event type: ${pt}`);
    }
  }
}

// ---- helpers ----

function parseTs(ts: unknown): number | undefined {
  if (typeof ts !== 'string') return undefined;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : undefined;
}

function approvalTitle(payload: any, pt: string): string {
  const cmd = payload.command ?? payload.argv;
  if (Array.isArray(cmd) && cmd.length > 0) {
    return `${pt}: ${joinCommand(cmd).slice(0, 80)}`;
  }
  return pt;
}

function guessRisk(payload: any): ApprovalEntry['risk'] {
  const s = JSON.stringify(payload).toLowerCase();
  if (s.includes('danger-full-access') || s.includes('sudo')) return 'high';
  if (s.includes('workspace-write') || s.includes('network')) return 'medium';
  return 'unknown';
}

function summarizeItem(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const it = item.type as string | undefined;
  if (it === 'CommandExecution' && Array.isArray(item.command)) {
    return `CMD: ${joinCommand(item.command).slice(0, 120)}`;
  }
  if (it === 'Reasoning') return 'thinking...';
  if (it === 'AgentMessage' || it === 'Message') {
    const text = typeof item.text === 'string' ? item.text : undefined;
    return text ? `MSG: ${text.slice(0, 100)}` : it;
  }
  return it;
}

function joinCommand(cmd: unknown[]): string {
  const parts = cmd.map((c) => (typeof c === 'string' ? c : JSON.stringify(c)));
  // Skip interpreter wrapper: pwsh.exe -Command <actual command>
  if (
    parts.length >= 3 &&
    /powershell|pwsh/i.test(parts[0]) &&
    /^-command$/i.test(parts[1])
  ) {
    return parts.slice(2).join(' ');
  }
  return parts.join(' ');
}

async function readHeadLines(file: string, bytes: number): Promise<string[]> {
  return readRangeLines(file, 0, bytes);
}

async function readTailLines(file: string, tailBytes: number): Promise<string[]> {
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - tailBytes);
  const lines = await readRangeLines(file, start, st.size - start);
  // Drop first (likely partial) line when we did not start at 0.
  if (start > 0 && lines.length > 0) lines.shift();
  return lines;
}

function readRangeLines(file: string, start: number, length: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const lines: string[] = [];
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { start, end: start + length - 1 }),
      crlfDelay: Infinity,
    });
    rl.on('line', (l) => lines.push(l));
    rl.on('close', () => resolve(lines));
    rl.on('error', reject);
  });
}
