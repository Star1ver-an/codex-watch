import https from 'node:https';
import { loadOrCreateConfig, CONFIG_PATH } from './config.js';
import { StateStore } from './core/state-store.js';
import { RolloutTail } from './collectors/rollout-tail.js';
import { SqlitePoller } from './collectors/sqlite-poller.js';
import { WsServer } from './transport/ws-server.js';
import { startDiscovery, stopDiscovery } from './transport/discovery.js';
import { ensureCertificate } from './transport/tls.js';

function parseArgs(): { port?: number; demo: boolean } {
  const args = process.argv.slice(2);
  let port: number | undefined;
  let demo = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[i + 1], 10);
    if (args[i] === '--demo') demo = true;
  }
  return { port, demo };
}

async function main() {
  const { port: portArg, demo } = parseArgs();
  const cfg = loadOrCreateConfig();
  const port = portArg ?? cfg.port;

  const cert = await ensureCertificate();

  console.log('=== Codex Watch Bridge (M5) ===');
  console.log(`config : ${CONFIG_PATH}`);
  console.log(`listen : wss://0.0.0.0:${port}  (TLS, self-signed)`);
  console.log(`local  : ws://127.0.0.1:${cfg.loopbackPort}  (loopback tools only)`);
  console.log(`token  : ${cfg.token}`);
  console.log(`pair PIN: ${cfg.pin}  (watch pairing)`);
  console.log(`cert fp: ${cert.fingerprint}`);
  if (demo) console.log('demo   : a fake approval will be injected ~8s after start');

  const store = new StateStore();
  const tail = new RolloutTail(store);
  const poller = new SqlitePoller(store);
  const wsTls = new WsServer(store, cfg.token, cfg.pin, cert.fingerprint);
  const wsLoop = new WsServer(store, cfg.token, cfg.pin, cert.fingerprint);

  await tail.start();
  poller.start();

  const httpsServer = https.createServer({ key: cert.keyPem, cert: cert.certPem });
  httpsServer.on('tlsClientError', (err) => console.error('[tls] client handshake error:', err.message));
  httpsServer.on('error', (err) => console.error('[https] server error:', err.message));
  process.on('uncaughtException', (err) => console.error('[uncaught]', err.message));
  process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', String(err)));
  await new Promise<void>((resolve) => httpsServer.listen(port, () => resolve()));
  await wsTls.start({ server: httpsServer, label: 'wss-lan' });
  startDiscovery(port);
  await wsLoop.start({ port: cfg.loopbackPort, label: 'ws-loopback' });

  if (demo) {
    setTimeout(() => {
      const approval = store.injectDemoApproval();
      console.log(`[demo] injected approval: ${approval?.id}`);
    }, 8000);
  }

  const shutdown = () => {
    console.log('\nshutting down...');
    wsTls.stop();
    wsLoop.stop();
    stopDiscovery();
    poller.stop();
    tail.stop();
    store.dispose();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
