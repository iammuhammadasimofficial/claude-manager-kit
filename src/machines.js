// Remote machines reached over SSH (the user's own keys, never passwords).
import { run, posixQuote } from './platform.js';

/** Options every ssh call uses: no prompts, short connect timeout. */
export function sshBase() {
  return ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
}

export function validTarget(target) {
  return /^[A-Za-z0-9._@:\[\]-]+$/.test(target || '') && !String(target).startsWith('-');
}

/** Test a machine: can we log in over ssh and does it have claude? */
export function testMachine(target, runner = run) {
  if (!validTarget(target)) return { ok: false, reason: 'bad-target', detail: 'The target should look like user@host.' };
  const r = runner('ssh', [...sshBase(), target, 'claude --version'], { timeout: 30000 });
  if (r.ok) {
    const u = runner('ssh', [...sshBase(), target, 'uname'], { timeout: 20000 });
    return { ok: true, version: r.stdout.trim().split(/\r?\n/)[0], shell: u.ok ? 'posix' : 'windows' };
  }
  const err = (r.stderr || r.error || '').toLowerCase();
  if (/permission denied|publickey|authentication/.test(err)) return { ok: false, reason: 'auth', detail: r.stderr.trim() };
  if (/could not resolve|connection refused|timed out|no route|unreachable/.test(err)) return { ok: false, reason: 'network', detail: r.stderr.trim() };
  if (r.status === 127 || /not found|not recognized/.test(err)) return { ok: false, reason: 'no-claude', detail: (r.stderr || '').trim() };
  return { ok: false, reason: 'unknown', detail: (r.stderr || r.error || '').trim() };
}

export function explainMachineFailure(res) {
  switch (res.reason) {
    case 'auth': return 'SSH login failed. Add your public key to the machine (ssh-copy-id user@host) and make sure key login works without a password prompt.';
    case 'network': return 'Could not reach the machine. Check the address, that it is on, and that an SSH server is running.';
    case 'no-claude': return 'SSH works but the claude command was not found there. Install Claude Code on that machine and make sure it is on the PATH for non-interactive shells (for example export PATH=$HOME/.local/bin:$PATH in ~/.bashrc above any early return for non-interactive shells, or in ~/.zshenv).';
    case 'bad-target': return res.detail;
    default: return 'The test did not pass: ' + (res.detail || 'unknown error');
  }
}

/** The one command to run on the remote machine to finish its setup. */
export const JOIN_COMMAND = 'npx claude-manager-kit join';

/**
 * Build the command string run on the remote side. The brief is NOT in it: it is sent on stdin.
 * shell is 'posix' or 'windows' (OpenSSH default shell cmd.exe).
 */
export function buildRemoteCommand({ shell = 'posix', cwd, args }) {
  if (shell === 'windows') {
    const q = (s) => (/^[\w@+=:,./\\-]+$/.test(s) ? s : `"${String(s).replace(/"/g, '""')}"`);
    const cmd = ['claude', ...args].map(q).join(' ');
    return cwd ? `cd /d ${q(cwd)} && ${cmd}` : cmd;
  }
  const cmd = ['claude', ...args].map(posixQuote).join(' ');
  return cwd ? `cd ${posixQuote(cwd)} && ${cmd}` : cmd;
}

export function sshArgsFor(target, remoteCommand) {
  return [...sshBase(), '-o', 'ServerAliveInterval=30', target, remoteCommand];
}
