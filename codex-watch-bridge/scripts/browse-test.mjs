// 浏览 _codex-watch._tcp 看本机能否发现广播
import bonjour from 'bonjour-service';
const browser = new bonjour();
console.log('browsing...');
const b = browser.find({ type: 'codex-watch' }, (svc) => {
  console.log('FOUND:', svc.name, svc.host, svc.port, JSON.stringify(svc.addresses));
  process.exit(0);
});
setTimeout(() => { console.log('not found in 8s'); process.exit(1); }, 8000);
