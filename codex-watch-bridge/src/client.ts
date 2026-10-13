import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ServerToWatchMsg, SnapshotMsg, ThreadUpdateMsg, ApprovalRequestMsg } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'bridge.config.json');

function argPort(): number | undefined {
  const i = process.argv.indexOf('--port');
  return i !== -1 ? parseInt(process.argv[i + 1], 10) : undefined;
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const port = argPort() ?? cfg.loopbackPort ?? cfg.port;
const url = `ws://127.0.0.1:${port}`;

console.log(`test client -> ${url}`);
const ws = new WebSocket(url);

let snapshot: SnapshotMsg | null = null;

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'hello', token: cfg.token, device: 'cli-test' }));
});

ws.on('close', (code, reason) => {
  console.log(`disconnected (${code} ${reason || ''})`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('connection error:', err.message);
  process.exit(1);
});

ws.on('message', (data) => {
  let msg: ServerToWatchMsg;
  try {
    msg = JSON.parse(String(data));
  } catch {
    return;
  }
  switch (msg.type) {
    case 'welcome':
      console.log(`welcome: ${msg.server} (protocol ${msg.protocol})`);
      break;
    case 'snapshot':
      snapshot = msg;
      printThreads(msg);
      printPrompt();
      break;
    case 'thread_update':
      printUpdate(msg);
      printPrompt();
      break;
    case 'approval_request':
      printApproval(msg as ApprovalRequestMsg);
      printPrompt();
      break;
    case 'error':
      console.log(`server error [${msg.code}]: ${msg.message}`);
      break;
  }
});

function fmtTokens(n?: number): string {
  if (n == null) return '-';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const PHASE_MARK: Record<string, string> = {
  running: '[RUN ]',
  waiting_approval: '[APPR]',
  idle: '[idle]',
  aborted: '[abrt]',
  unknown: '[ ?  ]',
};

function printThreads(msg: SnapshotMsg) {
  console.log(`--- snapshot (${msg.threads.length} threads) ---`);
  for (const t of msg.threads) {
    const appr = t.pendingApprovals.length > 0 ? ` approvals:${t.pendingApprovals.map((a) => a.id).join(',')}` : '';
    console.log(`${PHASE_MARK[t.phase] ?? '[ ?  ]'} ${fmtAge(t.lastActivityMs).padStart(5)} tok=${fmtTokens(t.tokensUsed).padStart(7)}  ${t.title.replace(/\s+/g, " ").slice(0, 60)}${appr}`);
  }
}

function printUpdate(msg: ThreadUpdateMsg) {
  const t = msg.thread;
  console.log(`update ${PHASE_MARK[t.phase] ?? '[ ?  ]'} ${t.title.replace(/\s+/g, " ").slice(0, 50)} | ${t.lastEvent ?? ''}`.slice(0, 140));
}

function printApproval(msg: ApprovalRequestMsg) {
  process.stdout.write('\x07');
  console.log('==================== APPROVAL REQUEST ====================');
  console.log(`thread : ${msg.threadTitle}`);
  console.log(`id     : ${msg.approval.id}`);
  console.log(`title  : ${msg.approval.title}`);
  console.log(`risk   : ${msg.approval.risk}`);
  console.log(`detail : ${msg.approval.detail}`);
  console.log(`approve with: approve ${msg.approval.id}   |   reject ${msg.approval.id}`);
  console.log('==========================================================');
}

function printPrompt() {
  process.stdout.write('> ');
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  if (cmd === 'list' && snapshot) {
    printThreads(snapshot);
  } else if ((cmd === 'approve' || cmd === 'a') && parts[1]) {
    ws.send(JSON.stringify({ type: 'approval_result', approvalId: parts[1], decision: 'approve' }));
    console.log(`sent approve for ${parts[1]}`);
  } else if ((cmd === 'reject' || cmd === 'r') && parts[1]) {
    ws.send(JSON.stringify({ type: 'approval_result', approvalId: parts[1], decision: 'reject' }));
    console.log(`sent reject for ${parts[1]}`);
  } else if (cmd === 'quit' || cmd === 'q') {
    ws.close();
    process.exit(0);
  } else if (cmd) {
    console.log('commands: list | approve <id> | reject <id> | quit');
  }
  printPrompt();
});
