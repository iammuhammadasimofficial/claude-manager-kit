import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { runWizard, treeLines } from '../src/wizard.js';

const sink = () => new Writable({ write(c, e, cb) { cb(); } });

test('dry run with --yes writes a complete home into a temp dir', async () => {
  const r = await runWizard({ yes: true, dryRun: true, output: sink() });
  assert.ok(!r.aborted);
  const home = r.home;
  assert.ok(home.startsWith(r.tmpBase));
  for (const f of ['manager-kit.json', 'CLAUDE.md', 'rules.md', 'STARTER-PROMPT.md', 'README.md', '.claude/settings.json', 'leads/LEAD-RULES.md', 'memory/state.md', 'tone/tone-model.md', 'board/open.json']) {
    assert.ok(fs.existsSync(path.join(home, f)), f);
  }
  assert.ok(treeLines(home).length > 10);
  fs.rmSync(r.tmpBase, { recursive: true, force: true });
});

test('scripted answers build a mixed setup in a dry run', async () => {
  const lines = [
    'Sam', 'founder', 'a studio', 'Europe/Berlin', '09:00-17:00', 'English, German', // about you
    'Juno', '', // assistant name, home (ignored in dry run)
    '4', // mixed
    '2', 'Wolf', 'Lynx', // 2 accounts
    '1', 'Beast', 'dev@beast.local', // 1 machine
    '1', '', '', '1', '', '', // chat: google chat; mail none; tasks none; code gh; calendar none -> see below
  ];
  // The multi-select prompts: chat, mail, tasks, code, calendar, then meetings path.
  const answers = [
    ...lines.slice(0, 15),
    '2', '', '', '1', '', '', // chat=Slack, mail default, tasks default, code=GitHub, calendar default, meetings blank
    '2', '1', '1', '1', '1', // autonomy chat=reply, rest propose (5 prompts)
    'Dana', 'legal', // senior, sensitive
    'n', // bypass
    '', '', '', '', '', // schedules
    '', '', '', // models
    'y', // write
  ];
  const out = [];
  const output = new Writable({ write(c, e, cb) { out.push(String(c)); cb(); } });
  const r = await runWizard({ dryRun: true, input: Readable.from(answers.map((a) => a + '\n')), output });
  assert.ok(!r.aborted, out.join(''));
  assert.equal(r.cfg.assistant.name, 'Juno');
  assert.equal(r.cfg.setup.type, 'mixed');
  assert.deepEqual(r.cfg.accounts.map((a) => a.name), ['Wolf', 'Lynx']);
  assert.equal(r.cfg.machines[0].target, 'dev@beast.local');
  assert.equal(r.cfg.tools.chat[0].id, 'slack');
  assert.equal(r.cfg.autonomy.areas.chat, 'reply');
  assert.deepEqual(r.cfg.autonomy.seniorPeople, ['Dana']);
  assert.equal(r.cfg.leads.permissionMode, 'acceptEdits');
  assert.ok(fs.existsSync(path.join(r.home, 'leads', 'Lynx', 'brief-start.md')));
  assert.ok(r.cfg.accounts[0].configDir.startsWith(r.tmpBase));
  const lead = JSON.parse(fs.readFileSync(path.join(r.cfg.accounts[0].configDir, 'settings.json'), 'utf8'));
  assert.equal(lead.env.CLAUDE_CODE_SUBAGENT_MODEL, 'sonnet');
  fs.rmSync(r.tmpBase, { recursive: true, force: true });
});

test('input that ends before the summary is confirmed writes nothing', async () => {
  const out = [];
  const output = new Writable({ write(c, e, cb) { out.push(String(c)); cb(); } });
  const r = await runWizard({ dryRun: true, input: Readable.from(['Sam\n']), output });
  assert.equal(r.aborted, true);
  assert.equal(r.reason, 'declined');
  assert.ok(out.join('').includes('Nothing written'));
});
