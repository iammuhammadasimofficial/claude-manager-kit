import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseUsage, shouldPause, collectUsage, flattenLimits, writeLimits, usageTable } from '../src/usage.js';
import { tmpDir, sampleConfig } from './helpers.js';

const SAMPLE = 'Current session: 16% used · resets Nov 26, 1:20pm (Asia/Karachi)\n'
  + 'Current week (all models): 28% used · resets Nov 29, 10:59pm (Asia/Karachi)\n';

test('parseUsage reads the 5-hour and weekly rows', () => {
  const rows = parseUsage(SAMPLE);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { window: '5-hour', percent: 16, resets: 'Nov 26, 1:20pm', timeZone: 'Asia/Karachi' });
  assert.deepEqual(rows[1], { window: 'weekly (all models)', percent: 28, resets: 'Nov 29, 10:59pm', timeZone: 'Asia/Karachi' });
});

test('parseUsage tolerates CRLF, ASCII separators and junk', () => {
  const rows = parseUsage('hello\r\nCurrent session: 5% used - resets 9pm\r\nnothing here\r\n');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].percent, 5);
  assert.equal(rows[0].timeZone, null);
  assert.deepEqual(parseUsage(''), []);
  assert.deepEqual(parseUsage('Not logged in'), []);
});

test('shouldPause at 85 percent of the 5-hour window', () => {
  assert.equal(shouldPause(parseUsage(SAMPLE)), false);
  assert.equal(shouldPause([{ window: '5-hour', percent: 85 }]), true);
  assert.equal(shouldPause([{ window: 'weekly (all models)', percent: 99 }]), false);
  assert.equal(shouldPause([], 85), false);
});

test('collectUsage reads main plus every lead and writes limits.json', () => {
  const cfg = sampleConfig();
  const calls = [];
  const reader = (o) => { calls.push(o); return { ok: true, rows: parseUsage(SAMPLE) }; };
  const entries = collectUsage(cfg, {}, reader);
  assert.deepEqual(entries.map((e) => e.account), ['main', 'Wolf', 'Beast']);
  assert.ok(calls[1].configDir);
  assert.equal(calls[2].target, 'dev@beast.local');
  const file = writeLimits(tmpDir(), entries);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(path.basename(file), 'limits.json');
  assert.equal(json.rows.length, 6);
  assert.equal(json.rows[0].percent, 16);
  assert.match(usageTable(entries), /Wolf/);
});

test('unavailable accounts still produce a row', () => {
  const entries = collectUsage(sampleConfig(), {}, () => ({ ok: false, rows: [], error: 'not logged in' }));
  const flat = flattenLimits(entries);
  assert.equal(flat.rows[0].percent, null);
  assert.equal(flat.rows[0].resets, 'unavailable');
  assert.match(usageTable(entries), /not logged in/);
});
