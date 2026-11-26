// The interactive setup wizard.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import {
  createUi, detectTimeZone, copyToClipboard, openDesktop, clipboardCommand, cmkRoot,
} from './platform.js';
import {
  ASSISTANT_NAMES, ACCOUNT_NAMES, MACHINE_NAMES, pickName, pickNames, sanitizeName, uniqueName,
} from './names.js';
import {
  buildConfig, loadConfig, rememberHome, AUTONOMY_AREAS, AUTONOMY_MODES, ALWAYS_ASK, DEFAULT_MODELS, DEFAULT_SCHEDULES, leadsOf,
} from './config.js';
import { checkEnvironment, summariseChecks, printChecks, runDoctor } from './checks.js';
import { ensureAccountDir, loginAccount, verifyAccount, writeSettings, leadSettingsPatch } from './accounts.js';
import { testMachine, explainMachineFailure, JOIN_COMMAND } from './machines.js';
import { ROLES, ROLE_LABELS, optionsFor, toConfigEntry, connectionNotes, addMcp, checkTool, findTool } from './tools.js';
import { renderAll, writeHome, setupExplain } from './templates.js';

/** Line-based prompter. With yes=true every question returns its default and nothing is read. */
export function createPrompter({ input = process.stdin, output = process.stdout, yes = false } = {}) {
  let rl = null;
  let it = null;
  const ensure = () => {
    if (!rl) {
      rl = readline.createInterface({ input, terminal: false });
      it = rl[Symbol.asyncIterator]();
    }
  };
  const readLine = async () => {
    ensure();
    const { value, done } = await it.next();
    return done ? null : String(value);
  };
  const ask = async (question, def = '') => {
    if (yes) { output.write(`  ${question} [${def}] -> ${def || '(blank)'}\n`); return def; }
    output.write(`  ${question}${def !== '' ? ` [${def}]` : ''}: `);
    const line = await readLine();
    if (line === null) { output.write('\n'); return def; }
    const t = line.trim();
    return t === '' ? def : t;
  };
  const confirm = async (question, defYes = true) => {
    if (yes) { output.write(`  ${question} [${defYes ? 'Y/n' : 'y/N'}] -> ${defYes ? 'yes' : 'no'}\n`); return defYes; }
    for (;;) {
      output.write(`  ${question} [${defYes ? 'Y/n' : 'y/N'}]: `);
      const line = await readLine();
      if (line === null) { output.write('\n'); return defYes; }
      const t = line.trim().toLowerCase();
      if (t === '') return defYes;
      if (['y', 'yes'].includes(t)) return true;
      if (['n', 'no'].includes(t)) return false;
      output.write('    Please answer y or n.\n');
    }
  };
  /** options: [{ value, label, hint? }]; defIndex is 0-based. */
  const choose = async (question, options, defIndex = 0) => {
    output.write(`  ${question}\n`);
    options.forEach((o, i) => output.write(`    ${i + 1}) ${o.label}${o.hint ? '  - ' + o.hint : ''}\n`));
    if (yes) { output.write(`    -> ${options[defIndex].label}\n`); return options[defIndex].value; }
    for (;;) {
      output.write(`  Choose 1-${options.length} [${defIndex + 1}]: `);
      const line = await readLine();
      if (line === null) { output.write('\n'); return options[defIndex].value; }
      const t = line.trim();
      if (t === '') return options[defIndex].value;
      const n = Number(t);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1].value;
      output.write('    Please type one of the numbers.\n');
    }
  };
  /** Pick several by comma separated numbers; blank = defaults (0-based indexes). */
  const multi = async (question, options, defIndexes = []) => {
    output.write(`  ${question}\n`);
    options.forEach((o, i) => output.write(`    ${i + 1}) ${o.label}\n`));
    const defText = defIndexes.map((i) => i + 1).join(',');
    if (yes) { output.write(`    -> ${defIndexes.map((i) => options[i].label).join(', ') || 'none'}\n`); return defIndexes.map((i) => options[i].value); }
    for (;;) {
      output.write(`  Numbers separated by commas, or blank for ${defText ? defText : 'none'}: `);
      const line = await readLine();
      if (line === null) { output.write('\n'); return defIndexes.map((i) => options[i].value); }
      const t = line.trim();
      if (t === '') return defIndexes.map((i) => options[i].value);
      if (t.toLowerCase() === 'none') return [];
      const nums = t.split(/[,\s]+/).filter(Boolean).map(Number);
      if (nums.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length)) return [...new Set(nums)].map((n) => options[n - 1].value);
      output.write('    Please type numbers from the list, like 1,3.\n');
    }
  };
  const close = () => { if (rl) rl.close(); };
  return { ask, confirm, choose, multi, close };
}

/** Print a folder tree (names only). */
export function treeLines(dir, prefix = '') {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
  entries.forEach((e, i) => {
    const last = i === entries.length - 1;
    out.push(`${prefix}${last ? '`-- ' : '|-- '}${e.name}${e.isDirectory() ? '/' : ''}`);
    if (e.isDirectory()) out.push(...treeLines(path.join(dir, e.name), prefix + (last ? '    ' : '|   ')));
  });
  return out;
}

const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);

export async function runWizard(opts = {}) {
  const output = opts.output || process.stdout;
  const env = opts.env || process.env;
  const yes = !!opts.yes;
  const dryRun = !!opts.dryRun;
  const ui = createUi(output, env);
  const p = createPrompter({ input: opts.input, output, yes });
  const platform = process.platform;
  const savedRoot = process.env.CMK_ROOT;
  let tmpBase = null;

  try {
    ui.line('');
    ui.line('claude-manager-kit setup');
    ui.line('A personal manager for Claude Code and Claude Desktop.');
    if (dryRun) {
      tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cmk-dry-'));
      process.env.CMK_ROOT = path.join(tmpBase, 'cmk-root');
      ui.warn(`Dry run: everything is written under ${tmpBase}. No logins, no ssh, no clipboard.`);
    }

    // Existing config (re-run or move to a new machine)
    const homeArg = opts.home ? path.resolve(opts.home) : null;
    const existing = homeArg && !dryRun ? loadConfig(homeArg) : null;
    if (existing) ui.ok(`Found an existing setup at ${homeArg}. Learned files are kept; accounts, machines and tools are re-checked.`);

    // 1. Environment
    ui.heading('1. Environment check');
    let checks = checkEnvironment({ env });
    printChecks(ui, checks);
    const sum = summariseChecks(checks);
    if (!sum.ok && !dryRun) {
      ui.line('');
      ui.fail('Fix the required items above, then run setup again. Nothing was written.');
      p.close();
      return { aborted: true, reason: 'environment' };
    }
    if (!sum.ok) ui.warn('Required items are missing; continuing because this is a dry run.');

    // 2. About you
    ui.heading('2. About you');
    const prev = existing?.profile || {};
    const osName = (() => { try { return os.userInfo().username; } catch { return ''; } })();
    const name = await p.ask('Your name', prev.name || osName || 'there');
    const role = await p.ask('Your role (for example "founder", "engineering lead")', prev.role || '');
    const companyType = await p.ask('Company type, free text (stored locally only)', prev.companyType || '');
    const timeZone = await p.ask('Time zone', prev.timeZone || detectTimeZone());
    const workingHours = await p.ask('Working hours', prev.workingHours || '09:00-18:00');
    const languages = csv(await p.ask('Languages you write in (comma separated)', (prev.languages || ['English']).join(', ')));

    // 3. Assistant name and home
    ui.heading('3. Your assistant');
    const assistantName = sanitizeName(await p.ask('Name your assistant', existing?.assistant?.name || pickName(ASSISTANT_NAMES))) || 'Atlas';
    const defaultHome = homeArg || path.join(os.homedir(), assistantName);
    let home = homeArg || path.resolve(await p.ask('Home folder (everything it learns lives here)', defaultHome));
    if (dryRun) home = path.join(tmpBase, assistantName);

    // 4. Setup type
    ui.heading('4. Setup type');
    ui.info('Solo: one Claude account on this machine. The manager does everything with subagents.');
    ui.info('Multi-account: extra Claude accounts on THIS machine, each with its own login, run headless "lead" jobs.');
    ui.info('Multi-machine: other computers reachable over SSH run the leads.');
    ui.info('Mixed: both. The terminal and Desktop session uses your main account; leads use the extra ones.');
    const prevType = existing?.setup?.type || 'solo';
    const typeIdx = ['solo', 'multi-account', 'multi-machine', 'mixed'].indexOf(prevType);
    const type = await p.choose('Which setup?', [
      { value: 'solo', label: 'Solo' },
      { value: 'multi-account', label: 'Multi-account' },
      { value: 'multi-machine', label: 'Multi-machine' },
      { value: 'mixed', label: 'Mixed (accounts and machines)' },
    ], Math.max(typeIdx, 0));

    const wantAccounts = type === 'multi-account' || type === 'mixed';
    const wantMachines = type === 'multi-machine' || type === 'mixed';
    if (wantMachines) {
      checks = checkEnvironment({ env, needSsh: true });
      const ssh = checks.find((c) => c.id === 'ssh');
      if (!ssh.ok) { ui.warn('ssh was not found on this machine.'); ui.hint(ssh.hint); }
    }

    // Accounts
    const accounts = [];
    if (wantAccounts) {
      ui.heading('Extra accounts on this machine');
      const prevAcc = existing?.accounts || [];
      const countStr = await p.ask('How many extra Claude accounts?', String(prevAcc.length || 1));
      const count = Math.min(Math.max(parseInt(countStr, 10) || 1, 1), 6);
      const defaults = pickNames(ACCOUNT_NAMES, count);
      for (let i = 0; i < count; i += 1) {
        const nm = uniqueName(sanitizeName(await p.ask(`Name for account ${i + 1}`, prevAcc[i]?.name || defaults[i])) || defaults[i], accounts.map((a) => a.name));
        const dir = ensureAccountDir(nm);
        writeSettings(dir, leadSettingsPatch(DEFAULT_MODELS));
        let loggedIn = false;
        if (dryRun) {
          ui.warn(`${nm}: login skipped (dry run). Config dir: ${dir}`);
        } else {
          const already = verifyAccount(dir, env);
          if (already.ok) { loggedIn = true; ui.ok(`${nm}: already logged in`); } else {
            ui.info(`${nm} needs its own Claude login. Claude will open in this terminal with its own config folder.`);
            ui.info('Type /login, finish sign-in in the browser with the account you want for this lead, then type /exit.');
            for (let attempt = 0; attempt < 3 && !loggedIn; attempt += 1) {
              if (!(await p.confirm(`Open Claude to sign in ${nm} now?`, true))) break;
              loginAccount(dir, env);
              const v = verifyAccount(dir, env);
              loggedIn = v.ok;
              if (v.ok) ui.ok(`${nm}: logged in (${v.rows.map((r) => `${r.window} ${r.percent}%`).join(', ')})`);
              else { ui.fail(`${nm}: could not verify the login`); ui.hint(v.error || 'Run /login inside Claude, then /exit.'); }
            }
          }
          writeSettings(dir, leadSettingsPatch(DEFAULT_MODELS));
        }
        accounts.push({ name: nm, configDir: dir, loggedIn });
      }
    }

    // Machines
    const machines = [];
    if (wantMachines) {
      ui.heading('Other machines (ssh)');
      const prevMac = existing?.machines || [];
      const countStr = await p.ask('How many other machines?', String(prevMac.length || 1));
      const count = Math.min(Math.max(parseInt(countStr, 10) || 1, 1), 6);
      const defaults = pickNames(MACHINE_NAMES, count);
      for (let i = 0; i < count; i += 1) {
        const nm = uniqueName(sanitizeName(await p.ask(`Name for machine ${i + 1}`, prevMac[i]?.name || defaults[i])) || defaults[i], [...accounts, ...machines].map((a) => a.name));
        const target = await p.ask(`SSH target for ${nm} (user@host)`, prevMac[i]?.target || (yes ? 'user@host.example' : ''));
        let verified = false;
        let shell = 'posix';
        if (dryRun) ui.warn(`${nm}: ssh test skipped (dry run)`);
        else if (!target) ui.warn(`${nm}: no target given, skipped`);
        else {
          const t = testMachine(target);
          if (t.ok) { verified = true; shell = t.shell; ui.ok(`${nm}: reachable, ${t.version}`); } else {
            ui.fail(`${nm}: ${t.reason}`);
            ui.hint(explainMachineFailure(t));
            ui.hint(`Then, on that machine, run: ${JOIN_COMMAND}`);
          }
        }
        if (target) machines.push({ name: nm, target, shell, verified });
      }
    }

    // 5. Tools
    ui.heading('5. Tools');
    ui.info('Pick what you use. "none" is fine. Connectors are enabled in the Claude web settings; local tools are checked here.');
    const tools = { chat: [], mail: [], tasks: [], code: [], calendar: [], meetings: null };
    const hasGh = checks.find((c) => c.id === 'gh')?.ok;
    for (const role of ROLES) {
      const opts2 = optionsFor(role).map((t) => ({ value: t.id, label: t.label }));
      opts2.push({ value: 'other', label: 'Other (type it)' });
      const prevIds = (existing?.tools?.[role] || []).map((e) => e.id);
      const defIdx = prevIds.length ? opts2.map((o, i) => (prevIds.includes(o.value) ? i : -1)).filter((i) => i >= 0) : (role === 'code' && hasGh ? [0] : []);
      const picked = await p.multi(`${ROLE_LABELS[role]}:`, opts2, defIdx);
      for (const id of picked) {
        if (id === 'other') {
          const label = await p.ask(`Name of the other ${ROLE_LABELS[role].toLowerCase()} tool`, 'other');
          tools[role].push(toConfigEntry(role, `other:${label}`));
        } else tools[role].push(toConfigEntry(role, id));
      }
    }
    const meetPath = await p.ask('Folder where meeting transcripts land (blank for none)', existing?.tools?.meetings?.path || '');
    tools.meetings = meetPath ? { path: meetPath } : null;

    for (const role of ROLES) {
      for (const entry of tools[role]) {
        ui.line(`  ${ROLE_LABELS[role]}: ${entry.label} (${entry.kind === 'connector' ? 'connector, to verify' : entry.kind})`);
        for (const s of connectionNotes(entry)) ui.hint(s);
        const t = findTool(role, entry.id);
        if (dryRun || !t) continue;
        if (t.kind === 'mcp') {
          let c = checkTool(entry);
          if (!c.ok && (await p.confirm(`Add the ${t.label} server to Claude Code now?`, true))) {
            const r = addMcp(entry);
            c = checkTool(entry);
            if (r.ok) ui.ok(`${t.label}: added`); else { ui.fail(`${t.label}: could not add`); ui.hint(r.detail.slice(0, 200)); }
          }
          entry.status = c.ok ? 'connected' : 'pending';
        } else if (t.kind === 'cli') {
          const c = checkTool(entry);
          entry.status = c.ok ? 'connected' : 'pending';
          (c.ok ? ui.ok : ui.warn)(`${t.label}: ${c.detail}`);
        }
      }
    }

    // 6. Autonomy
    ui.heading('6. Autonomy');
    ui.info('Always asked first, in every mode: ' + ALWAYS_ASK.join('; ') + '.');
    const modeOpts = [
      { value: 'propose', label: 'Propose only (it says what it would do and waits)' },
      { value: 'reply', label: 'Reply when the context is known' },
      { value: 'act', label: 'Act within guardrails' },
    ];
    const areas = {};
    for (const a of AUTONOMY_AREAS) {
      const prevMode = existing?.autonomy?.areas?.[a] || 'propose';
      areas[a] = await p.choose(`${ROLE_LABELS[a]} autonomy`, modeOpts, Math.max(AUTONOMY_MODES.indexOf(prevMode), 0));
    }
    const seniorPeople = csv(await p.ask('Senior people it must never message without you (comma separated, optional)', (existing?.autonomy?.seniorPeople || []).join(', ')));
    const sensitive = csv(await p.ask('Topics you mark as sensitive (comma separated, optional)', (existing?.autonomy?.sensitive || []).join(', ')));
    let permissionMode = existing?.leads?.permissionMode || 'acceptEdits';
    if (accounts.length + machines.length > 0) {
      ui.info('Leads run headless with permission mode acceptEdits by default.');
      const bypass = await p.confirm('Let leads skip ALL permission prompts (bypassPermissions)? Only for machines you trust.', permissionMode === 'bypassPermissions');
      permissionMode = bypass ? 'bypassPermissions' : 'acceptEdits';
      if (bypass) ui.warn('Leads can now run any command without asking. Keep them on machines and accounts you are comfortable with.');
    }

    // 7. Schedules
    ui.heading('7. Schedules');
    ui.info('Recorded in the config. The manager creates them as Claude Desktop scheduled tasks on its first run. Type "off" to disable one.');
    const ps = existing?.schedules || DEFAULT_SCHEDULES;
    const sched = {
      morningDigest: await p.ask('Morning digest time', ps.morningDigest || DEFAULT_SCHEDULES.morningDigest),
      eveningDigest: await p.ask('Evening digest time', ps.eveningDigest || DEFAULT_SCHEDULES.eveningDigest),
      boardRefreshMinutes: parseInt(await p.ask('Board refresh interval in minutes', String(ps.boardRefreshMinutes || 5)), 10) || 5,
      toneLearning: await p.ask('Daily tone learning time', ps.toneLearning || DEFAULT_SCHEDULES.toneLearning),
      weeklyReport: await p.ask('Weekly report (day and time)', ps.weeklyReport || DEFAULT_SCHEDULES.weeklyReport),
    };
    for (const k of ['toneLearning', 'weeklyReport']) if (/^off$/i.test(sched[k])) sched[k] = '';

    // 8. Models
    ui.heading('8. Models');
    ui.info('Manager = planning and decisions only. Leads and development = sonnet. Mechanical work = haiku.');
    const pm = existing?.models || DEFAULT_MODELS;
    const models = {
      manager: await p.ask('Manager model', pm.manager),
      lead: await p.ask('Leads and development model', pm.lead),
      mechanical: await p.ask('Mechanical work model', pm.mechanical),
    };

    const cfg = buildConfig({
      name, role, companyType, timeZone, workingHours, languages,
      assistantName, home, setupType: type, accounts, machines, tools,
      autonomy: { areas }, seniorPeople, sensitive, schedules: sched, models, permissionMode,
      createdAt: existing?.createdAt,
    });

    // 9. Summary
    ui.heading('9. Summary');
    const row = (k, v) => ui.line(`  ${(k + ':').padEnd(20)}${v}`);
    row('You', `${cfg.profile.name}${cfg.profile.role ? ', ' + cfg.profile.role : ''} (${cfg.profile.timeZone})`);
    row('Assistant', cfg.assistant.name);
    row('Home', cfg.assistant.home);
    row('Setup', setupExplain(cfg));
    for (const r of ROLES) row(ROLE_LABELS[r], cfg.tools[r].map((e) => e.label).join(', ') || 'none');
    row('Meetings', cfg.tools.meetings?.path || 'none');
    row('Autonomy', AUTONOMY_AREAS.map((a) => `${a}=${cfg.autonomy.areas[a]}`).join(', '));
    row('Models', `manager ${cfg.models.manager}, leads ${cfg.models.lead}, mechanical ${cfg.models.mechanical}`);
    if (!(await p.confirm('Write everything now?', true))) {
      ui.line('  Nothing written.');
      p.close();
      return { aborted: true, reason: 'declined' };
    }

    // Write
    ui.heading('Writing your home');
    const { written, kept } = writeHome(cfg);
    ui.ok(`${written.length} files written to ${cfg.assistant.home}`);
    if (kept.length) ui.ok(`${kept.length} learned or edited files kept as they were`);
    if (!dryRun) rememberHome(cfg.assistant.home, env);

    const doctor = runDoctor(cfg, { ui, offline: dryRun, env });

    // Finish
    ui.heading('Finish');
    const starter = fs.readFileSync(path.join(cfg.assistant.home, 'STARTER-PROMPT.md'), 'utf8');
    let copied = false;
    if (!dryRun) copied = copyToClipboard(starter, platform);
    if (copied) ui.ok('The starter prompt is on your clipboard.');
    else if (dryRun) ui.info(`Dry run: the starter prompt would be copied to the clipboard (${clipboardCommand(platform, () => false)?.cmd || 'platform default'}).`);
    else { ui.warn('No clipboard tool found. Copy the prompt below, or open STARTER-PROMPT.md in the home.'); ui.line(''); ui.line(starter); }
    ui.line('');
    if (platform === 'linux') ui.line(`  Terminal mode: cd "${cfg.assistant.home}" && claude   then paste the starter prompt.`);
    else ui.line(`  Open Claude Desktop > Code > open folder ${cfg.assistant.home} > paste.`);
    if (!dryRun && !opts.noOpen) {
      if (openDesktop(platform)) ui.info('Trying to open Claude Desktop for you.');
    }
    ui.line('');
    p.close();
    return { cfg, home: cfg.assistant.home, written, kept, doctor, tmpBase, copied };
  } finally {
    if (dryRun) { if (savedRoot === undefined) delete process.env.CMK_ROOT; else process.env.CMK_ROOT = savedRoot; }
  }
}

export { renderAll, leadsOf, cmkRoot };
