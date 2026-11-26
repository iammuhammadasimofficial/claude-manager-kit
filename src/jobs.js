// Headless lead jobs: start, reply, status, result, stop. Files live in ~/.claude-manager-kit/jobs/<job>/.
//   prompt.txt   the brief sent on stdin     status.txt   running | done | failed | stopped (+ timestamp)
//   session.txt  Claude session id           result.md    the last answer
//   history.md   every brief and result      err.log      stderr of the run
//   meta.json    lead, where it runs, model  pid.txt      runner process id
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { cmkRoot, claudeInvocation, spawnProc, isWin } from './platform.js';
import { findLead } from './config.js';
import { buildRemoteCommand, sshArgsFor, validTarget } from './machines.js';

export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\[\]-]{0,63}$/;
const JOB_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CLI_PATH = fileURLToPath(new URL('../bin/cli.js', import.meta.url));

export const jobsRoot = (env = process.env) => path.join(cmkRoot(env), 'jobs');
export const jobDir = (job, env = process.env) => path.join(jobsRoot(env), job);

export function validateJobName(job) {
  if (!JOB_RE.test(job || '')) throw new Error(`Bad job name "${job}". Use letters, digits, dot, dash or underscore (max 64).`);
  return job;
}

export function validateModel(model) {
  if (!MODEL_RE.test(model || '')) throw new Error(`Bad model "${model}". Use sonnet, opus, haiku or a full model id.`);
  return model;
}

const now = () => new Date().toISOString();
const read = (f, d = '') => { try { return fs.readFileSync(f, 'utf8'); } catch { return d; } };

/** Parse status.txt content: "<state> <iso time> [note]". */
export function parseStatus(text) {
  const t = String(text || '').trim();
  if (!t) return { state: 'unknown', at: null, note: '' };
  const [state, at, ...rest] = t.split(/\s+/);
  return { state, at: at || null, note: rest.join(' ') };
}

export function writeStatus(dir, state, note = '') {
  fs.writeFileSync(path.join(dir, 'status.txt'), `${state} ${now()}${note ? ' ' + note : ''}\n`, 'utf8');
}

export function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Status with a stale check: "running" whose runner process is gone is reported as failed. */
export function readJobStatus(job, env = process.env) {
  const dir = jobDir(job, env);
  const st = parseStatus(read(path.join(dir, 'status.txt')));
  if (st.state === 'running') {
    const pid = Number(read(path.join(dir, 'pid.txt')).trim()) || 0;
    if (pid && !isAlive(pid)) return { ...st, state: 'failed', note: 'runner process is gone (stale)' };
  }
  return st;
}

export function readMeta(job, env = process.env) {
  try { return JSON.parse(read(path.join(jobDir(job, env), 'meta.json'))); } catch { return null; }
}

export function listJobs(env = process.env) {
  let names = [];
  try { names = fs.readdirSync(jobsRoot(env), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
  return names.map((job) => {
    const meta = readMeta(job, env) || {};
    return { job, lead: meta.lead || '', model: meta.model || '', ...readJobStatus(job, env) };
  }).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** Arguments for `claude -p` (the brief goes on stdin, never here). */
export function buildClaudeArgs({ model, permissionMode = 'acceptEdits', resume = null }) {
  const args = ['-p', '--output-format', 'json', '--model', model, '--permission-mode', permissionMode];
  if (resume) args.push('--resume', resume);
  return args;
}

/** Extract the result object from `claude -p --output-format json` output. */
export function parseClaudeJson(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let o = tryParse(t);
  if (!o) {
    const lines = t.split(/\r?\n/).reverse();
    for (const l of lines) { o = tryParse(l.trim()); if (o) break; }
  }
  if (Array.isArray(o)) o = [...o].reverse().find((x) => x && x.type === 'result') || o[o.length - 1];
  return o && typeof o === 'object' ? o : null;
}

function execSpec(lead) {
  return lead.kind === 'account'
    ? { kind: 'account', configDir: lead.configDir }
    : { kind: 'machine', target: lead.target, shell: lead.shell || 'posix' };
}

/** Create the job folder and record the brief. Returns { dir, meta }. */
export function initJob({ cfg, home, lead: leadName, job, briefText, model, cwd, resume = false, env = process.env }) {
  validateJobName(job);
  validateModel(model);
  const lead = findLead(cfg, leadName);
  if (!lead) {
    const known = [...(cfg.accounts || []), ...(cfg.machines || [])].map((x) => x.name);
    throw new Error(known.length ? `Unknown lead "${leadName}". Known leads: ${known.join(', ')}.` : 'This setup has no leads (solo mode). Re-run setup to add accounts or machines.');
  }
  const dir = jobDir(job, env);
  const existing = fs.existsSync(path.join(dir, 'meta.json'));
  if (existing && !resume) throw new Error(`Job "${job}" already exists. Use "cmk lead reply ${job} <brief-file>" to continue it, or pick a new job name.`);
  fs.mkdirSync(dir, { recursive: true });
  let meta;
  if (resume) {
    meta = readMeta(job, env);
    if (!meta) throw new Error(`Job "${job}" does not exist.`);
    meta.model = model;
  } else {
    meta = { job, lead: lead.name, home, cwd: cwd || null, model, permissionMode: cfg.leads?.permissionMode || 'acceptEdits', exec: execSpec(lead), createdAt: now() };
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'prompt.txt'), briefText, 'utf8');
  fs.appendFileSync(path.join(dir, 'history.md'), `\n## ${now()} ${resume ? 'reply' : 'brief'}\n\n${briefText}\n`, 'utf8');
  writeStatus(dir, 'running');
  return { dir, meta };
}

/** Build the command that actually runs the job: { cmd, args, cwd, env, stdinFile }. */
export function buildExecution(meta, sessionId, env = process.env) {
  const args = buildClaudeArgs({ model: meta.model, permissionMode: meta.permissionMode, resume: sessionId || null });
  if (meta.exec.kind === 'machine') {
    if (!validTarget(meta.exec.target)) throw new Error(`Bad ssh target "${meta.exec.target}".`);
    const remote = buildRemoteCommand({ shell: meta.exec.shell, cwd: meta.cwd, args });
    return { cmd: 'ssh', args: sshArgsFor(meta.exec.target, remote), cwd: undefined, env };
  }
  const inv = claudeInvocation(env);
  if (!inv) throw new Error('claude CLI not found on PATH. Install Claude Code first (https://claude.com/claude-code).');
  return { cmd: inv.cmd, args: [...inv.prefix, ...args], cwd: meta.cwd || undefined, env: { ...env, CLAUDE_CONFIG_DIR: meta.exec.configDir } };
}

/** Runner: executes one job to completion and writes the result files. Used by `_run` and --wait. */
export async function runJob(job, env = process.env) {
  const dir = jobDir(job, env);
  const meta = readMeta(job, env);
  if (!meta) throw new Error(`Job "${job}" has no meta.json`);
  fs.writeFileSync(path.join(dir, 'pid.txt'), String(process.pid), 'utf8');
  const sessionId = read(path.join(dir, 'session.txt')).trim() || null;
  const prompt = read(path.join(dir, 'prompt.txt'));
  const errFd = fs.openSync(path.join(dir, 'err.log'), 'a');
  let exec;
  try { exec = buildExecution(meta, sessionId, env); } catch (e) {
    fs.writeSync(errFd, e.message + '\n'); fs.closeSync(errFd);
    writeStatus(dir, 'failed', e.message);
    return 'failed';
  }
  const out = await new Promise((resolve) => {
    let stdout = '';
    const child = spawnProc(exec.cmd, exec.args, { cwd: exec.cwd, env: exec.env, stdio: ['pipe', 'pipe', errFd] });
    child.on('error', (e) => { fs.writeSync(errFd, `spawn error: ${e.message}\n`); resolve({ code: -1, stdout }); });
    child.stdout.on('data', (d) => { stdout += d; });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    child.on('close', (code) => resolve({ code, stdout }));
  });
  fs.closeSync(errFd);
  if (readJobStatus(job, env).state === 'stopped') return 'stopped';
  const parsed = parseClaudeJson(out.stdout);
  fs.writeFileSync(path.join(dir, 'out.json'), out.stdout, 'utf8');
  const result = parsed && typeof parsed.result === 'string' ? parsed.result : (parsed ? JSON.stringify(parsed) : out.stdout);
  if (parsed?.session_id) fs.writeFileSync(path.join(dir, 'session.txt'), String(parsed.session_id), 'utf8');
  fs.writeFileSync(path.join(dir, 'result.md'), result + '\n', 'utf8');
  fs.appendFileSync(path.join(dir, 'history.md'), `\n## ${now()} result\n\n${result}\n`, 'utf8');
  const failed = out.code !== 0 || !parsed || parsed.is_error === true;
  writeStatus(dir, failed ? 'failed' : 'done', failed ? `exit ${out.code}` : '');
  return failed ? 'failed' : 'done';
}

/** Detach a runner process for the job (survives the terminal closing). */
export function spawnRunner(job, env = process.env) {
  const child = spawn(process.execPath, [CLI_PATH, '_run', job], { detached: true, stdio: 'ignore', windowsHide: true, env });
  child.on('error', () => {});
  child.unref();
  return child.pid;
}

export async function startJob(opts) {
  const env = opts.env || process.env;
  const { dir, meta } = initJob({ ...opts, env, resume: false });
  if (opts.wait) { const state = await runJob(meta.job, env); return { job: meta.job, dir, state }; }
  const pid = spawnRunner(meta.job, env);
  fs.writeFileSync(path.join(dir, 'pid.txt'), String(pid || ''), 'utf8');
  return { job: meta.job, dir, state: 'running', pid };
}

export async function replyJob(opts) {
  const env = opts.env || process.env;
  const meta0 = readMeta(opts.job, env);
  if (!meta0) throw new Error(`Job "${opts.job}" does not exist.`);
  if (readJobStatus(opts.job, env).state === 'running') throw new Error(`Job "${opts.job}" is still running. Wait for it to finish, or stop it first.`);
  const sid = read(path.join(jobDir(opts.job, env), 'session.txt')).trim();
  if (!sid) throw new Error(`Job "${opts.job}" has no session id yet (it may have failed before Claude started). Start a new job instead.`);
  const { dir, meta } = initJob({ ...opts, lead: meta0.lead, model: opts.model || meta0.model, cwd: meta0.cwd, env, resume: true });
  if (opts.wait) { const state = await runJob(meta.job, env); return { job: meta.job, dir, state }; }
  const pid = spawnRunner(meta.job, env);
  fs.writeFileSync(path.join(dir, 'pid.txt'), String(pid || ''), 'utf8');
  return { job: meta.job, dir, state: 'running', pid };
}

export function stopJob(job, env = process.env) {
  const dir = jobDir(job, env);
  if (!fs.existsSync(dir)) throw new Error(`Job "${job}" does not exist.`);
  const st = readJobStatus(job, env);
  if (st.state !== 'running') return { stopped: false, state: st.state };
  const pid = Number(read(path.join(dir, 'pid.txt')).trim()) || 0;
  writeStatus(dir, 'stopped', 'stopped by user');
  if (pid) {
    try {
      if (isWin()) spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
      else { try { process.kill(-pid, 'SIGTERM'); } catch { process.kill(pid, 'SIGTERM'); } }
    } catch { /* already gone */ }
  }
  return { stopped: true, state: 'stopped' };
}

export function jobResult(job, env = process.env) {
  const dir = jobDir(job, env);
  if (!fs.existsSync(dir)) throw new Error(`Job "${job}" does not exist.`);
  const text = read(path.join(dir, 'result.md'));
  const st = readJobStatus(job, env);
  return { state: st.state, text };
}

/** Last line starting with QUESTION: in a result, or null. */
export function extractQuestion(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => /^\s*QUESTION:/.test(l));
  return lines.length ? lines[lines.length - 1].trim() : null;
}
