import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildConfig, validateConfig, leadsOf, findLead, saveConfig, loadConfig, findHome, rememberHome, recalledHome,
  ALWAYS_ASK, DEFAULT_MODELS,
} from '../src/config.js';
import { tmpDir, sampleConfig } from './helpers.js';

test('buildConfig fills safe defaults', () => {
  const c = buildConfig({ name: 'Sam', assistantName: 'Juno', home: '/tmp/Juno' });
  assert.equal(c.setup.type, 'solo');
  assert.deepEqual(c.models, DEFAULT_MODELS);
  assert.equal(c.models.manager, 'opus');
  assert.equal(c.models.lead, 'sonnet');
  assert.equal(c.models.mechanical, 'haiku');
  assert.equal(c.leads.permissionMode, 'acceptEdits');
  for (const a of ['chat', 'mail', 'tasks', 'code', 'calendar']) assert.equal(c.autonomy.areas[a], 'propose');
  assert.deepEqual(c.autonomy.alwaysAsk, ALWAYS_ASK);
  assert.deepEqual(validateConfig(c), []);
});

test('setup type follows accounts and machines', () => {
  assert.equal(sampleConfig().setup.type, 'mixed');
  assert.equal(buildConfig({ name: 'a', assistantName: 'X', home: '/h', accounts: [{ name: 'Wolf' }] }).setup.type, 'multi-account');
  assert.equal(buildConfig({ name: 'a', assistantName: 'X', home: '/h', machines: [{ name: 'Beast', target: 'u@h' }] }).setup.type, 'multi-machine');
});

test('always-ask list cannot be shortened through answers', () => {
  const c = buildConfig({ name: 'a', assistantName: 'X', home: '/h', autonomy: { alwaysAsk: [] } });
  assert.equal(c.autonomy.alwaysAsk.length, ALWAYS_ASK.length);
});

test('invalid autonomy and permission values fall back to safe ones', () => {
  const c = buildConfig({ name: 'a', assistantName: 'X', home: '/h', autonomy: { areas: { chat: 'yolo' } }, permissionMode: 'nonsense' });
  assert.equal(c.autonomy.areas.chat, 'propose');
  assert.equal(c.leads.permissionMode, 'acceptEdits');
});

test('bypass mode is kept only when chosen explicitly', () => {
  assert.equal(buildConfig({ name: 'a', assistantName: 'X', home: '/h', permissionMode: 'bypassPermissions' }).leads.permissionMode, 'bypassPermissions');
});

test('validateConfig reports duplicate lead names and missing fields', () => {
  const c = sampleConfig();
  c.machines[0].name = 'wolf';
  assert.ok(validateConfig(c).some((e) => /unique/.test(e)));
  assert.ok(validateConfig({}).length > 0);
});

test('leadsOf and findLead are case-insensitive', () => {
  const c = sampleConfig();
  assert.deepEqual(leadsOf(c).map((l) => l.name), ['Wolf', 'Beast']);
  assert.equal(findLead(c, 'beast').kind, 'machine');
  assert.equal(findLead(c, 'WOLF').kind, 'account');
  assert.equal(findLead(c, 'nobody'), null);
});

test('save, load and home discovery', () => {
  const home = path.join(tmpDir(), 'Atlas');
  saveConfig(home, sampleConfig({ home }));
  assert.ok(fs.existsSync(path.join(home, 'manager-kit.json')));
  assert.equal(loadConfig(home).assistant.name, 'Atlas');
  assert.equal(loadConfig(path.join(tmpDir(), 'none')), null);
  const nested = path.join(home, 'memory');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findHome({ cwd: nested, env: { CMK_ROOT: tmpDir() } }), home);
  assert.equal(findHome({ flag: home }), path.resolve(home));
  const root = tmpDir();
  rememberHome(home, { CMK_ROOT: root });
  assert.equal(recalledHome({ CMK_ROOT: root }), home);
  assert.equal(findHome({ cwd: tmpDir(), env: { CMK_ROOT: root } }), home);
});

test('a broken config file gives a helpful error', () => {
  const home = tmpDir();
  fs.writeFileSync(path.join(home, 'manager-kit.json'), '{oops', 'utf8');
  assert.throws(() => loadConfig(home), /Could not read/);
});
