import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let cachedCli: string | undefined;

async function exists(file: string): Promise<boolean> {
  try { await fs.promises.access(file, fs.constants.X_OK); return true; } catch { return false; }
}

async function findCodexCli(): Promise<string | undefined> {
  if (cachedCli && await exists(cachedCli)) return cachedCli;

  const configured = process.env.CODEX_CLI_PATH;
  if (configured && await exists(configured)) {
    cachedCli = configured;
    return cachedCli;
  }

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const binRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    try {
      const candidates: { file: string; mtime: number }[] = [];
      for (const entry of await fs.promises.readdir(binRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(binRoot, entry.name, 'codex.exe');
        const stat = await fs.promises.stat(file).catch(() => undefined);
        if (stat) candidates.push({ file, mtime: stat.mtimeMs });
      }
      const best = candidates.sort((a, b) => b.mtime - a.mtime)[0];
      if (best) {
        cachedCli = best.file;
        return cachedCli;
      }
    } catch {
      // Fall through to npm installation.
    }
  }

  const npmRoot = process.env.APPDATA;
  if (npmRoot) {
    const js = path.join(npmRoot, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (await exists(js)) {
      cachedCli = process.execPath;
      // Encode the JS path through environment rather than trying to synthesize argv.
      process.env.CODEX_CLI_JS = js;
      return cachedCli;
    }
  }

  return undefined;
}

export interface DispatchResult {
  ok: boolean;
  output: string;
}

export async function queueCodexMessage(threadId: string, message: string): Promise<DispatchResult> {
  const cli = await findCodexCli();
  if (!cli) return { ok: false, output: '未找到 Codex CLI' };

  const args = cli === process.execPath
    ? [process.env.CODEX_CLI_JS ?? '', 'queue', '--thread', threadId, '--message', message]
    : ['queue', '--thread', threadId, '--message', message];

  return new Promise((resolve) => {
    const child = spawn(cli, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, output: output.trim().slice(-2000) });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 20_000);

    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', (err) => { output += String(err); finish(false); });
    child.on('exit', (code) => finish(code === 0));
  });
}
