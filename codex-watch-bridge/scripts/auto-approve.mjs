// Connects as a watch, waits for an approval_request, auto-approves it.
import fs from 'node:fs';
import WebSocket from 'ws';

const cfg = JSON.parse(fs.readFileSync(new URL('../bridge.config.json', import.meta.url), 'utf-8'));
const ws = new WebSocket('ws://127.0.0.1:' + (cfg.loopbackPort ?? cfg.port));

setTimeout(() => { console.error('auto-approve: timeout waiting approval'); process.exit(1); }, 60000);

ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: cfg.token, device: 'cli-auto' })));
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === 'approval_request') {
    console.log('auto-approve ->', msg.approval.id, '|', msg.approval.title);
    ws.send(JSON.stringify({ type: 'approval_result', approvalId: msg.approval.id, decision: 'approve', note: 'auto-test' }));
    setTimeout(() => process.exit(0), 500);
  }
});
ws.on('error', (e) => { console.error('ws error', e.message); process.exit(1); });
