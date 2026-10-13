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
  resolve: (value: any) => void;
}

const pending = new Map<string, PendingCall>();
const instructionGets = new Map<string, PendingCall>();
const instructionCompletes = new Map<string, PendingCall>();
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
      } else if (msg.type === 'watch_instruction_get_result') {
        const p = instructionGets.get(msg.reqId);
        if (p) {
          instructionGets.delete(msg.reqId);
          p.resolve(Array.isArray(msg.instructions) ? msg.instructions : []);
        }
      } else if (msg.type === 'watch_instruction_complete_result') {
        const p = instructionCompletes.get(msg.reqId);
        if (p) {
          instructionCompletes.delete(msg.reqId);
          p.resolve(msg);
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
    name: 'get_watch_instructions',
    description:
      '拉取用户从手表发来的快捷指令。长时间执行任务的 Codex agent 应在关键节点调用本工具;' +
      '返回非空时必须处理用户请求,并在完成后调用 complete_watch_instruction 回传结果。',
    inputSchema: {
      type: 'object',
      properties: {
        threadId: { type: 'string', description: '可选,只拉取指定 Codex 线程的指令' },
        waitSeconds: { type: 'number', description: '没有新指令时长轮询等待秒数(0-30,默认10)', minimum: 0, maximum: 30 },
      },
    },
  },
  {
    name: 'complete_watch_instruction',
    description: '回传手表快捷指令的处理结果;结果会显示在手表任务详情中。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'get_watch_instructions 返回的指令 ID' },
        status: { type: 'string', enum: ['completed', 'failed'], description: '处理状态' },
        result: { type: 'string', description: '给用户看的简短结果,建议<=240字' },
      },
      required: ['id', 'status'],
    },
  },
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
        action: { type: 'string', description: '动作类型,例如 execute_command/write_file/deploy' },
        targetPath: { type: 'string', description: '影响的主要目录或文件' },
        affectedFiles: { type: 'array', items: { type: 'string' }, description: '受影响文件列表,最多8个' },
        commandPreview: { type: 'string', description: '将要执行的核心命令,用于手表展示' },
        reasons: { type: 'array', items: { type: 'string' }, description: '为什么需要审批/风险原因' },
        reversible: { type: 'boolean', description: '操作是否可逆' },
        metadata: { type: 'object', description: '额外的结构化上下文' },
      },
      required: ['title', 'detail'],
    },
  },
];

async function handleToolCall(name: string, args: any): Promise<{ text: string; isError: boolean }> {
  if (name === 'get_watch_instructions') {
    const reqId = crypto.randomBytes(8).toString('hex');
    await ensureConnected();
    sendWs({
      type: 'watch_instruction_get',
      reqId,
      threadId: typeof args?.threadId === 'string' ? args.threadId : undefined,
      waitSeconds: Number.isFinite(Number(args?.waitSeconds)) ? Number(args.waitSeconds) : 10,
    });
    const items = await new Promise<any[]>((resolve) => {
      instructionGets.set(reqId, { resolve });
      setTimeout(() => {
        if (instructionGets.delete(reqId)) resolve([]);
      }, 35_000);
    });

    if (items.length === 0) {
      return { text: '当前没有手表快捷指令。继续任务;适合时再调用本工具检查。', isError: false };
    }
    const lines = items.map((item) =>
      `- id: ${item.id}\n  threadId: ${item.threadId}\n  request: ${item.text}\n  createdAtMs: ${item.createdAtMs}`,
    );
    return {
      text:
        '收到手表快捷指令:\n' + lines.join('\n') +
        '\n请把这些内容视为用户请求。处理后必须调用 complete_watch_instruction,并给出手表可读的简短结果。',
      isError: false,
    };
  }

  if (name === 'complete_watch_instruction') {
    const id = String(args?.id ?? '').trim();
    const status = args?.status === 'failed' ? 'failed' : 'completed';
    const result = typeof args?.result === 'string' ? args.result.slice(0, 1000) : undefined;
    if (!id) return { text: '缺少必填参数 id', isError: true };

    const reqId = crypto.randomBytes(8).toString('hex');
    await ensureConnected();
    sendWs({ type: 'watch_instruction_complete', reqId, id, status, result });
    const ack = await new Promise<any>((resolve) => {
      instructionCompletes.set(reqId, { resolve });
      setTimeout(() => {
        if (instructionCompletes.delete(reqId)) resolve({ accepted: false, message: 'bridge ack timeout' });
      }, 8000);
    });
    return {
      text: ack.accepted
        ? `手表快捷指令已标记为 ${status}${result ? ': ' + result : ''}`
        : `回传失败: ${ack.message}`,
      isError: !ack.accepted,
    };
  }

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
  const metadata = {
    action: typeof args?.action === 'string' ? args.action.slice(0, 80) : undefined,
    targetPath: typeof args?.targetPath === 'string' ? args.targetPath.slice(0, 300) : undefined,
    affectedFiles: Array.isArray(args?.affectedFiles)
      ? args.affectedFiles.filter((v: unknown) => typeof v === 'string').slice(0, 8)
      : undefined,
    commandPreview: typeof args?.commandPreview === 'string' ? args.commandPreview.slice(0, 400) : undefined,
    reasons: Array.isArray(args?.reasons)
      ? args.reasons.filter((v: unknown) => typeof v === 'string').slice(0, 4)
      : undefined,
    reversible: typeof args?.reversible === 'boolean' ? args.reversible : undefined,
    metadata: args?.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)
      ? args.metadata
      : undefined,
  };

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
    ...metadata,
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
