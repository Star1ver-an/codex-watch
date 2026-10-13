import fs from 'node:fs';
import WebSocket from 'ws';
const cfg = JSON.parse(fs.readFileSync(new URL('../bridge.config.json', import.meta.url), 'utf-8'));
const ws = new WebSocket('ws://127.0.0.1:' + (cfg.loopbackPort ?? cfg.port));
setTimeout(() => { console.log('timeout'); process.exit(0); }, 8000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: cfg.token, device: 'diag' })));
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === 'snapshot') {
    for (const t of msg.threads) {
      for (const a of t.pendingApprovals) {
        console.log('approving', a.id, a.title);
        ws.send(JSON.stringify({ type: 'approval_result', approvalId: a.id, decision: 'approve' }));
      }
    }
    setTimeout(() => process.exit(0), 800);
  }
});
