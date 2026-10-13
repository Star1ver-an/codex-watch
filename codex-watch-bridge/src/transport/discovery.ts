// Advertises the bridge on the LAN via mDNS/Bonjour + UDP broadcast discovery.
import bonjour from 'bonjour-service';
import dgram from 'node:dgram';

let instance: import('bonjour-service').Bonjour | null = null;
let udp: dgram.Socket | null = null;

export function startDiscovery(port: number): void {
  try {
    instance = new bonjour();
    instance.publish({
      name: 'Codex Watch Bridge',
      type: 'codex-watch',
      port,
    });
    console.log(`[discovery] advertising _codex-watch._tcp on port ${port}`);
  } catch (err) {
    console.error('[discovery] failed to advertise:', err);
  }

  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', (err) => console.error('[discovery] udp error:', err.message));
  udp.on('message', (msg, rinfo) => {
    if (msg.toString() === 'CODEX_WATCH_DISCOVER') {
      udp!.send(`CODEX_WATCH_HERE:${port}`, rinfo.port, rinfo.address);
    }
  });
  udp.bind(8788, () => {
    udp!.setBroadcast(true);
    console.log('[discovery] udp discovery listening on 8788');
  });
}

export function stopDiscovery(): void {
  try {
    udp?.close();
    udp = null;
    instance?.unpublishAll(() => instance?.destroy());
    instance = null;
  } catch {
    // ignore
  }
}
