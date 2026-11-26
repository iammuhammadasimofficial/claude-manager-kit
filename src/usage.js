// Plan usage: parse `claude -p "/usage"` text, read it for every account and machine, write board/limits.json.
import fs from 'node:fs';
import path from 'node:path';
import { claudeInvocation, run } from './platform.js';
import { leadsOf } from './config.js';
import { sshBase } from './machines.js';

const LINE = /^\s*Current (session|week \(([^)]+)\)):\s*(\d+)%\s*used\s*\S*\s*resets\s+(.+?)\s*$/;

/** Parse usage text into rows: { window, percent, resets, timeZone }. */
export function parseUsage(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(LINE);
    if (!m) continue;
    const window = m[1] === 'session' ? '5-hour' : `weekly (${m[2]})`;
    let resets = m[4];
    let timeZone = null;
    const tz = resets.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (tz) { resets = tz[1]; timeZone = tz[2]; }
    rows.push({ window, percent: Number(m[3]), resets, timeZone });
  }
  return rows;
}

/** True when any row of the 5-hour window is at or above the threshold. */
export function shouldPause(rows, threshold = 85) {
  const s = rows.find((r) => r.window === '5-hour');
  return !!s && s.percent >= threshold;
}

/** Read usage for the main account (configDir null), an account dir, or a remote target. */
export function readUsage({ configDir = null, target = null, env = process.env } = {}) {
  if (target) {
    const r = run('ssh', [...sshBase(), target, 'claude -p /usage --output-format text'], { timeout: 60000 });
    const text = r.stdout || r.stderr;
    return { ok: r.ok && parseUsage(text).length > 0, text, rows: parseUsage(text), error: r.error };
  }
  const inv = claudeInvocation(env);
  if (!inv) return { ok: false, text: '', rows: [], error: 'claude CLI not found on PATH' };
  const e = { ...env };
  if (configDir) e.CLAUDE_CONFIG_DIR = configDir;
  const r = run(inv.cmd, [...inv.prefix, '-p', '/usage', '--output-format', 'text'], { env: e, timeout: 90000 });
  const rows = parseUsage(r.stdout);
  return { ok: r.ok && rows.length > 0, text: r.stdout || r.stderr, rows, error: r.error };
}

/** Usage for the main account plus every lead. */
export function collectUsage(cfg, env = process.env, reader = readUsage) {
  const out = [{ account: 'main', where: 'this machine', ...reader({ env }) }];
  for (const l of leadsOf(cfg)) {
    const res = l.kind === 'account' ? reader({ configDir: l.configDir, env }) : reader({ target: l.target, env });
    out.push({ account: l.name, where: l.kind === 'account' ? 'this machine' : l.target, ...res });
  }
  return out.map((x) => ({ account: x.account, where: x.where, ok: !!x.ok, rows: x.rows || [], error: x.ok ? null : (x.error || 'unavailable') }));
}

export function flattenLimits(entries, now = new Date()) {
  const checked = now.toISOString();
  const rows = [];
  for (const e of entries) {
    if (!e.rows.length) rows.push({ account: e.account, where: e.where, window: '5-hour', percent: null, resets: 'unavailable', checked });
    for (const r of e.rows) rows.push({ account: e.account, where: e.where, window: r.window, percent: r.percent, resets: r.resets + (r.timeZone ? ` (${r.timeZone})` : ''), checked });
  }
  return { rows };
}

export function writeLimits(home, entries) {
  const dir = path.join(home, 'board');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'limits.json');
  fs.writeFileSync(file, JSON.stringify(flattenLimits(entries), null, 2) + '\n', 'utf8');
  return file;
}

export function usageTable(entries) {
  const lines = [];
  const head = ['account', 'where', 'window', 'used', 'resets'];
  const body = [];
  for (const e of entries) {
    if (!e.rows.length) body.push([e.account, e.where, '-', 'unavailable', e.error || '']);
    for (const r of e.rows) body.push([e.account, e.where, r.window, `${r.percent}%`, r.resets + (r.timeZone ? ` (${r.timeZone})` : '')]);
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => String(b[i]).length)));
  const fmt = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  lines.push(fmt(head));
  lines.push(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const b of body) lines.push(fmt(b));
  return lines.join('\n');
}
