import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';
import { tmpDir } from './helpers.js';

const CLI = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, CMK_ROOT: tmpDir('cmk-cli-'), ...env } });

test('parseArgs reads value flags, booleans and short forms', () => {
  const { flags, pos } = parseArgs(['lead', 'start', 'a', '--model', 'haiku', '--wait', '-y', '--rule=be brief']);
  assert.deepEqual(pos, ['lead', 'start', 'a']);
  assert.equal(flags.model, 'haiku');
  assert.equal(flags.wait, true);
  assert.equal(flags.yes, true);
  assert.equal(flags.rule, 'be brief');
});

test('an unknown option is refused before anything is written', () => {
  const r = run(['setup', '--dryrun']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Unknown option --dryrun/);
});

test('rate and doctor work against a generated home', () => {
  const root = tmpDir('cmk-cli-');
  const home = path.join(root, 'H');
  const env = { ...process.env, CMK_ROOT: path.join(root, 'r'), CMK_CLAUDE_BIN: process.execPath };
  const setup = spawnSync(process.execPath, [CLI, 'setup', '--yes', '--no-open', '--home', home], { encoding: 'utf8', env });
  assert.equal(setup.status, 0, setup.stdout + setup.stderr);
  const bad = spawnSync(process.execPath, [CLI, 'rate', 'bad', 'late digest', 'two hours late', '--home', home], { encoding: 'utf8', env });
  assert.equal(bad.status, 0, bad.stdout);
  const none = spawnSync(process.execPath, [CLI, 'rate', 'meh', 'x', '--home', home], { encoding: 'utf8', env });
  assert.equal(none.status, 1);
  const doc = spawnSync(process.execPath, [CLI, 'doctor', '--home', home], { encoding: 'utf8', env });
  assert.match(doc.stdout, /1 bad/);
  assert.match(doc.stdout, /no written rule/);
  const upd = spawnSync(process.execPath, [CLI, 'update', '--yes', '--home', home], { encoding: 'utf8', env });
  assert.equal(upd.status, 0, upd.stdout);
  assert.ok(fs.readFileSync(path.join(home, 'memory', 'ratings.jsonl'), 'utf8').includes('late digest'));
});
