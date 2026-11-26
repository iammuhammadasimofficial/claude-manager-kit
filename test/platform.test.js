import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pathFor, cmkRoot, expandHome, pickWindowsCandidate, needsShell, winQuote, posixQuote, clipboardCommand, desktopStatus,
  symbols, claudeInvocation,
} from '../src/platform.js';
import { buildRemoteCommand } from '../src/machines.js';

test('pathFor gives win32 and posix behaviour', () => {
  assert.equal(pathFor('win32').join('C:\\Users\\sam', '.claude-manager-kit', 'jobs'), 'C:\\Users\\sam\\.claude-manager-kit\\jobs');
  assert.equal(pathFor('linux').join('/home/sam', '.claude-manager-kit', 'jobs'), '/home/sam/.claude-manager-kit/jobs');
});

test('cmkRoot lives outside the home and honours CMK_ROOT', () => {
  assert.equal(cmkRoot({}, '/home/sam', 'linux'), '/home/sam/.claude-manager-kit');
  assert.equal(cmkRoot({}, 'C:\\Users\\sam', 'win32'), 'C:\\Users\\sam\\.claude-manager-kit');
  assert.equal(cmkRoot({ CMK_ROOT: '/x' }, '/home/sam', 'linux'), '/x');
});

test('expandHome handles ~ on both platforms', () => {
  assert.equal(expandHome('~/notes', '/home/sam', 'linux'), '/home/sam/notes');
  assert.equal(expandHome('~\\notes', 'C:\\Users\\sam', 'win32'), 'C:\\Users\\sam\\notes');
  assert.equal(expandHome('/abs', '/home/sam', 'linux'), '/abs');
});

test('Windows command resolution prefers exe, then cmd', () => {
  assert.equal(pickWindowsCandidate(['C:\\a\\claude', 'C:\\a\\claude.cmd', 'C:\\b\\claude.exe']), 'C:\\b\\claude.exe');
  assert.equal(pickWindowsCandidate(['C:\\a\\claude', 'C:\\a\\claude.cmd']), 'C:\\a\\claude.cmd');
  assert.equal(pickWindowsCandidate([]), null);
  assert.ok(needsShell('C:\\a\\claude.cmd', 'win32'));
  assert.ok(!needsShell('C:\\a\\claude.exe', 'win32'));
  assert.ok(!needsShell('/usr/bin/claude.cmd', 'linux'));
});

test('quoting helpers', () => {
  assert.equal(winQuote('--model'), '--model');
  assert.equal(winQuote('a b'), '"a b"');
  assert.equal(posixQuote('/home/sam/my repo'), "'/home/sam/my repo'");
  assert.equal(posixQuote("it's"), "'it'\\''s'");
  assert.equal(posixQuote('plain-1.2'), 'plain-1.2');
});

test('remote command: brief is never in it, cwd is quoted per shell', () => {
  const args = ['-p', '--output-format', 'json', '--model', 'sonnet'];
  assert.equal(buildRemoteCommand({ shell: 'posix', cwd: '/srv/my repo', args }), "cd '/srv/my repo' && claude -p --output-format json --model sonnet");
  assert.equal(buildRemoteCommand({ shell: 'windows', cwd: 'C:\\work\\repo', args }), 'cd /d C:\\work\\repo && claude -p --output-format json --model sonnet');
  assert.equal(buildRemoteCommand({ shell: 'posix', args }), 'claude -p --output-format json --model sonnet');
});

test('clipboard command per platform', () => {
  assert.equal(clipboardCommand('win32').cmd, 'clip');
  assert.equal(clipboardCommand('darwin').cmd, 'pbcopy');
  assert.equal(clipboardCommand('linux', (n) => n === 'xclip').cmd, 'xclip');
  assert.equal(clipboardCommand('linux', (n) => n === 'wl-copy').cmd, 'wl-copy');
  assert.equal(clipboardCommand('linux', (n) => n === 'xsel').cmd, 'xsel');
  assert.equal(clipboardCommand('linux', () => false), null);
});

test('desktop detection with a fake file system', () => {
  const fsx = { existsSync: (p) => p === '/Applications/Claude.app', readdirSync: () => { throw new Error('none'); } };
  assert.ok(desktopStatus('darwin', {}, fsx).installed);
  assert.ok(!desktopStatus('linux', {}, fsx).installed);
  assert.match(desktopStatus('linux', {}, fsx).detail, /terminal mode/);
  const win = { existsSync: (p) => p.endsWith('AnthropicClaude'), readdirSync: () => [] };
  assert.ok(desktopStatus('win32', { LOCALAPPDATA: 'C:\\Users\\sam\\AppData\\Local' }, win).installed);
  const none = { existsSync: () => false, readdirSync: () => [] };
  assert.ok(!desktopStatus('win32', { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\A' }, none).installed);
});

test('symbols fall back to ASCII', () => {
  assert.equal(symbols({ CMK_ASCII: '1' }, true).ok, '[ok]');
  assert.equal(symbols({}, false).ok, '[ok]');
  assert.notEqual(symbols({}, true).ok, '[ok]');
});

test('claudeInvocation honours CMK_CLAUDE_BIN', () => {
  assert.deepEqual(claudeInvocation({ CMK_CLAUDE_BIN: '/bin/node', CMK_CLAUDE_BIN_ARGS: '["x.js"]' }), { cmd: '/bin/node', prefix: ['x.js'] });
});
