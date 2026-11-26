// Config model: building, validating, loading and saving manager-kit.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cmkRoot, detectTimeZone } from './platform.js';
import { sanitizeName } from './names.js';

export const CONFIG_FILE = 'manager-kit.json';
export const CONFIG_VERSION = 1;

export const SETUP_TYPES = ['solo', 'multi-account', 'multi-machine', 'mixed'];
export const AUTONOMY_MODES = ['propose', 'reply', 'act'];
export const AUTONOMY_AREAS = ['chat', 'mail', 'tasks', 'code', 'calendar'];
export const PERMISSION_MODES = ['acceptEdits', 'plan', 'default', 'bypassPermissions'];

/** The always-ask list is fixed: the wizard shows it but cannot remove items. */
export const ALWAYS_ASK = [
  'production deploys',
  'payments and anything involving money',
  'permissions and access changes',
  'deleting data',
  'messages to the senior people you list',
  'anything external you mark as sensitive',
];

export const DEFAULT_MODELS = { manager: 'opus', lead: 'sonnet', mechanical: 'haiku' };

export const DEFAULT_SCHEDULES = {
  morningDigest: '09:00',
  eveningDigest: '18:30',
  boardRefreshMinutes: 5,
  toneLearning: '18:45',
  weeklyReport: 'Fri 17:00',
};

export function emptyTools() {
  return { chat: [], mail: [], tasks: [], code: [], calendar: [], meetings: null };
}

/** Build a complete, normalised config from partial wizard answers. */
export function buildConfig(a = {}) {
  const assistantName = sanitizeName(a.assistantName) || 'Atlas';
  const home = a.home || path.join(os.homedir(), assistantName);
  const accounts = (a.accounts || []).map((x) => ({
    name: sanitizeName(x.name),
    configDir: x.configDir || path.join(cmkRoot(), 'accounts', sanitizeName(x.name)),
    loggedIn: !!x.loggedIn,
  })).filter((x) => x.name);
  const machines = (a.machines || []).map((x) => ({
    name: sanitizeName(x.name),
    target: String(x.target || '').trim(),
    shell: x.shell === 'windows' ? 'windows' : 'posix',
    verified: !!x.verified,
  })).filter((x) => x.name && x.target);

  let setupType = a.setupType;
  if (!SETUP_TYPES.includes(setupType)) setupType = 'solo';
  if (accounts.length && machines.length) setupType = 'mixed';
  else if (accounts.length) setupType = setupType === 'mixed' ? 'mixed' : 'multi-account';
  else if (machines.length) setupType = 'multi-machine';
  else setupType = 'solo';

  const autonomy = { chat: 'propose', mail: 'propose', tasks: 'propose', code: 'propose', calendar: 'propose', ...(a.autonomy?.areas || {}) };
  for (const k of Object.keys(autonomy)) if (!AUTONOMY_MODES.includes(autonomy[k])) autonomy[k] = 'propose';

  const permissionMode = PERMISSION_MODES.includes(a.permissionMode) ? a.permissionMode : 'acceptEdits';

  return {
    version: CONFIG_VERSION,
    createdAt: a.createdAt || new Date().toISOString(),
    profile: {
      name: String(a.name || '').trim() || 'there',
      role: String(a.role || '').trim(),
      companyType: String(a.companyType || '').trim(),
      timeZone: a.timeZone || detectTimeZone(),
      workingHours: a.workingHours || '09:00-18:00',
      languages: a.languages?.length ? [].concat(a.languages) : ['English'],
    },
    assistant: { name: assistantName, home },
    setup: { type: setupType },
    accounts,
    machines,
    tools: { ...emptyTools(), ...(a.tools || {}) },
    autonomy: {
      areas: autonomy,
      alwaysAsk: [...ALWAYS_ASK],
      seniorPeople: [].concat(a.seniorPeople || []).filter(Boolean),
      sensitive: [].concat(a.sensitive || []).filter(Boolean),
    },
    schedules: { ...DEFAULT_SCHEDULES, ...(a.schedules || {}) },
    models: { ...DEFAULT_MODELS, ...(a.models || {}) },
    leads: { permissionMode },
  };
}

export function validateConfig(cfg) {
  const errs = [];
  if (!cfg || typeof cfg !== 'object') return ['config is not an object'];
  if (cfg.version !== CONFIG_VERSION) errs.push(`unsupported config version: ${cfg.version}`);
  if (!cfg.profile?.name) errs.push('profile.name is missing');
  if (!cfg.assistant?.name) errs.push('assistant.name is missing');
  if (!cfg.assistant?.home) errs.push('assistant.home is missing');
  if (!SETUP_TYPES.includes(cfg.setup?.type)) errs.push('setup.type is invalid');
  const names = [...(cfg.accounts || []), ...(cfg.machines || [])].map((x) => x.name.toLowerCase());
  if (new Set(names).size !== names.length) errs.push('lead names must be unique across accounts and machines');
  for (const m of cfg.machines || []) if (!m.target) errs.push(`machine ${m.name} has no ssh target`);
  if (!PERMISSION_MODES.includes(cfg.leads?.permissionMode)) errs.push('leads.permissionMode is invalid');
  for (const k of ['manager', 'lead', 'mechanical']) if (!cfg.models?.[k]) errs.push(`models.${k} is missing`);
  return errs;
}

/** Every lead: local accounts first, then machines. */
export function leadsOf(cfg) {
  return [
    ...(cfg.accounts || []).map((a) => ({ name: a.name, kind: 'account', configDir: a.configDir })),
    ...(cfg.machines || []).map((m) => ({ name: m.name, kind: 'machine', target: m.target, shell: m.shell })),
  ];
}

export function findLead(cfg, name) {
  const n = String(name || '').toLowerCase();
  return leadsOf(cfg).find((l) => l.name.toLowerCase() === n) || null;
}

export const configPath = (home) => path.join(home, CONFIG_FILE);

export function loadConfig(home) {
  const p = configPath(home);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(`Could not read ${p}: ${e.message}. Fix the JSON or delete the file and run setup again.`);
  }
}

export function saveConfig(home, cfg) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(configPath(home), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** Remember which home the helper commands should use (stored outside the home). */
export function rememberHome(home, env = process.env) {
  const root = cmkRoot(env);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'current-home.txt'), home + '\n', 'utf8');
}

export function recalledHome(env = process.env) {
  try {
    const t = fs.readFileSync(path.join(cmkRoot(env), 'current-home.txt'), 'utf8').trim();
    return t || null;
  } catch {
    return null;
  }
}

/** Find the home: --home flag, CMK_HOME, a config in cwd or a parent, then the remembered home. */
export function findHome({ flag, env = process.env, cwd = process.cwd() } = {}) {
  if (flag) return path.resolve(flag);
  if (env.CMK_HOME) return path.resolve(env.CMK_HOME);
  let dir = path.resolve(cwd);
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(configPath(dir))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  const r = recalledHome(env);
  return r && fs.existsSync(configPath(r)) ? r : null;
}
