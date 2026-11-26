import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { addRating, readRatings, summariseRatings, normalizeRating, ratingsFile } from '../src/ratings.js';
import { renderAll } from '../src/templates.js';
import { sampleConfig, tmpDir } from './helpers.js';

test('normalizeRating accepts good, bad and short forms, rejects the rest', () => {
  assert.equal(normalizeRating('GOOD'), 'good');
  assert.equal(normalizeRating('-'), 'bad');
  assert.throws(() => normalizeRating('meh'), /good.*bad/);
});

test('addRating appends one JSON line and keeps earlier lines', () => {
  const home = tmpDir();
  addRating(home, { rating: 'good', what: 'short digest', why: 'read in 10 seconds', date: '2026-01-02' });
  addRating(home, { rating: 'bad', what: 'replied to a senior person', why: 'not allowed', rule: 'Never reply to senior people', date: '2026-01-03' });
  const lines = fs.readFileSync(ratingsFile(home), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])), ['date', 'rating', 'what', 'why', 'rule']);
  const { entries, skipped } = readRatings(home);
  assert.equal(entries.length, 2);
  assert.equal(skipped, 0);
  const s = summariseRatings(entries);
  assert.deepEqual([s.good, s.bad, s.needRule.length], [1, 1, 0]);
});

test('addRating repairs a missing trailing newline, flags bad ratings without a rule, skips junk', () => {
  const home = tmpDir();
  fs.mkdirSync(path.join(home, 'memory'));
  fs.writeFileSync(ratingsFile(home), '{"rating":"good","what":"x"}\nnot json');
  addRating(home, { rating: 'bad', what: 'missed a deadline' });
  const { entries, skipped } = readRatings(home);
  assert.equal(entries.length, 2);
  assert.equal(skipped, 1);
  assert.equal(summariseRatings(entries).needRule.length, 1);
  assert.throws(() => addRating(home, { rating: 'good', what: '  ' }), /what is being rated/);
});

test('generated playbook implements the ratings loop', () => {
  const files = renderAll(sampleConfig());
  const md = files['CLAUDE.md'];
  for (const s of ['reinforcement', 'Good rating = reward', 'Bad rating = penalty', 'Review at session start', 'memory/ratings.jsonl', 'rate good|bad']) assert.ok(md.includes(s), s);
  assert.ok(files['STARTER-PROMPT.md'].includes('ratings.jsonl'));
});
