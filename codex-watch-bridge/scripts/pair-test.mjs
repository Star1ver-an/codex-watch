import fs from 'node:fs';
import WebSocket from 'ws';
const cfg = JSON.parse(fs.readFileSync(new URL('../bridge.config.json', import.meta.url), 'utf-8'));
const pin = process.argv[2];
const ws = new WebSocket('wss://127.0.0.1:' + cfg.port, { rejectUnauthorized: false });
setTimeout(() => { console.log('no response (timeout)'); process.exit(1); }, 6000);
ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', pin, device: 'watch5-pair' })));
ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  console.log('<<', msg.type, msg.token ? '(token received: ' + msg.token.slice(0, 8) + '...)' : (msg.message || ''));
  process.exit(msg.type === 'pair_ok' ? 0 : 1);
});
