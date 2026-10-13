// Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0).
// Exposes request_watch_approval to the Codex agent; relays to the bridge over
// a localhost WebSocket and blocks until the watch decision arrives.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEBUG_LOG = path.join(__dirname, '..', '..', 'mcp-debug.log');
function dlog(s: string) {
  try { fs.appendFileSync(DEBUG_LOG, new Date().toISOString().slice(11, 23) + ' ' + s + '\n'); } catch {}
}

dlog('mcp.js started pid=' + process.pid + ' argv=' + process.argv.join(','));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'bridge.config.json'), 'utf-8'));
dlog('config loaded, port=' + cfg.port);

interface PendingCall {
  resolve: (decision: string) => void;
}

const pending = new Map<string, PendingCall>();
let ws: WebSocket | null = null;
let connectPromise: Promise<void> | null = null;

function sendWs(msg: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function ensureConnected(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
  if (connectPromise) return connectPromise;
  dlog('ws connecting...');
  connectPromise = new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${cfg.loopbackPort ?? 8789}`);
    const t = setTimeout(() => { connectPromise = null; dlog('ws connect timeout'); reject(new Error('bridge connect timeout')); }, 8000);
    socket.on('open', () => {
      dlog('ws open, sending hello');
      socket.send(JSON.stringify({ type: 'hello', token: cfg.token, device: 'mcp' }));
    });
    socket.on('message', (data) => {
      let msg: any;
      try { msg = JSON.parse(String(data)); } catch { return; }
      dlog('ws message: ' + String(data).slice(0, 80));
      if (msg.type === 'welcome') {
        clearTimeout(t);
        ws = socket;
        dlog('ws ready (welcome)');
        resolve();
      } else if (msg.type === 'approval_request_result') {
        const p = pending.get(msg.reqId);
        if (p) {
          pending.delete(msg.reqId);
          p.resolve(String(msg.decision));
        }
      } else if (msg.type === 'error') {
        console.error(`[mcp] bridge error: ${msg.code} ${msg.message}`);
      }
    });
    socket.on('close', () => { dlog('ws closed'); ws = null; });
    socket.on('error', (err) => {
      dlog('ws error: ' + err.message);
      clearTimeout(t);
      connectPromise = null;
      reject(err);
    });
  });
  return connectPromise;
}

// ---- JSON-RPC over stdio ----

function reply(id: unknown, result: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function replyError(id: unknown, code: number, message: string) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

const TOOLS = [
  {
    name: 'request_watch_approval',
    description:
      '向用户的 Samsung 手表发送一条审批请求并阻塞等待结果。' +
      '当你即将执行高风险操作(删除文件、执行安装、对外发送数据、花钱的操作等)时调用本工具;' +
      '返回 approve 表示用户批准,继续执行;返回 reject 或 timeout 表示用户拒绝/未处理,不要执行该操作。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '审批标题,一句话说明要做什么,<=60字' },
        detail: { type: 'string', description: '详细内容:完整命令/文件路径/影响范围' },
        risk: { type: 'string', enum: ['low', 'medium', 'high'], description: '风险级别' },
        timeoutMin: { type: 'number', description: '等待超时分钟数(1-30,默认10)', minimum: 1, maximum: 30 },
      },
      required: ['title', 'detail'],
    },
  },
];

async function handleToolCall(name: string, args: any): Promise<{ text: string; isError: boolean }> {
  if (name !== 'request_watch_approval') {
    return { text: `unknown tool: ${name}`, isError: true };
  }
  const title = String(args?.title ?? '').trim();
  const detail = String(args?.detail ?? '').trim();
  if (!title || !detail) {
    return { text: '缺少必填参数 title / detail', isError: true };
  }
  const risk = ['low', 'medium', 'high'].includes(args?.risk) ? args.risk : 'unknown';
  const timeoutMin = Number.isFinite(Number(args?.timeoutMin)) ? Number(args.timeoutMin) : 10;
  const reqId = crypto.randomBytes(8).toString('hex');

  dlog('tool call: ensureConnected...');
  await ensureConnected();
  dlog('tool call: connected, sending create');
  sendWs({
    type: 'approval_request_create',
    reqId,
    title,
    detail,
    risk,
    timeoutMin,
  });

  const decision = await new Promise<string>((resolve) => {
    pending.set(reqId, { resolve });
    const t = setTimeout(() => {
      if (pending.has(reqId)) {
        pending.delete(reqId);
        resolve('timeout');
      }
    }, Math.min(Math.max(timeoutMin, 1), 30) * 60 * 1000 + 15 * 1000);
    if (t.unref) t.unref();
  });

  dlog('tool call: decision=' + decision);
  if (decision === 'approve') {
    return { text: '用户已在手表上批准(approve)。请继续执行该操作。', isError: false };
  }
  if (decision === 'reject') {
    return { text: '用户已在手表上拒绝(reject)。请不要执行该操作,并等待用户进一步指示。', isError: false };
  }
  return { text: '审批超时未处理(timeout)。请视为拒绝,不要执行该操作。', isError: false };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: any;
  try { msg = JSON.parse(trimmed); } catch { return; }
  const { id, method, params } = msg ?? {};
  dlog('rpc: ' + method + ' id=' + id);

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'codex-watch-bridge', version: '0.3.0' },
      });
      break;
    case 'notifications/initialized':
    case 'notifications/cancelled':
      break; // notifications: no reply
    case 'ping':
      reply(id, {});
      break;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      break;
    case 'tools/call': {
      const toolName = String(params?.name ?? '');
      handleToolCall(toolName, params?.arguments ?? {})
        .then((r) => reply(id, { content: [{ type: 'text', text: r.text }], isError: r.isError }))
        .catch((err) => reply(id, { content: [{ type: 'text', text: `工具执行失败: ${err?.message ?? err}` }], isError: true }));
      break;
    }
    default:
      if (id !== undefined && id !== null) {
        replyError(id, -32601, `method not found: ${method}`);
      }
  }
});
rl.on('close', () => process.exit(0));
