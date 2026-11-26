// Extra Claude accounts on this machine. Each has its own config dir; login is Claude's own flow.
// This module never reads or prints credential files.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cmkRoot, claudeInvocation, run, needsShell, winQuote } from './platform.js';
import { parseUsage } from './usage.js';

export function accountDir(name, env = process.env) {
  return path.join(cmkRoot(env), 'accounts', name);
}

export function ensureAccountDir(name, env = process.env) {
  const dir = accountDir(name, env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Hand the terminal to `claude` with CLAUDE_CONFIG_DIR set so the user can /login and /exit. */
export function loginAccount(configDir, env = process.env) {
  const inv = claudeInvocation(env);
  if (!inv) return { ok: false, error: 'claude CLI not found on PATH' };
  const e = { ...env, CLAUDE_CONFIG_DIR: configDir };
  const args = [...inv.prefix];
  const shell = needsShell(inv.cmd);
  const r = shell
    ? spawnSync([inv.cmd, ...args].map(winQuote).join(' '), { stdio: 'inherit', env: e, shell: true })
    : spawnSync(inv.cmd, args, { stdio: 'inherit', env: e });
  return { ok: !r.error, error: r.error ? r.error.message : null, status: r.status };
}

/** Verify a login by asking for plan usage, a local command that needs no model call. */
export function verifyAccount(configDir, env = process.env) {
  const inv = claudeInvocation(env);
  if (!inv) return { ok: false, rows: [], error: 'claude CLI not found on PATH' };
  const r = run(inv.cmd, [...inv.prefix, '-p', '/usage', '--output-format', 'text'], {
    env: { ...env, CLAUDE_CONFIG_DIR: configDir }, timeout: 90000,
  });
  const rows = parseUsage(r.stdout);
  return { ok: r.ok && rows.length > 0, rows, error: r.ok ? null : (r.stderr || r.error || 'not logged in').trim() };
}

/** Deep-ish merge: objects merge key by key, everything else is replaced. Never drops existing keys. */
export function mergeSettings(existing, patch) {
  const out = { ...(existing || {}) };
  for (const [k, v] of Object.entries(patch || {})) {
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = mergeSettings(cur, v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export const ATTRIBUTION_OFF = { includeCoAuthoredBy: false, attribution: { commit: '', pr: '' } };

export function leadSettingsPatch(models) {
  return { env: { CLAUDE_CODE_SUBAGENT_MODEL: models?.lead || 'sonnet' }, ...ATTRIBUTION_OFF };
}

export function managerSettingsPatch(models) {
  return { model: models?.manager || 'opus', ...ATTRIBUTION_OFF };
}

/** Merge `patch` into <dir>/settings.json (created when missing). Returns the written path. */
export function writeSettings(dir, patch) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');
  let existing = {};
  if (fs.existsSync(file)) {
    try { existing = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error(`${file} is not valid JSON; fix it and re-run.`); }
  }
  fs.writeFileSync(file, JSON.stringify(mergeSettings(existing, patch), null, 2) + '\n', 'utf8');
  return file;
}
