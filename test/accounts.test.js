import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergeSettings, leadSettingsPatch, writeSettings, accountDir } from '../src/accounts.js';
import { tmpDir } from './helpers.js';

test('mergeSettings never drops keys', () => {
  const out = mergeSettings({ a: 1, env: { KEEP: 'x' }, list: [1] }, { env: { NEW: 'y' }, b: 2 });
  assert.deepEqual(out, { a: 1, env: { KEEP: 'x', NEW: 'y' }, list: [1], b: 2 });
});

test('lead settings carry the subagent model and attribution off', () => {
  const p = leadSettingsPatch({ lead: 'sonnet' });
  assert.equal(p.env.CLAUDE_CODE_SUBAGENT_MODEL, 'sonnet');
  assert.equal(p.includeCoAuthoredBy, false);
  assert.deepEqual(p.attribution, { commit: '', pr: '' });
});

test('writeSettings merges into an existing file and rejects broken JSON', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'dark', env: { A: '1' } }), 'utf8');
  writeSettings(dir, leadSettingsPatch({ lead: 'sonnet' }));
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.equal(s.theme, 'dark');
  assert.equal(s.env.A, '1');
  assert.equal(s.env.CLAUDE_CODE_SUBAGENT_MODEL, 'sonnet');
  const bad = tmpDir();
  fs.writeFileSync(path.join(bad, 'settings.json'), '{nope', 'utf8');
  assert.throws(() => writeSettings(bad, {}), /not valid JSON/);
});

test('account dirs live under the tool root, not in a home', () => {
  assert.equal(accountDir('Wolf', { CMK_ROOT: '/r' }), path.join('/r', 'accounts', 'Wolf'));
});
