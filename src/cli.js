// Command line front end: argument parsing and the commands.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createUi, cmkRoot, claudeInvocation } from './platform.js';
import { findHome, loadConfig, validateConfig } from './config.js';
import { runDoctor, checkEnvironment, printChecks } from './checks.js';
import { collectUsage, usageTable, writeLimits } from './usage.js';
import { startJob, replyJob, listJobs, readJobStatus, readMeta, jobResult, stopJob, runJob, extractQuestion, jobDir, validateModel } from './jobs.js';
import { runWizard, treeLines } from './wizard.js';
import { verifyAccount, writeSettings, leadSettingsPatch } from './accounts.js';
import { DEFAULT_MODELS } from './config.js';

const VALUE_FLAGS = new Set(['home', 'model', 'cwd', 'name']);

export function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = (eq > 0 ? a.slice(2, eq) : a.slice(2));
      if (eq > 0) flags[key] = a.slice(eq + 1);
      else if (VALUE_FLAGS.has(key)) { flags[key] = argv[i + 1]; i += 1; } else flags[key] = true;
    } else if (a === '-y') flags.yes = true;
    else if (a === '-h') flags.help = true;
    else pos.push(a);
  }
  return { flags, pos };
}

export const HELP = `claude-manager-kit (cmk): a personal AI manager for Claude Code and Claude Desktop

Usage:
  npx claude-manager-kit [setup] [--home <path>] [--yes] [--dry-run]
  cmk doctor                         re-check environment, accounts, machines, tools
  cmk usage [--json]                 plan usage of every account and machine
  cmk lead start <lead> <job> <brief-file> [--model sonnet|opus|haiku] [--cwd <dir>] [--wait]
  cmk lead reply <job> <brief-file> [--model ...] [--wait]
  cmk lead status [job]              list jobs, or show one
  cmk lead result <job>              print the last answer
  cmk lead stop <job>                stop a running job
  cmk join [--name <name>] [--yes]   run on a remote machine to set up its lead
  cmk help | cmk --version

Global options:
  --home <path>   use this assistant home (default: found from the current folder or the remembered one)
  --yes, -y       accept defaults, no questions
  --dry-run       setup only: write into a temp folder, run no logins, ssh or clipboard
`;

function needHome(flags, ui) {
  const home = findHome({ flag: flags.home });
  if (!home) {
    ui.fail('No assistant home found. Run "npx claude-manager-kit setup" first, or pass --home <path>.');
    return null;
  }
  const cfg = loadConfig(home);
  if (!cfg) { ui.fail(`No manager-kit.json in ${home}. Run setup first, or pass --home <path>.`); return null; }
  const errs = validateConfig(cfg);
  if (errs.length) { ui.fail(`Config at ${home} is not valid: ${errs.join('; ')}`); return null; }
  return { home, cfg };
}

function readBrief(file, ui) {
  if (!file) { ui.fail('Missing brief file. Usage: cmk lead start <lead> <job> <brief-file>'); return null; }
  const full = path.resolve(file);
  if (!fs.existsSync(full)) { ui.fail(`Brief file not found: ${full}`); return null; }
  const text = fs.readFileSync(full, 'utf8');
  if (!text.trim()) { ui.fail(`Brief file is empty: ${full}`); return null; }
  return text;
}

async function cmdLead(pos, flags, ui) {
  const sub = pos[0];
  if (!sub) { ui.line(HELP); return 1; }
  if (sub === 'status') {
    if (pos[1]) {
      const job = pos[1];
      if (!fs.existsSync(jobDir(job))) { ui.fail(`Job "${job}" does not exist.`); return 1; }
      const st = readJobStatus(job);
      const meta = readMeta(job) || {};
      ui.line(`${job}: ${st.state}${st.note ? ' (' + st.note + ')' : ''}`);
      ui.line(`  lead: ${meta.lead || '?'}   model: ${meta.model || '?'}   cwd: ${meta.cwd || '(default)'}`);
      ui.line(`  updated: ${st.at || '?'}`);
      ui.line(`  files: ${jobDir(job)}`);
      return 0;
    }
    const jobs = listJobs();
    if (!jobs.length) { ui.line('No jobs yet.'); return 0; }
    const w = Math.max(3, ...jobs.map((j) => j.job.length));
    ui.line(`${'job'.padEnd(w)}  ${'lead'.padEnd(10)} ${'state'.padEnd(8)} ${'model'.padEnd(8)} updated`);
    for (const j of jobs) ui.line(`${j.job.padEnd(w)}  ${String(j.lead).padEnd(10)} ${j.state.padEnd(8)} ${String(j.model).padEnd(8)} ${j.at || ''}`);
    return 0;
  }
  if (sub === 'result') {
    if (!pos[1]) { ui.fail('Usage: cmk lead result <job>'); return 1; }
    const r = jobResult(pos[1]);
    if (r.state === 'running') ui.warn('Still running. The last answer so far (if any):');
    ui.line(r.text || '(no result yet)');
    const q = extractQuestion(r.text);
    if (q) ui.line(`\nThe lead has a question for you: ${q}`);
    return 0;
  }
  if (sub === 'stop') {
    if (!pos[1]) { ui.fail('Usage: cmk lead stop <job>'); return 1; }
    const r = stopJob(pos[1]);
    ui.line(r.stopped ? `Stopped ${pos[1]}.` : `Nothing to stop: ${pos[1]} is ${r.state}.`);
    return 0;
  }
  if (sub === 'start' || sub === 'reply') {
    const ctx = needHome(flags, ui);
    if (!ctx) return 1;
    const [lead, job, file] = sub === 'start' ? [pos[1], pos[2], pos[3]] : [null, pos[1], pos[2]];
    if (sub === 'start' && (!lead || !job)) { ui.fail('Usage: cmk lead start <lead> <job> <brief-file> [--model ...] [--cwd <dir>]'); return 1; }
    if (sub === 'reply' && !job) { ui.fail('Usage: cmk lead reply <job> <brief-file>'); return 1; }
    const briefText = readBrief(file, ui);
    if (briefText === null) return 1;
    const model = flags.model ? validateModel(flags.model) : (sub === 'start' ? ctx.cfg.models.lead : undefined);
    const cwd = flags.cwd ? path.resolve(flags.cwd) : null;
    if (sub === 'start' && !flags.model && ctx.cfg.models.lead === 'opus') ui.warn('Leads default to the lead model from the config.');
    if (ctx.cfg.leads.permissionMode === 'bypassPermissions') ui.warn('This lead runs with bypassPermissions (chosen in setup).');
    const r = sub === 'start'
      ? await startJob({ cfg: ctx.cfg, home: ctx.home, lead, job, briefText, model, cwd, wait: !!flags.wait })
      : await replyJob({ cfg: ctx.cfg, home: ctx.home, job, briefText, model, wait: !!flags.wait });
    if (flags.wait) {
      ui.line(`${r.job}: ${r.state}`);
      const res = jobResult(r.job);
      ui.line(res.text);
      return r.state === 'done' ? 0 : 1;
    }
    ui.ok(`${sub === 'start' ? 'Started' : 'Continued'} job ${r.job} (running in the background).`);
    ui.info(`Check: cmk lead status ${r.job}    Read: cmk lead result ${r.job}    Stop: cmk lead stop ${r.job}`);
    return 0;
  }
  ui.fail(`Unknown lead command "${sub}".`);
  ui.line(HELP);
  return 1;
}

async function cmdJoin(flags, ui, input) {
  ui.heading('Join: set up this machine as a lead');
  const checks = checkEnvironment({ needSsh: false });
  printChecks(ui, checks);
  if (!checks.find((c) => c.id === 'claude').ok) { ui.fail('Install Claude Code first, then run this again.'); return 1; }
  const v = verifyAccount(process.env.CLAUDE_CONFIG_DIR || '', process.env);
  const inv = claudeInvocation();
  if (!v.ok) {
    ui.fail('Claude is not logged in on this machine.');
    ui.hint(`Run: ${path.basename(inv.cmd)} then /login, then /exit. After that run this command again.`);
    return 1;
  }
  ui.ok(`Logged in (${v.rows.map((r) => `${r.window} ${r.percent}%`).join(', ')})`);
  const root = path.join(cmkRoot(), 'lead');
  fs.mkdirSync(root, { recursive: true });
  const name = flags.name || os.hostname();
  fs.writeFileSync(path.join(root, 'README.md'), `# Lead folder for ${name}\n\nThis machine runs headless jobs for a manager over SSH.\nJob files from the manager live in the manager's home, not here.\n`, 'utf8');
  if (!fs.existsSync(path.join(root, 'tasks.md'))) fs.writeFileSync(path.join(root, 'tasks.md'), `# Task log: ${name}\n\nOne line per task: date | job id | task | PR links | state\n`, 'utf8');
  ui.ok(`Lead folder: ${root}`);
  const cfgDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  if (flags.yes) {
    const file = writeSettings(cfgDir, leadSettingsPatch(DEFAULT_MODELS));
    ui.ok(`Lead settings merged into ${file} (subagent model, no AI attribution). Existing keys were kept.`);
  } else {
    ui.info(`To set the lead defaults (subagent model, no AI attribution), run: cmk join --yes   (merges into ${path.join(cfgDir, 'settings.json')}, keeps existing keys)`);
  }
  ui.line('');
  ui.line('Next, on the manager machine, add this machine to the setup:');
  ui.line(`  npx claude-manager-kit setup --home <your home>   (choose Multi-machine and give it user@${os.hostname()})`);
  return 0;
}

export async function main(argv = process.argv.slice(2), io = {}) {
  const ui = createUi(process.stdout, process.env);
  const { flags, pos } = parseArgs(argv);
  if (flags.version || flags.v) {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    ui.line(pkg.version);
    return 0;
  }
  let cmd = pos[0];
  if (flags.help || cmd === 'help') { ui.line(HELP); return 0; }
  if (!cmd) cmd = 'setup';
  const rest = pos.slice(1);
  try {
    switch (cmd) {
      case 'setup': {
        const r = await runWizard({ yes: !!flags.yes, dryRun: !!flags['dry-run'], home: flags.home, noOpen: !!flags['no-open'], input: io.input });
        if (r.tmpBase) {
          ui.heading('Dry run result (temporary folder)');
          ui.line(r.home);
          for (const l of treeLines(r.home)) ui.line('  ' + l);
          ui.line('');
          ui.line(`Account config dirs and job files for a dry run live under ${path.join(r.tmpBase, 'cmk-root')}. Delete ${r.tmpBase} when done.`);
        }
        return r.aborted ? 1 : 0;
      }
      case 'doctor': {
        const ctx = needHome(flags, ui);
        if (!ctx) return 1;
        const r = runDoctor(ctx.cfg, { ui });
        const bad = [...r.environment.filter((c) => c.required && !c.ok), ...r.accounts.filter((a) => a.ok === false), ...r.machines.filter((m) => m.ok === false)];
        ui.line('');
        ui.line(bad.length ? `${bad.length} problem(s) found.` : 'All checks passed.');
        return bad.length ? 1 : 0;
      }
      case 'usage': {
        const ctx = needHome(flags, ui);
        if (!ctx) return 1;
        const entries = collectUsage(ctx.cfg);
        const file = writeLimits(ctx.home, entries);
        if (flags.json) ui.line(JSON.stringify(entries, null, 2));
        else { ui.line(usageTable(entries)); ui.line(''); ui.info(`Saved ${file}`); }
        return 0;
      }
      case 'lead': return await cmdLead(rest, flags, ui);
      case 'join': return await cmdJoin(flags, ui, io.input);
      case '_run': {
        const state = await runJob(rest[0]);
        return state === 'done' ? 0 : 1;
      }
      default:
        ui.fail(`Unknown command "${cmd}".`);
        ui.line(HELP);
        return 1;
    }
  } catch (e) {
    ui.fail(e.message);
    if (process.env.CMK_DEBUG) ui.line(e.stack);
    return 1;
  }
}
