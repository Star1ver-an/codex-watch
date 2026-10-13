import fs from 'node:fs';
import WebSocket from 'ws';
const cfg = JSON.parse(fs.readFileSync(new URL('../bridge.config.json', import.meta.url), 'utf-8'));
const ws = new WebSocket('ws://127.0.0.1:' + (cfg.loopbackPort ?? cfg.port));
setTimeout(() => { console.log('timeout'); process.exit(1); }, 8000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', token: cfg.token, device: 'diag' })));
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  if (msg.type === 'snapshot') {
    for (const t of msg.threads) {
      if (t.pendingApprovals.length > 0) {
        console.log('THREAD:', t.id, '|', t.title.slice(0, 30), '| approvals:', JSON.stringify(t.pendingApprovals.map(a => ({ id: a.id, title: a.title, src: a.source }))));
      }
    }
    console.log('done');
    process.exit(0);
  }
});
