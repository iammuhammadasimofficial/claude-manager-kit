// Environment and setup checks. Used by the wizard (step 1) and by `cmk doctor`.
import { claudeInvocation, resolveCommand, run, desktopStatus } from './platform.js';
import { CATALOG, checkTool } from './tools.js';
import { leadsOf } from './config.js';
import { verifyAccount } from './accounts.js';
import { testMachine, explainMachineFailure, JOIN_COMMAND } from './machines.js';

export function claudeInstallHint(platform = process.platform) {
  const how = platform === 'win32' ? 'In PowerShell: irm https://claude.ai/install.ps1 | iex' : 'In a terminal: curl -fsSL https://claude.ai/install.sh | bash';
  return `Install Claude Code. ${how}   (or: npm install -g @anthropic-ai/claude-code). Then open a NEW terminal and re-run.`;
}

export function gitInstallHint(platform = process.platform) {
  if (platform === 'win32') return 'Install git: winget install Git.Git (or https://git-scm.com/downloads), then open a new terminal.';
  if (platform === 'darwin') return 'Install git: xcode-select --install (or brew install git).';
  return 'Install git with your package manager, for example: sudo apt install git';
}

export function parseNodeMajor(version = process.version) {
  const m = String(version).match(/^v?(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * Environment checks. Each: { id, label, ok, required, detail, hint }.
 * needSsh: only require ssh when machines are planned.
 */
export function checkEnvironment({ platform = process.platform, env = process.env, needSsh = false, nodeVersion = process.version, runner = run, has = (n) => resolveCommand(n, platform) } = {}) {
  const out = [];
  const major = parseNodeMajor(nodeVersion);
  out.push({ id: 'node', label: 'Node.js 18 or newer', ok: major >= 18, required: true, detail: nodeVersion, hint: major >= 18 ? '' : 'Install Node 18+ from https://nodejs.org and run this again.' });

  const inv = claudeInvocation(env, platform);
  if (inv) {
    const r = runner(inv.cmd, [...inv.prefix, '--version'], { timeout: 30000 });
    out.push({ id: 'claude', label: 'Claude Code CLI', ok: r.ok, required: true, detail: r.ok ? r.stdout.trim().split(/\r?\n/)[0] : 'found but did not run', hint: r.ok ? '' : 'Claude Code is on the PATH but did not run. Try: claude --version in this terminal, or reinstall it.' });
  } else {
    out.push({ id: 'claude', label: 'Claude Code CLI', ok: false, required: true, detail: 'not found on PATH', hint: claudeInstallHint(platform) });
  }

  const d = desktopStatus(platform, env);
  out.push({ id: 'desktop', label: 'Claude Desktop', ok: d.installed, required: false, detail: d.detail, hint: d.installed ? '' : (platform === 'linux' ? 'Recommended: Claude Desktop (Code tab) gives the manager sessions, scheduled tasks and connectors, but it does not exist on Linux. Terminal mode works with less: no scheduled tasks, no messaging other sessions. Run claude inside the home folder.' : 'Strongly recommended: install Claude Desktop from https://claude.com/download. The manager is built for its Code tab (long-lived session, other sessions, scheduled tasks, connectors). Terminal-only works with less.') });

  const git = has('git');
  out.push({ id: 'git', label: 'git', ok: !!git, required: true, detail: git ? 'found' : 'not found', hint: git ? '' : gitInstallHint(platform) });

  const gh = has('gh');
  out.push({ id: 'gh', label: 'GitHub CLI (gh)', ok: !!gh, required: false, detail: gh ? 'found' : 'not found', hint: gh ? '' : 'Optional. Needed only if you pick GitHub as your code tool: https://cli.github.com' });

  const ssh = has('ssh');
  out.push({ id: 'ssh', label: 'ssh', ok: !!ssh, required: needSsh, detail: ssh ? 'found' : 'not found', hint: ssh ? '' : (needSsh ? 'Install an OpenSSH client (Windows: Settings > Optional features > OpenSSH Client).' : 'Only needed for multi-machine setups.') });
  return out;
}

export function summariseChecks(checks) {
  const failedRequired = checks.filter((c) => c.required && !c.ok);
  return { ok: failedRequired.length === 0, failedRequired };
}

export function printChecks(ui, checks) {
  for (const c of checks) {
    const line = `${c.label}: ${c.detail}`;
    if (c.ok) ui.ok(line);
    else if (c.required) { ui.fail(line); if (c.hint) ui.hint(c.hint); }
    else { ui.warn(line); if (c.hint) ui.hint(c.hint); }
  }
}

/** Full doctor: environment, accounts, machines, tools. `offline` skips logins and ssh (dry run). */
export function runDoctor(cfg, { ui, offline = false, env = process.env } = {}) {
  const results = { environment: [], accounts: [], machines: [], tools: [] };
  const needSsh = (cfg.machines || []).length > 0;
  ui.heading('Environment');
  results.environment = checkEnvironment({ needSsh, env });
  printChecks(ui, results.environment);

  if ((cfg.accounts || []).length) {
    ui.heading('Lead accounts (this machine)');
    for (const a of cfg.accounts) {
      if (offline) { ui.warn(`${a.name}: not checked (dry run)`); results.accounts.push({ name: a.name, ok: null }); continue; }
      const v = verifyAccount(a.configDir, env);
      results.accounts.push({ name: a.name, ok: v.ok });
      if (v.ok) ui.ok(`${a.name}: logged in (${v.rows.map((r) => `${r.window} ${r.percent}%`).join(', ')})`);
      else { ui.fail(`${a.name}: not logged in`); ui.hint(`Run: claude with CLAUDE_CONFIG_DIR=${a.configDir}, then /login and /exit. Or re-run setup.`); }
    }
  }

  if ((cfg.machines || []).length) {
    ui.heading('Machines (ssh)');
    for (const m of cfg.machines) {
      if (offline) { ui.warn(`${m.name} (${m.target}): not checked (dry run)`); results.machines.push({ name: m.name, ok: null }); continue; }
      const t = testMachine(m.target);
      results.machines.push({ name: m.name, ok: t.ok });
      if (t.ok) ui.ok(`${m.name} (${m.target}): reachable, ${t.version}`);
      else { ui.fail(`${m.name} (${m.target}): ${t.reason}`); ui.hint(explainMachineFailure(t)); ui.hint(`On that machine run: ${JOIN_COMMAND}`); }
    }
  }

  const roles = Object.keys(CATALOG);
  const chosen = roles.flatMap((r) => (cfg.tools?.[r] || []).map((e) => ({ role: r, entry: e })));
  if (chosen.length) {
    ui.heading('Tools');
    for (const { role, entry } of chosen) {
      if (offline) { ui.warn(`${role}: ${entry.label} (not checked in a dry run)`); results.tools.push({ id: entry.id, ok: null }); continue; }
      const c = checkTool(entry);
      results.tools.push({ id: entry.id, ok: c.ok });
      if (c.ok === true) ui.ok(`${role}: ${entry.label}, ${c.detail}`);
      else if (c.ok === null) ui.warn(`${role}: ${entry.label}, ${c.detail}`);
      else { ui.fail(`${role}: ${entry.label}, ${c.detail}`); }
    }
  }
  return results;
}
