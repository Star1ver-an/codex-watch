// Self-signed certificate management for WSS. Cert persists across restarts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import selfsigned from 'selfsigned';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

export interface TlsCert {
  keyPem: string;
  certPem: string;
  fingerprint: string; // sha256 hex (uppercase) of DER
}

export function fingerprintOf(certPem: string): string {
  const x509 = new crypto.X509Certificate(certPem);
  return crypto.createHash('sha256').update(x509.raw).digest('hex').toUpperCase();
}

export async function ensureCertificate(): Promise<TlsCert> {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    const keyPem = fs.readFileSync(KEY_PATH, 'utf-8');
    const certPem = fs.readFileSync(CERT_PATH, 'utf-8');
    return { keyPem, certPem, fingerprint: fingerprintOf(certPem) };
  }
  const notAfter = new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'codex-watch-bridge' }],
    {
      keySize: 2048,
      notAfterDate: notAfter,
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'codex-watch-bridge.local' },
            { type: 2, value: 'localhost' },
          ],
        },
      ],
    }
  );
  fs.writeFileSync(KEY_PATH, pems.private, 'utf-8');
  fs.writeFileSync(CERT_PATH, pems.cert, 'utf-8');
  const cert: TlsCert = { keyPem: pems.private, certPem: pems.cert, fingerprint: fingerprintOf(pems.cert) };
  console.log(`[tls] new self-signed certificate generated (fingerprint ${cert.fingerprint})`);
  return cert;
}
