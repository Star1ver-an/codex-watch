import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqliteThreadRow } from '../core/state-store.js';
import { StateStore } from '../core/state-store.js';

const POLL_MS = 2000;
const QUERY_LIMIT = 60;

export class SqlitePoller {
  private store: StateStore;
  private db: DatabaseSync | undefined;
  private timer: NodeJS.Timeout | undefined;
  private errored = false;

  constructor(store: StateStore) {
    this.store = store;
  }

  start(): void {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    const dbPath = path.join(home, '.codex', 'state_5.sqlite');
    try {
      this.db = new DatabaseSync(dbPath, { readOnly: true });
      console.log(`[sqlite-poller] opened ${dbPath} (readonly)`);
    } catch (err) {
      console.error('[sqlite-poller] failed to open database:', err);
      return;
    }
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private poll(): void {
    if (!this.db) return;
    try {
      const rows = this.db
        .prepare(
          `SELECT id, title, preview, cwd, model, approval_mode, tokens_used,
                  updated_at_ms, recency_at_ms
           FROM threads
           WHERE archived = 0
             AND COALESCE(thread_source, 'user') <> 'subagent'
           ORDER BY recency_at_ms DESC
           LIMIT ${QUERY_LIMIT}`
        )
        .all() as unknown as SqliteThreadRow[];
      if (rows.length > 0) this.store.upsertFromSqlite(rows);
      if (this.errored) {
        console.log('[sqlite-poller] recovered');
        this.errored = false;
      }
    } catch (err) {
      if (!this.errored) {
        console.error('[sqlite-poller] query failed (will retry):', err);
        this.errored = true;
      }
    }
  }
}
