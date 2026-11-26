// Template rendering and home-folder generation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadsOf, saveConfig, validateConfig, AUTONOMY_AREAS } from './config.js';
import { ROLE_LABELS, connectionNotes } from './tools.js';
import { writeSettings, managerSettingsPatch } from './accounts.js';

export const TEMPLATE_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const VAR = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function loadTemplate(name, dir = TEMPLATE_DIR) {
  return fs.readFileSync(path.join(dir, name), 'utf8');
}

/** Replace {{key}} with vars[key]. Throws on a missing key so nothing is silently left blank. */
export function render(tpl, vars) {
  const missing = new Set();
  const out = tpl.replace(VAR, (_, k) => {
    if (!(k in vars) || vars[k] === undefined || vars[k] === null) { missing.add(k); return ''; }
    return String(vars[k]);
  });
  if (missing.size) throw new Error(`Template variables not provided: ${[...missing].join(', ')}`);
  return out;
}

/** Any {{ }} markers left in generated text (should be none). */
export function findUnreplaced(text) {
  return text.match(/\{\{[^}]*\}\}/g) || [];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const MODE_TEXT = { propose: 'propose only', reply: 'reply when the context is known', act: 'act within guardrails' };

export function setupExplain(cfg) {
  const leads = leadsOf(cfg);
  const acc = (cfg.accounts || []).map((a) => a.name);
  const mac = (cfg.machines || []).map((m) => `${m.name} (${m.target})`);
  switch (cfg.setup.type) {
    case 'solo': return 'Solo: one Claude account on this machine. You do everything yourself with subagents.';
    case 'multi-account': return `Multi-account: extra Claude accounts on this machine run the hands-on work as leads: ${acc.join(', ')}.`;
    case 'multi-machine': return `Multi-machine: other computers run the hands-on work as leads over SSH: ${mac.join(', ')}.`;
    default: return `Mixed: leads on extra accounts here (${acc.join(', ') || 'none'}) and on other machines (${mac.join(', ') || 'none'}). ${leads.length} leads in total.`;
  }
}

function toolsTable(cfg) {
  const rows = [];
  for (const role of ['chat', 'mail', 'tasks', 'code', 'calendar']) {
    const list = cfg.tools?.[role] || [];
    if (!list.length) rows.push(`| ${ROLE_LABELS[role]} | none | - |`);
    for (const e of list) rows.push(`| ${ROLE_LABELS[role]} | ${e.label} | ${e.status} |`);
  }
  const m = cfg.tools?.meetings;
  rows.push(`| ${ROLE_LABELS.meetings} | ${m?.path ? m.path : 'none'} | ${m?.path ? 'folder' : '-'} |`);
  return ['| Role | Tool | Status |', '|---|---|---|', ...rows].join('\n');
}

function toolsVerifyList(cfg) {
  const lines = [];
  for (const role of ['chat', 'mail', 'tasks', 'code', 'calendar']) {
    for (const e of cfg.tools?.[role] || []) {
      lines.push(`   - ${ROLE_LABELS[role]}: ${e.label} (${e.status}). ${connectionNotes(e)[0]}`);
    }
  }
  const m = cfg.tools?.meetings;
  if (m?.path) lines.push(`   - Meeting transcripts: read one file from ${m.path}.`);
  return lines.length ? lines.join('\n') : '   - No tools were chosen. Skip this step.';
}

function schedulesLines(cfg) {
  const s = cfg.schedules;
  const tz = cfg.profile.timeZone;
  return [
    `- Morning digest at ${s.morningDigest} (${tz}).`,
    `- Evening digest at ${s.eveningDigest} (${tz}).`,
    `- Board refresh and intake check every ${s.boardRefreshMinutes} minutes while a session is open.`,
    s.toneLearning ? `- Daily tone learning at ${s.toneLearning} (${tz}).` : '- Daily tone learning: off.',
    s.weeklyReport ? `- Weekly report: ${s.weeklyReport} (${tz}).` : '- Weekly report: off.',
  ].join('\n');
}

function routingSection(cfg) {
  const u = cfg.profile.name;
  const leads = leadsOf(cfg);
  if (!leads.length) {
    return [
      'This is a solo setup: there are no leads. You do the work yourself with subagents.',
      '',
      '- Use the smallest subagent that fits: a developer, a tester, a reviewer. Mechanical work (git and tracker',
      `  plumbing, posting text ${u} approved, file moves) goes to the cheapest model (${cfg.models.mechanical}).`,
      '- Run one development task at a time. Start a fresh subagent per task.',
      `- If ${u} later adds accounts or machines, re-run setup and this section turns into a routing table.`,
    ].join('\n');
  }
  const rows = leads.map((l) => `| ${l.name} | ${l.kind === 'account' ? 'extra account on this machine' : `machine ${l.target}`} | \`leads/${l.name}/\` |`);
  return [
    'You talk only to leads, never to their children. Each lead runs headless jobs through the helper:',
    '',
    '| Lead | Runs on | Folder |',
    '|---|---|---|',
    ...rows,
    '',
    '1. Find the lead that owns the work (same feature, ticket, PR or branch) with `cmk lead status`.',
    '2. Prefer the lead that already owns the topic. Start a new job only when nothing fits.',
    '3. Write briefs so the lead can act alone: the goal, links, what done looks like, and the hard rules below.',
    '   Ask it to end with a short summary and PR or ticket links.',
    `4. Start: \`cmk lead start <lead> <job> <brief-file> [--model sonnet] [--cwd <dir>]\`. Continue: \`cmk lead reply <job> <brief-file>\`.`,
    '   Read: `cmk lead status`, `cmk lead result <job>`. Stop: `cmk lead stop <job>`.',
    '5. If a lead is busy, do not interrupt it: keep the instruction and send it when the job finishes.',
    '6. A result ending with `QUESTION:` is for you: answer from context, or ask the user, then reply to the job.',
    '7. Record every dispatch in `memory/state.md` and on the board.',
    `8. Before assigning, run \`cmk usage\`: at 85 percent of the 5-hour limit, assign nothing new to that lead.`,
  ].join('\n').replace('Check `' + 'cmkCmd' + '` is not needed: use ', 'Use ');
}

function meetingsSection(cfg) {
  const m = cfg.tools?.meetings;
  if (!m?.path) return '';
  return `- Meeting notes: after each meeting, read the new transcript in \`${m.path}\`, write a summary into \`meetings/\` (decisions, action items, owners), and turn the action items into tasks or follow-ups.\n`;
}

/** All variables used by the templates. */
export function buildVars(cfg, extra = {}) {
  const u = cfg.profile.name;
  const al = cfg.autonomy.areas;
  const senior = cfg.autonomy.seniorPeople || [];
  const sens = cfg.autonomy.sensitive || [];
  const leads = leadsOf(cfg);
  const cmkCmd = 'npx claude-manager-kit';
  return {
    userName: u,
    assistantName: cfg.assistant.name,
    role: cfg.profile.role || 'professional',
    companyType: cfg.profile.companyType ? `, ${cfg.profile.companyType}` : '',
    timeZone: cfg.profile.timeZone,
    workingHours: cfg.profile.workingHours,
    languages: cfg.profile.languages.join(', '),
    home: cfg.assistant.home,
    cmkCmd,
    setupSummary: setupExplain(cfg),
    toolsTable: toolsTable(cfg),
    toolsVerifyList: toolsVerifyList(cfg),
    autonomyTable: ['| Area | Mode |', '|---|---|', ...AUTONOMY_AREAS.map((a) => `| ${cap(a)} | ${MODE_TEXT[al[a]]} |`)].join('\n'),
    autonomyBullets: AUTONOMY_AREAS.map((a) => `  - ${cap(a)}: ${MODE_TEXT[al[a]]}`).join('\n'),
    alwaysAskList: cfg.autonomy.alwaysAsk.map((x) => `- ${cap(x)}`).join('\n'),
    seniorPeopleLine: senior.length
      ? `Senior people (never reply directly when unsure; draft in ${u}'s tone and ask): ${senior.join(', ')}.`
      : 'No senior people were listed. Add names to `autonomy.seniorPeople` in the config to protect messages to them.',
    sensitiveList: sens.length ? sens.map((x) => `- ${x}`).join('\n') : '- None listed yet. Add topics here.',
    schedulesList: schedulesLines(cfg),
    schedulesTaskList: schedulesLines(cfg).split('\n').map((l) => '   ' + l).join('\n'),
    modelsTable: `manager ${cfg.models.manager} (planning and decisions only), leads and development ${cfg.models.lead}, mechanical work ${cfg.models.mechanical}.`,
    managerModel: cfg.models.manager,
    leadModel: cfg.models.lead,
    mechanicalModel: cfg.models.mechanical,
    routingSection: routingSection(cfg),
    meetingsSection: meetingsSection(cfg),
    leadsStep: leads.length
      ? `6. Start each lead with its brief (\`cmk lead start <lead> <job> leads/<lead>/brief-start.md\`) and a first small task, one at a time. Leads: ${leads.map((l) => l.name).join(', ')}.`
      : '6. This is a solo setup: there are no leads to start. Skip this step.',
    leadRulesPath: path.join(cfg.assistant.home, 'leads', 'LEAD-RULES.md'),
    leadName: '',
    leadWhere: '',
    ...extra,
  };
}

/** Render every generated file. Returns a map relativePath -> content. */
export function renderAll(cfg, dir = TEMPLATE_DIR) {
  const vars = buildVars(cfg);
  const files = {
    'CLAUDE.md': render(loadTemplate('CLAUDE.md.tpl', dir), vars),
    'rules.md': render(loadTemplate('rules.md.tpl', dir), vars),
    'STARTER-PROMPT.md': render(loadTemplate('STARTER-PROMPT.md.tpl', dir), vars),
    'README.md': render(loadTemplate('README-home.md.tpl', dir), vars),
    'leads/LEAD-RULES.md': render(loadTemplate('LEAD-RULES.md.tpl', dir), vars),
  };
  for (const l of leadsOf(cfg)) {
    const lv = buildVars(cfg, {
      leadName: l.name,
      leadWhere: l.kind === 'account' ? 'headless on an extra Claude account on the same computer as the manager' : `headless over SSH on the machine ${l.target}`,
    });
    files[`leads/${l.name}/brief-start.md`] = render(loadTemplate('lead-brief.md.tpl', dir), lv);
    files[`leads/${l.name}/tasks.md`] = `# Task log: ${l.name}\n\nOne line per task: date | job id | task | PR links | state\n\n`;
  }
  return files;
}

// Files the assistant fills over time: created once, never overwritten by a re-run.
const SEED_FILES = {
  'tone/tone-model.md': '# Tone model\n\nFilled by the assistant after it reads your sent messages. Describe style, length, greetings, sign-offs and how it changes by audience.\n',
  'tone/examples.jsonl': '',
  'tone/feedback.jsonl': '',
  'memory/state.md': '# State\n\nOpen commitments, what is waiting on whom, which job owns which topic, decisions made. Keep it short.\n',
  'memory/ratings.jsonl': '',
  'board/open.json': '{"rows":[]}\n',
  'board/done.json': '{"rows":[]}\n',
  'board/jobs.json': '{"rows":[]}\n',
  'board/limits.json': '{"rows":[]}\n',
};
// Generated files that the user edits: only created when missing.
const USER_EDITED = new Set(['rules.md']);

/**
 * Write the whole home. Returns { written, kept }.
 * Policy: seed files and rules.md are never overwritten; generated files are re-written, and a changed
 * CLAUDE.md is first saved as CLAUDE.md.bak.
 */
export function writeHome(cfg, { dir = TEMPLATE_DIR } = {}) {
  const errs = validateConfig(cfg);
  if (errs.length) throw new Error('Config is not valid: ' + errs.join('; '));
  const home = cfg.assistant.home;
  const files = renderAll(cfg, dir);
  const written = [];
  const kept = [];
  const put = (rel, content, onlyIfMissing) => {
    const full = path.join(home, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (fs.existsSync(full)) {
      if (onlyIfMissing) { kept.push(rel); return; }
      const old = fs.readFileSync(full, 'utf8');
      if (old === content) { written.push(rel); return; }
      if (rel === 'CLAUDE.md') fs.writeFileSync(full + '.bak', old, 'utf8');
    }
    fs.writeFileSync(full, content, 'utf8');
    written.push(rel);
  };
  for (const [rel, content] of Object.entries(files)) {
    const bad = findUnreplaced(content);
    if (bad.length) throw new Error(`Unreplaced markers in ${rel}: ${bad.join(', ')}`);
    put(rel, content, USER_EDITED.has(rel) || rel.endsWith('/tasks.md'));
  }
  for (const [rel, content] of Object.entries(SEED_FILES)) put(rel, content, true);
  if (cfg.tools?.meetings?.path) {
    put('meetings/README.md', '# Meetings\n\nMeeting notes and summaries written by the assistant after each meeting.\n', true);
  }
  saveConfig(home, cfg);
  written.push('manager-kit.json');
  writeSettings(path.join(home, '.claude'), managerSettingsPatch(cfg.models));
  written.push('.claude/settings.json');
  return { written, kept };
}
