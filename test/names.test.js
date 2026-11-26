import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_NAMES, ACCOUNT_NAMES, MACHINE_NAMES, sanitizeName, isValidName, pickName, pickNames, uniqueName } from '../src/names.js';

test('default name lists are non-empty and unique', () => {
  for (const l of [ASSISTANT_NAMES, ACCOUNT_NAMES, MACHINE_NAMES]) {
    assert.ok(l.length >= 5);
    assert.equal(new Set(l.map((x) => x.toLowerCase())).size, l.length);
  }
  assert.ok(ACCOUNT_NAMES.includes('Wolf'));
  assert.ok(MACHINE_NAMES.includes('Beast'));
});

test('sanitizeName makes folder-safe names', () => {
  assert.equal(sanitizeName('  My Lead / 1 '), 'My-Lead--1');
  assert.equal(sanitizeName('..\\evil'), 'evil');
  assert.equal(sanitizeName(''), '');
  assert.equal(sanitizeName(null), '');
  assert.ok(isValidName('Wolf-2'));
  assert.ok(!isValidName('-bad'));
  assert.ok(!isValidName(''));
});

test('pickName skips used names and is deterministic with an rng', () => {
  assert.equal(pickName(['A', 'B', 'C'], ['a', 'c'], () => 0), 'B');
  assert.equal(pickName(['A'], ['A']), 'A2');
});

test('pickNames returns distinct names', () => {
  assert.equal(new Set(pickNames(ACCOUNT_NAMES, 4)).size, 4);
});

test('uniqueName appends a number on clashes', () => {
  assert.equal(uniqueName('Wolf', ['wolf']), 'Wolf2');
  assert.equal(uniqueName('Wolf', ['wolf', 'wolf2']), 'Wolf3');
  assert.equal(uniqueName('Fox', ['wolf']), 'Fox');
});
