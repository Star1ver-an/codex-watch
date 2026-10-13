// Simulates an MCP client: initialize -> tools/list -> tools/call(request_watch_approval)
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['dist/mcp/mcp-server.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';

child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    console.log('<<', line.slice(0, 300));
    try { handle(JSON.parse(line)); } catch {}
  }
});
child.stderr.on('data', (d) => console.error('[mcp-err]', String(d).trim()));
child.on('exit', (code) => { console.log('mcp exited', code); process.exit(code === 0 ? 0 : 1); });

function send(o) { console.log('>>', JSON.stringify(o).slice(0, 200)); child.stdin.write(JSON.stringify(o) + '\n'); }

function handle(msg) {
  if (msg.id === 1) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  } else if (msg.id === 2) {
    console.log('TOOLS:', msg.result?.tools?.map((t) => t.name).join(', '));
    send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'request_watch_approval',
        arguments: {
          title: 'M3 自测审批',
          detail: '端到端链路测试:approve 它即表示手表审批闭环成功。npm run demo --force',
          risk: 'low',
          timeoutMin: 5,
        },
      },
    });
  } else if (msg.id === 3) {
    console.log('TOOL RESULT:', JSON.stringify(msg.result));
    child.kill();
    process.exit(0);
  }
}

setTimeout(() => { console.error('TIMEOUT waiting tool result'); child.kill(); process.exit(1); }, 150000);

send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0"}}});
