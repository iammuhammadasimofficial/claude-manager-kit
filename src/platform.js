// Platform helpers: paths, command resolution, spawning, clipboard, Claude Desktop, terminal symbols.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';

export const isWin = (platform = process.platform) => platform === 'win32';

/** path module for a platform (lets tests check win32 and posix behaviour on any OS). */
export function pathFor(platform = process.platform) {
  return isWin(platform) ? path.win32 : path.posix;
}

/** Where the tool keeps non-portable state (account config dirs, jobs). Never inside the assistant home. */
export function cmkRoot(env = process.env, home = os.homedir(), platform = process.platform) {
  if (env.CMK_ROOT) return env.CMK_ROOT;
  return pathFor(platform).join(home, '.claude-manager-kit');
}

export function expandHome(p, home = os.homedir(), platform = process.platform) {
  if (typeof p !== 'string') return p;
  const pp = pathFor(platform);
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return pp.join(home, p.slice(2));
  return p;
}

/** Pick the best candidate from `where` output on Windows (prefer .exe, then .cmd, .bat). */
export function pickWindowsCandidate(lines) {
  const list = lines.map((l) => l.trim()).filter(Boolean);
  for (const ext of ['.exe', '.cmd', '.bat']) {
    const hit = list.find((l) => l.toLowerCase().endsWith(ext));
    if (hit) return hit;
  }
  return list[0] || null;
}

/** Find an executable on PATH without a shell. Returns an absolute path or null. */
export function resolveCommand(name, platform = process.platform) {
  const finder = isWin(platform) ? 'where' : 'which';
  try {
    const r = spawnSync(finder, [name], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0 || !r.stdout) return null;
    const lines = r.stdout.split(/\r?\n/);
    return isWin(platform) ? pickWindowsCandidate(lines) : lines.find((l) => l.trim()) || null;
  } catch {
    return null;
  }
}

/** .cmd and .bat files cannot be spawned without a shell on Windows. */
export function needsShell(cmd, platform = process.platform) {
  return isWin(platform) && /\.(cmd|bat)$/i.test(cmd);
}

/** Quote one argument for cmd.exe. Only used for .cmd shims with simple arguments. */
export function winQuote(arg) {
  const s = String(arg);
  if (/^[\w@+=:,./\\-]+$/.test(s)) return s;
  return '"' + s.replace(/"/g, '""') + '"';
}

/** Quote one argument for a POSIX shell (used for remote commands). */
export function posixQuote(arg) {
  const s = String(arg);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function prepare(cmd, args, platform = process.platform) {
  if (needsShell(cmd, platform)) {
    return { file: [cmd, ...args].map(winQuote).join(' '), args: [], shell: true };
  }
  return { file: cmd, args, shell: false };
}

/** Synchronous run, no shell unless a Windows .cmd shim forces it. Never throws. */
export function run(cmd, args = [], opts = {}) {
  const p = prepare(cmd, args);
  const r = spawnSync(p.file, p.args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: p.shell,
    timeout: opts.timeout ?? 60000,
    input: opts.input,
    cwd: opts.cwd,
    env: opts.env || process.env,
    stdio: opts.stdio,
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error ? r.error.message : null,
    ok: r.status === 0 && !r.error,
  };
}

/** Async spawn with the same shell rules. Returns the ChildProcess. */
export function spawnProc(cmd, args = [], opts = {}) {
  const p = prepare(cmd, args);
  return spawn(p.file, p.args, { windowsHide: true, shell: p.shell, ...opts });
}

/**
 * How to invoke Claude Code. CMK_CLAUDE_BIN (and optional CMK_CLAUDE_BIN_ARGS, a JSON array of leading
 * arguments) override the lookup. This is used by the tests and by people with unusual installs.
 */
export function claudeInvocation(env = process.env, platform = process.platform) {
  if (env.CMK_CLAUDE_BIN) {
    let prefix = [];
    try { prefix = JSON.parse(env.CMK_CLAUDE_BIN_ARGS || '[]'); } catch { prefix = []; }
    return { cmd: env.CMK_CLAUDE_BIN, prefix };
  }
  const cmd = resolveCommand('claude', platform);
  return cmd ? { cmd, prefix: [] } : null;
}

/** Clipboard command for a platform; `has(name)` says whether a binary exists. */
export function clipboardCommand(platform = process.platform, has = (n) => !!resolveCommand(n, platform)) {
  if (platform === 'win32') return { cmd: 'clip', args: [] };
  if (platform === 'darwin') return { cmd: 'pbcopy', args: [] };
  if (has('wl-copy')) return { cmd: 'wl-copy', args: [] };
  if (has('xclip')) return { cmd: 'xclip', args: ['-selection', 'clipboard'] };
  if (has('xsel')) return { cmd: 'xsel', args: ['--clipboard', '--input'] };
  return null;
}

export function copyToClipboard(text, platform = process.platform) {
  const c = clipboardCommand(platform);
  if (!c) return false;
  const r = run(c.cmd, c.args, { input: text, timeout: 10000 });
  return r.ok;
}

/** Detect Claude Desktop. Returns { installed, detail }. */
export function desktopStatus(platform = process.platform, env = process.env, fsx = fs) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || '';
    const appdata = env.APPDATA || '';
    const probes = [path.win32.join(local, 'AnthropicClaude'), path.win32.join(local, 'Programs', 'Claude')];
    for (const p of probes) if (local && fsx.existsSync(p)) return { installed: true, detail: p };
    try {
      const pk = path.win32.join(local, 'Packages');
      const hit = fsx.readdirSync(pk).find((n) => /^(Claude|AnthropicPBC\.Claude)/i.test(n));
      if (hit) return { installed: true, detail: path.win32.join(pk, hit) };
    } catch { /* ignore */ }
    try {
      const sm = path.win32.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
      const hit = fsx.readdirSync(sm).find((n) => /^Claude.*\.lnk$/i.test(n));
      if (hit) return { installed: true, detail: path.win32.join(sm, hit) };
    } catch { /* ignore */ }
    return { installed: false, detail: 'not found' };
  }
  if (platform === 'darwin') {
    const p = '/Applications/Claude.app';
    return fsx.existsSync(p) ? { installed: true, detail: p } : { installed: false, detail: 'not found' };
  }
  return { installed: false, detail: 'not available on Linux (terminal mode)' };
}

/** Try to open Claude Desktop. Returns true when a launch command was started. */
export function openDesktop(platform = process.platform) {
  try {
    if (platform === 'win32') {
      const c = spawn('cmd.exe', ['/d', '/s', '/c', 'start "" "claude://"'], {
        windowsVerbatimArguments: true, stdio: 'ignore', detached: true, windowsHide: true,
      });
      c.on('error', () => {});
      c.unref();
      return true;
    }
    if (platform === 'darwin') {
      const c = spawn('open', ['-a', 'Claude'], { stdio: 'ignore', detached: true });
      c.on('error', () => {});
      c.unref();
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

export function detectTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** Terminal symbols with a plain ASCII fallback. */
export function symbols(env = process.env, isTTY = process.stdout.isTTY) {
  const ascii = env.CMK_ASCII === '1' || env.TERM === 'dumb' || !isTTY;
  return ascii
    ? { ok: '[ok]', fail: '[x]', warn: '[!]', arrow: '->', bullet: '-' }
    : { ok: '✓', fail: '✗', warn: '!', arrow: '→', bullet: '•' };
}

export function createUi(out = process.stdout, env = process.env) {
  const sym = symbols(env, out.isTTY);
  const w = (s = '') => out.write(s + '\n');
  return {
    sym,
    line: w,
    heading: (s) => { w(''); w(s); w('-'.repeat(Math.min(Math.max(s.length, 3), 72))); },
    ok: (s) => w(`  ${sym.ok} ${s}`),
    fail: (s) => w(`  ${sym.fail} ${s}`),
    warn: (s) => w(`  ${sym.warn} ${s}`),
    info: (s) => w(`    ${s}`),
    hint: (s) => w(`      ${sym.arrow} ${s}`),
  };
}

export const homedir = () => os.homedir();
