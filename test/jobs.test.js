import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseStatus, writeStatus, readJobStatus, buildClaudeArgs, parseClaudeJson, startJob, replyJob, jobResult, listJobs,
  validateJobName, validateModel, extractQuestion, stopJob, buildExecution, jobDir,
} from '../src/jobs.js';
import { tmpDir, sampleConfig } from './helpers.js';

function fakeEnv() {
  const dir = tmpDir();
  const script = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(script, [
    "let s='';process.stdin.on('data',d=>s+=d);",
    "process.stdin.on('end',()=>{",
    "  fs.appendFileSync(process.env.FAKE_LOG||'/dev/null', JSON.stringify({args:process.argv.slice(2),cfg:process.env.CLAUDE_CONFIG_DIR,cwd:process.cwd()})+'\\n');",
    "  const fail=s.includes('FAIL');",
    "  console.log(JSON.stringify({type:'result',is_error:fail,result:fail?'boom':'echo: '+s.trim()+'\\nQUESTION: which branch?',session_id:'sess-123'}));",
    "  process.exit(fail?1:0);});",
  ].join('\n').replace(/^/, "const fs=require('node:fs');\n"), 'utf8');
  fs.renameSync(script, script.replace(/\.js$/, '.cjs'));
  const log = path.join(dir, 'calls.log');
  return {
    log,
    env: {
      ...process.env,
      CMK_ROOT: path.join(dir, 'root'),
      CMK_CLAUDE_BIN: process.execPath,
      CMK_CLAUDE_BIN_ARGS: JSON.stringify([script.replace(/\.js$/, '.cjs')]),
      FAKE_LOG: log,
    },
  };
}

test('status text parsing and stale detection', () => {
  assert.deepEqual(parseStatus('running 2026-01-01T00:00:00Z'), { state: 'running', at: '2026-01-01T00:00:00Z', note: '' });
  assert.equal(parseStatus('failed 2026-01-01T00:00:00Z exit 1').note, 'exit 1');
  assert.equal(parseStatus('').state, 'unknown');
  const { env } = fakeEnv();
  const dir = jobDir('stale', env);
  fs.mkdirSync(dir, { recursive: true });
  writeStatus(dir, 'running');
  fs.writeFileSync(path.join(dir, 'pid.txt'), '2147480000');
  assert.equal(readJobStatus('stale', env).state, 'failed');
  assert.match(readJobStatus('stale', env).note, /stale/);
  writeStatus(dir, 'done');
  assert.equal(readJobStatus('stale', env).state, 'done');
});

test('claude arguments never contain the brief and support resume', () => {
  const a = buildClaudeArgs({ model: 'sonnet', permissionMode: 'acceptEdits' });
  assert.deepEqual(a, ['-p', '--output-format', 'json', '--model', 'sonnet', '--permission-mode', 'acceptEdits']);
  assert.deepEqual(buildClaudeArgs({ model: 'opus', resume: 's1' }).slice(-2), ['--resume', 's1']);
});

test('parseClaudeJson handles plain, multi-line and array output', () => {
  assert.equal(parseClaudeJson('{"result":"a","session_id":"s"}').result, 'a');
  assert.equal(parseClaudeJson('warn\n{"result":"b"}\n').result, 'b');
  assert.equal(parseClaudeJson('[{"type":"system"},{"type":"result","result":"c"}]').result, 'c');
  assert.equal(parseClaudeJson('not json'), null);
  assert.equal(parseClaudeJson(''), null);
});

test('job and model names are validated', () => {
  assert.throws(() => validateJobName('../x'), /Bad job name/);
  assert.throws(() => validateJobName(''), /Bad job name/);
  assert.equal(validateJobName('fix-login.1'), 'fix-login.1');
  assert.throws(() => validateModel('a b; rm'), /Bad model/);
  assert.equal(validateModel('sonnet'), 'sonnet');
});

test('extractQuestion finds the last QUESTION line', () => {
  assert.equal(extractQuestion('done\nQUESTION: a?\nmore\nQUESTION: b?'), 'QUESTION: b?');
  assert.equal(extractQuestion('nothing'), null);
});

test('a job runs end to end with --wait, then continues with reply', async () => {
  const { env, log } = fakeEnv();
  const cfg = sampleConfig();
  const work = tmpDir();
  const r = await startJob({ cfg, home: cfg.assistant.home, lead: 'wolf', job: 'j1', briefText: 'Do the thing', model: 'sonnet', cwd: work, wait: true, env });
  assert.equal(r.state, 'done');
  const dir = jobDir('j1', env);
  for (const f of ['prompt.txt', 'status.txt', 'session.txt', 'result.md', 'history.md', 'err.log', 'meta.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.equal(fs.readFileSync(path.join(dir, 'session.txt'), 'utf8'), 'sess-123');
  assert.match(jobResult('j1', env).text, /echo: Do the thing/);
  assert.equal(readJobStatus('j1', env).state, 'done');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(calls[0].args.includes('--model'));
  assert.ok(!calls[0].args.some((x) => x.includes('Do the thing')), 'brief must be on stdin only');
  assert.equal(calls[0].cfg, cfg.accounts[0].configDir);
  assert.equal(fs.realpathSync(calls[0].cwd), fs.realpathSync(work));

  await assert.rejects(() => startJob({ cfg, home: cfg.assistant.home, lead: 'wolf', job: 'j1', briefText: 'x', model: 'sonnet', wait: true, env }), /already exists/);
  const r2 = await replyJob({ cfg, home: cfg.assistant.home, job: 'j1', briefText: 'Next step', wait: true, env });
  assert.equal(r2.state, 'done');
  const calls2 = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls2[1].args.slice(-2), ['--resume', 'sess-123']);
  const hist = fs.readFileSync(path.join(dir, 'history.md'), 'utf8');
  assert.match(hist, /Do the thing/);
  assert.match(hist, /Next step/);
  assert.equal(listJobs(env).length, 1);
  assert.equal(listJobs(env)[0].lead, 'Wolf');
});

test('a failing job is marked failed', async () => {
  const { env } = fakeEnv();
  const cfg = sampleConfig();
  const r = await startJob({ cfg, home: cfg.assistant.home, lead: 'Wolf', job: 'bad', briefText: 'FAIL please', model: 'haiku', wait: true, env });
  assert.equal(r.state, 'failed');
  assert.equal(readJobStatus('bad', env).state, 'failed');
});

test('unknown leads and solo setups give helpful errors', async () => {
  const { env } = fakeEnv();
  const cfg = sampleConfig();
  await assert.rejects(() => startJob({ cfg, home: 'h', lead: 'nobody', job: 'x1', briefText: 'x', model: 'sonnet', wait: true, env }), /Known leads: Wolf, Beast/);
  const solo = { ...cfg, accounts: [], machines: [] };
  await assert.rejects(() => startJob({ cfg: solo, home: 'h', lead: 'Wolf', job: 'x2', briefText: 'x', model: 'sonnet', wait: true, env }), /solo/);
});

test('machine jobs build an ssh command with the brief on stdin', () => {
  const meta = { model: 'sonnet', permissionMode: 'acceptEdits', cwd: '/srv/app', exec: { kind: 'machine', target: 'dev@beast.local', shell: 'posix' } };
  const e = buildExecution(meta, 'sess-1', process.env);
  assert.equal(e.cmd, 'ssh');
  assert.ok(e.args.includes('BatchMode=yes'));
  assert.ok(e.args.includes('dev@beast.local'));
  const remote = e.args[e.args.length - 1];
  assert.match(remote, /^cd \/srv\/app && claude -p /);
  assert.match(remote, /--resume sess-1$/);
  assert.throws(() => buildExecution({ ...meta, exec: { kind: 'machine', target: '-oProxyCommand=x', shell: 'posix' } }, null, process.env), /Bad ssh target/);
});

test('stopJob marks a running job stopped and ignores finished ones', () => {
  const { env } = fakeEnv();
  const dir = jobDir('s1', env);
  fs.mkdirSync(dir, { recursive: true });
  writeStatus(dir, 'running');
  assert.equal(stopJob('s1', env).stopped, true);
  assert.equal(readJobStatus('s1', env).state, 'stopped');
  assert.equal(stopJob('s1', env).stopped, false);
  assert.throws(() => stopJob('nope', env), /does not exist/);
});
