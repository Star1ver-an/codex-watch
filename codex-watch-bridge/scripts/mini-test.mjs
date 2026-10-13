import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['dist/mcp/mcp-server.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
child.stdout.on('data', (d) => { console.log('GOT:', String(d).trim().slice(0, 100)); process.exit(0); });
child.stderr.on('data', (d) => console.log('ERR:', String(d).trim().slice(0, 200)));
setTimeout(() => { console.log('NO RESPONSE in 8s'); process.exit(1); }, 8000);
