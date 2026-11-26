import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EM = String.fromCharCode(0x2014);
// Built from pieces so this file does not trip its own scan.
const BANNED = [['al', 'fred'], ['insurance', 'market'], ['holiday', 'market'], ['credit', 'market'], ['af', 'ia'], ['hus', 'sain'], ['beast-', 'work'], ['my', 'Alfred'], ['chief', ' of staff'], ['chief-', 'of-staff']].map((p) => p.join(''));

function files(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'test'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files(full, out); else out.push(full);
  }
  return out;
}

test('no em dashes and no private names or old product wording in shipped files', () => {
  for (const f of files(ROOT)) {
    if (path.basename(f) === 'SPEC.md' || path.basename(f) === 'package-lock.json') continue;
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!text.includes(EM), `em dash in ${f}`);
    const lower = text.toLowerCase();
    for (const b of BANNED) assert.ok(!lower.includes(b.toLowerCase()), `"${b}" found in ${f}`);
  }
});

test('package.json is publish ready', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'claude-manager-kit');
  assert.deepEqual(Object.keys(pkg.bin).sort(), ['claude-manager-kit', 'cmk']);
  assert.ok(!pkg.dependencies && !pkg.scripts.postinstall && !pkg.scripts.install);
  assert.equal(pkg.engines.node, '>=18');
  assert.ok(fs.readFileSync(path.join(ROOT, 'bin/cli.js'), 'utf8').startsWith('#!/usr/bin/env node'));
});
