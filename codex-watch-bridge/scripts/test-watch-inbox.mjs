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
    console.log('<<', line);
    try { handle(JSON.parse(line)); } catch {}
  }
});
child.stderr.on('data', (d) => console.error('[mcp-err]', String(d).trim()));
child.on('exit', (code) => process.exit(code === 0 ? 0 : 1));

function send(o) { child.stdin.write(JSON.stringify(o) + '\n'); }
function handle(msg) {
  if (msg.id === 1) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_watch_instructions', arguments: { waitSeconds: 8 } } });
  } else if (msg.id === 2) {
    const text = msg.result?.content?.[0]?.text ?? '';
    const match = text.match(/id:\s*(\S+)/);
    if (!match) {
      console.log('NO_INSTRUCTIONS');
      child.kill();
      process.exit(0);
    }
    send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'complete_watch_instruction',
        arguments: {
          id: match[1],
          status: 'completed',
          result: '当前正在修改 Codex Watch 收件箱链路；M7 中控已完成，正在验证快捷指令回传。',
        },
      },
    });
  } else if (msg.id === 3) {
    console.log('COMPLETE_ACK', JSON.stringify(msg.result));
    child.kill();
    process.exit(0);
  }
}
setTimeout(() => { child.kill(); process.exit(1); }, 30000);
send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"inbox-test","version":"0"}}});
