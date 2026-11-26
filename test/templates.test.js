import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { render, findUnreplaced, renderAll, buildVars, writeHome, loadTemplate } from '../src/templates.js';
import { buildConfig } from '../src/config.js';
import { tmpDir, sampleConfig } from './helpers.js';

const EM = String.fromCharCode(0x2014);

test('render replaces variables and throws on missing ones', () => {
  assert.equal(render('Hi {{ name }}, {{name}}!', { name: 'Sam' }), 'Hi Sam, Sam!');
  assert.throws(() => render('Hi {{nope}}', {}), /nope/);
  assert.deepEqual(findUnreplaced('a {{b}} c'), ['{{b}}']);
});

test('every template renders with no marker left, for solo and mixed setups', () => {
  const solo = buildConfig({ name: 'Sam', assistantName: 'Juno', home: path.join(tmpDir(), 'Juno') });
  for (const cfg of [solo, sampleConfig()]) {
    const files = renderAll(cfg);
    for (const f of ['CLAUDE.md', 'rules.md', 'STARTER-PROMPT.md', 'README.md', 'leads/LEAD-RULES.md']) assert.ok(files[f], f);
    for (const [rel, text] of Object.entries(files)) {
      assert.deepEqual(findUnreplaced(text), [], `unreplaced marker in ${rel}`);
      assert.ok(!text.includes(EM), `em dash in ${rel}`);
      assert.ok(!text.includes('undefined'), `undefined in ${rel}`);
    }
  }
});

test('generated content uses the config values', () => {
  const files = renderAll(sampleConfig());
  assert.match(files['CLAUDE.md'], /Atlas/);
  assert.match(files['CLAUDE.md'], /Sam/);
  assert.match(files['CLAUDE.md'], /Europe\/Berlin/);
  assert.match(files['CLAUDE.md'], /Dana, Lee/);
  assert.match(files['CLAUDE.md'], /\| Wolf \|/);
  assert.match(files['CLAUDE.md'], /\| Beast \|/);
  assert.match(files['CLAUDE.md'], /85 percent/);
  assert.match(files['CLAUDE.md'], /\/notes\/meetings/);
  assert.match(files['leads/LEAD-RULES.md'], /QUESTION:/);
  assert.match(files['leads/Wolf/brief-start.md'], /extra Claude account/);
  assert.match(files['leads/Beast/brief-start.md'], /dev@beast\.local/);
  assert.match(files['STARTER-PROMPT.md'], /Slack/);
  assert.match(files['STARTER-PROMPT.md'], /claude-manager-kit lead start/);
});

test('solo setup says there are no leads', () => {
  const files = renderAll(buildConfig({ name: 'Sam', assistantName: 'Juno', home: '/h' }));
  assert.match(files['CLAUDE.md'], /solo setup/);
  assert.match(files['STARTER-PROMPT.md'], /solo setup/);
  assert.equal(Object.keys(files).filter((f) => f.startsWith('leads/') && f !== 'leads/LEAD-RULES.md').length, 0);
});

test('buildVars gives every variable the templates need', () => {
  const vars = buildVars(sampleConfig());
  for (const name of ['CLAUDE.md.tpl', 'rules.md.tpl', 'STARTER-PROMPT.md.tpl', 'README-home.md.tpl', 'LEAD-RULES.md.tpl', 'lead-brief.md.tpl']) {
    for (const m of loadTemplate(name).matchAll(/\{\{\s*(\w+)\s*\}\}/g)) assert.ok(m[1] in vars, `${name} needs ${m[1]}`);
  }
});

test('writeHome creates the layout and keeps learned files on re-run', () => {
  const cfg = sampleConfig();
  const home = cfg.assistant.home;
  writeHome(cfg);
  for (const f of ['manager-kit.json', 'CLAUDE.md', 'rules.md', 'STARTER-PROMPT.md', 'README.md', '.claude/settings.json', 'tone/tone-model.md', 'memory/state.md', 'memory/ratings.jsonl', 'board/limits.json', 'leads/LEAD-RULES.md', 'leads/Wolf/brief-start.md', 'leads/Wolf/tasks.md', 'leads/Beast/tasks.md', 'meetings/README.md']) {
    assert.ok(fs.existsSync(path.join(home, f)), `missing ${f}`);
  }
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.model, 'opus');
  assert.equal(settings.includeCoAuthoredBy, false);
  assert.deepEqual(settings.attribution, { commit: '', pr: '' });
  fs.writeFileSync(path.join(home, 'memory/state.md'), 'MY NOTES', 'utf8');
  fs.writeFileSync(path.join(home, 'rules.md'), 'MY RULES', 'utf8');
  fs.writeFileSync(path.join(home, 'leads/Wolf/tasks.md'), 'MY TASKS', 'utf8');
  fs.writeFileSync(path.join(home, 'CLAUDE.md'), 'EDITED', 'utf8');
  const r = writeHome(cfg);
  assert.equal(fs.readFileSync(path.join(home, 'memory/state.md'), 'utf8'), 'MY NOTES');
  assert.equal(fs.readFileSync(path.join(home, 'rules.md'), 'utf8'), 'MY RULES');
  assert.equal(fs.readFileSync(path.join(home, 'leads/Wolf/tasks.md'), 'utf8'), 'MY TASKS');
  assert.equal(fs.readFileSync(path.join(home, 'CLAUDE.md.bak'), 'utf8'), 'EDITED');
  assert.match(fs.readFileSync(path.join(home, 'CLAUDE.md'), 'utf8'), /Atlas/);
  assert.ok(r.kept.includes('memory/state.md'));
});

test('the manager settings merge keeps existing keys', () => {
  const cfg = sampleConfig();
  const dir = path.join(cfg.assistant.home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, attribution: { other: 1 } }), 'utf8');
  writeHome(cfg);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
  assert.deepEqual(s.permissions.allow, ['Bash(ls)']);
  assert.equal(s.attribution.other, 1);
  assert.equal(s.attribution.commit, '');
});
