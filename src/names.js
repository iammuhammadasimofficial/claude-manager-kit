// Fun default names for the assistant, lead accounts and machines.
export const ASSISTANT_NAMES = ['Atlas', 'Juno', 'Orion', 'Sage', 'Nova', 'Vega', 'Iris', 'Echo', 'Kestrel', 'Maple'];
export const ACCOUNT_NAMES = ['Wolf', 'Falcon', 'Lynx', 'Otter', 'Raven', 'Fox', 'Heron', 'Badger'];
export const MACHINE_NAMES = ['Beast', 'Titan', 'Forge', 'Anvil', 'Mammoth', 'Rhino', 'Bison', 'Colossus'];

/** Make a user-typed name safe for folders and job ids: letters, digits, dash, underscore. */
export function sanitizeName(input) {
  return String(input ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function isValidName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(name || '');
}

/** Pick one default from a list, skipping names already used (case-insensitive). */
export function pickName(list, used = [], rng = Math.random) {
  const taken = new Set(used.map((u) => String(u).toLowerCase()));
  const free = list.filter((n) => !taken.has(n.toLowerCase()));
  if (free.length === 0) {
    let i = 2;
    while (taken.has(`${list[0]}${i}`.toLowerCase())) i += 1;
    return `${list[0]}${i}`;
  }
  return free[Math.floor(rng() * free.length)];
}

/** Pick `count` distinct defaults. */
export function pickNames(list, count, used = [], rng = Math.random) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(pickName(list, [...used, ...out], rng));
  return out;
}

/** Make `name` unique against `used` by appending a number. */
export function uniqueName(name, used = []) {
  const taken = new Set(used.map((u) => String(u).toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let i = 2;
  while (taken.has(`${name}${i}`.toLowerCase())) i += 1;
  return `${name}${i}`;
}
