import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_PATH = path.join(__dirname, '..', 'bridge.config.json');

export interface BridgeConfig {
  loopbackPort: number;
  port: number;
  token: string;
  pin: string;
}

export function loadOrCreateConfig(): BridgeConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      if (typeof raw.port === 'number' && typeof raw.token === 'string' && raw.token.length > 0) {
        if (typeof raw.loopbackPort !== 'number') {
          raw.loopbackPort = 8789
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8')
        }
        if (typeof raw.pin !== 'string' || raw.pin.length === 0) {
          raw.pin = String(Math.floor(100000 + Math.random() * 900000));
          fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2), 'utf-8');
        }
        return raw as BridgeConfig;
      }
    } catch {
      // fall through and regenerate
    }
  }
  const cfg: BridgeConfig = {
    loopbackPort: 8789,
    port: 8787,
    token: crypto.randomBytes(24).toString('hex'),
    pin: String(Math.floor(100000 + Math.random() * 900000)),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  return cfg;
}

export function sessionsDir(): string {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  return path.join(home, '.codex', 'sessions');
}
