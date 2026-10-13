import dgram from 'node:dgram';
const s = dgram.createSocket('udp4');
s.bind(() => {
  s.broadcast = true;
  s.send('CODEX_WATCH_DISCOVER', 8788, '192.168.1.255');
});
s.on('message', (msg, rinfo) => {
  console.log('REPLY from', rinfo.address, ':', String(msg));
  s.close();
  process.exit(0);
});
setTimeout(() => { console.log('no reply'); process.exit(1); }, 3000);
