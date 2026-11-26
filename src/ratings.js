// Ratings log: memory/ratings.jsonl, one JSON line per rating.
// {"date":"YYYY-MM-DD","rating":"good|bad","what":"...","why":"...","rule":"..."}
// The manager reads it at session start; every bad rating must end as a written rule.
import fs from 'node:fs';
import path from 'node:path';

export const ratingsFile = (home) => path.join(home, 'memory', 'ratings.jsonl');

export function normalizeRating(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['good', 'bad'].includes(v)) return v;
  if (['+', 'up', 'like', 'positive'].includes(v)) return 'good';
  if (['-', 'down', 'dislike', 'negative'].includes(v)) return 'bad';
  throw new Error(`Rating must be "good" or "bad", got "${value}".`);
}

export function addRating(home, { rating, what, why = '', rule = '', date = new Date() }) {
  const r = normalizeRating(rating);
  const w = String(what || '').trim();
  if (!w) throw new Error('Say what is being rated. Usage: cmk rate good|bad "<what>" ["<why>"]');
  const entry = { date: (date instanceof Date ? date : new Date(date)).toISOString().slice(0, 10), rating: r, what: w, why: String(why).trim(), rule: String(rule).trim() };
  const file = ratingsFile(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prefix = '';
  try { const cur = fs.readFileSync(file, 'utf8'); if (cur && !cur.endsWith('\n')) prefix = '\n'; } catch { /* new file */ }
  fs.appendFileSync(file, `${prefix}${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

/** Read all valid ratings; lines that are not valid JSON are skipped and counted. */
export function readRatings(home) {
  let text = '';
  try { text = fs.readFileSync(ratingsFile(home), 'utf8'); } catch { return { entries: [], skipped: 0 }; }
  const entries = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o && (o.rating === 'good' || o.rating === 'bad')) entries.push(o); else skipped += 1;
    } catch { skipped += 1; }
  }
  return { entries, skipped };
}

export function summariseRatings(entries) {
  const good = entries.filter((e) => e.rating === 'good').length;
  const bad = entries.filter((e) => e.rating === 'bad').length;
  const needRule = entries.filter((e) => e.rating === 'bad' && !String(e.rule || '').trim());
  return { total: entries.length, good, bad, needRule };
}
