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
    console.log('<<', line.slice(0, 500));
    try { handle(JSON.parse(line)); } catch {}
  }
});
child.stderr.on('data', (d) => console.error('[mcp-err]', String(d).trim()));
child.on('exit', (code) => { console.log('mcp exited', code); process.exit(code === 0 ? 0 : 1); });

function send(o) { console.log('>>', JSON.stringify(o).slice(0, 400)); child.stdin.write(JSON.stringify(o) + '\n'); }

function handle(msg) {
  if (msg.id === 1) {
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  } else if (msg.id === 2) {
    send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'request_watch_approval',
        arguments: {
          title: 'M6 高风险确认',
          detail: '测试结构化审批、强确认与审计记录。',
          risk: 'high',
          timeoutMin: 1,
          action: 'execute_command',
          commandPreview: 'Remove-Item -Recurse .\\build-test',
          targetPath: 'C:\\Users\\26381\\Documents\\ChatGPT\\watch应用',
          affectedFiles: ['build-test/a.txt', 'build-test/b.txt'],
          reasons: ['包含删除或不可逆写操作', '影响 2 个文件'],
          reversible: false,
        },
      },
    });
  } else if (msg.id === 3) {
    console.log('TOOL RESULT:', JSON.stringify(msg.result));
    child.kill();
    process.exit(0);
  }
}

setTimeout(() => { console.error('TIMEOUT waiting tool result'); child.kill(); process.exit(1); }, 120000);
send({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"m6-test","version":"0"}}});
