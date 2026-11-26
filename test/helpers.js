import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConfig } from '../src/config.js';

export function tmpDir(prefix = 'cmk-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function sampleConfig(over = {}) {
  const home = over.home || path.join(tmpDir(), 'Atlas');
  return buildConfig({
    name: 'Sam',
    role: 'engineering lead',
    companyType: 'a software company',
    timeZone: 'Europe/Berlin',
    assistantName: 'Atlas',
    home,
    accounts: [{ name: 'Wolf', configDir: path.join(home, '..', 'acct-wolf') }],
    machines: [{ name: 'Beast', target: 'dev@beast.local', shell: 'posix' }],
    tools: {
      chat: [{ id: 'slack', label: 'Slack', kind: 'connector', status: 'to-verify' }],
      mail: [],
      tasks: [],
      code: [{ id: 'github', label: 'GitHub (gh CLI)', kind: 'cli', status: 'pending' }],
      calendar: [],
      meetings: { path: '/notes/meetings' },
    },
    seniorPeople: ['Dana', 'Lee'],
    sensitive: ['legal'],
    ...over,
  });
}
