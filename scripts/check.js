// Syntax-check every source file. Written in Node so it works the same in cmd, PowerShell and sh.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [path.join(root, 'bin', 'cli.js')];
for (const dir of ['src', 'test', 'scripts']) {
  for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.js')) files.push(path.join(root, dir, f));
}
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad += 1; process.stderr.write(r.stderr); }
}
console.log(bad ? `${bad} file(s) failed the syntax check` : `${files.length} files OK`);
process.exit(bad ? 1 : 0);
