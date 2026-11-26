// Tool catalog: which chat, mail, task, code and calendar tools the assistant can use and how each connects.
import { run, resolveCommand, claudeInvocation } from './platform.js';

export const ROLES = ['chat', 'mail', 'tasks', 'code', 'calendar'];

export const ROLE_LABELS = {
  chat: 'Chat',
  mail: 'Mail',
  tasks: 'Tasks and tickets',
  code: 'Code hosting',
  calendar: 'Calendar',
  meetings: 'Meeting transcripts',
};

/**
 * kind: 'connector' (claude.ai connector, enabled by the user in the web settings, verified by the manager),
 *       'mcp' (local MCP server the wizard can add with `claude mcp add`),
 *       'cli' (a command line tool the wizard can check).
 */
export const CATALOG = {
  chat: [
    {
      id: 'google-chat', label: 'Google Chat', kind: 'mcp', mcpName: 'google-chat',
      addArgs: ['mcp', 'add', 'google-chat', '--scope', 'user', '--', 'npx', '-y', 'google-chat-mcp-local@1.0.1'],
      steps: [
        'The local server needs a Google Cloud OAuth client of your own (Chat API enabled). Follow its README for the one-time sign-in.',
        'After it is added, open Claude and run /mcp to confirm "google-chat" is connected.',
      ],
    },
    { id: 'slack', label: 'Slack', kind: 'connector', steps: ['Enable the Slack connector at claude.ai > Settings > Connectors.'] },
    { id: 'teams', label: 'Microsoft Teams', kind: 'connector', steps: ['Enable the Microsoft Teams or Microsoft 365 connector at claude.ai > Settings > Connectors.'] },
  ],
  mail: [
    { id: 'gmail', label: 'Gmail', kind: 'connector', steps: ['Enable the Gmail connector at claude.ai > Settings > Connectors.'] },
    { id: 'outlook', label: 'Outlook', kind: 'connector', steps: ['Enable the Microsoft 365 connector at claude.ai > Settings > Connectors.'] },
  ],
  tasks: [
    { id: 'clickup', label: 'ClickUp', kind: 'connector', steps: ['Enable the ClickUp connector at claude.ai > Settings > Connectors.'] },
    { id: 'jira', label: 'Jira / Confluence (Atlassian)', kind: 'connector', steps: ['Enable the Atlassian connector at claude.ai > Settings > Connectors.'] },
    { id: 'linear', label: 'Linear', kind: 'connector', steps: ['Enable the Linear connector at claude.ai > Settings > Connectors.'] },
    { id: 'asana', label: 'Asana', kind: 'connector', steps: ['Enable the Asana connector at claude.ai > Settings > Connectors.'] },
    { id: 'github-issues', label: 'GitHub Issues', kind: 'cli', bin: 'gh', authArgs: ['auth', 'status'], steps: ['Install the GitHub CLI and run: gh auth login'] },
  ],
  code: [
    { id: 'github', label: 'GitHub (gh CLI)', kind: 'cli', bin: 'gh', authArgs: ['auth', 'status'], steps: ['Install the GitHub CLI (https://cli.github.com) and run: gh auth login'] },
    { id: 'gitlab', label: 'GitLab (glab CLI)', kind: 'cli', bin: 'glab', authArgs: ['auth', 'status'], steps: ['Install the GitLab CLI and run: glab auth login'] },
  ],
  calendar: [
    { id: 'google-calendar', label: 'Google Calendar', kind: 'connector', steps: ['Enable the Google Calendar connector at claude.ai > Settings > Connectors.'] },
    { id: 'outlook-calendar', label: 'Outlook calendar', kind: 'connector', steps: ['Enable the Microsoft 365 connector at claude.ai > Settings > Connectors.'] },
  ],
};

export function optionsFor(role) {
  return CATALOG[role] || [];
}

export function findTool(role, id) {
  return optionsFor(role).find((t) => t.id === id) || null;
}

/**
 * Turn raw wizard choices into config entries.
 * choice: catalog id, or "other:<free text>". Returns { id, label, kind, status }.
 */
export function toConfigEntry(role, choice) {
  if (typeof choice === 'string' && choice.startsWith('other:')) {
    const label = choice.slice(6).trim();
    return { id: 'other', label: label || 'other', kind: 'connector', status: 'to-verify' };
  }
  const t = findTool(role, choice);
  if (!t) return null;
  return { id: t.id, label: t.label, kind: t.kind, status: t.kind === 'connector' ? 'to-verify' : 'pending' };
}

/** Check a local tool: returns { ok, detail }. Connectors cannot be verified from a terminal. */
export function checkTool(entry, runner = run, has = resolveCommand) {
  const t = Object.values(CATALOG).flat().find((x) => x.id === entry.id);
  if (!t || t.kind === 'connector') return { ok: null, detail: 'to verify by the manager on first run' };
  if (t.kind === 'cli') {
    if (!has(t.bin)) return { ok: false, detail: `${t.bin} not found on PATH` };
    const r = runner(t.bin, t.authArgs, { timeout: 20000 });
    return r.ok ? { ok: true, detail: `${t.bin} is signed in` } : { ok: false, detail: `${t.bin} is installed but not signed in` };
  }
  if (t.kind === 'mcp') {
    const inv = claudeInvocation();
    if (!inv) return { ok: false, detail: 'claude CLI not found' };
    const r = runner(inv.cmd, [...inv.prefix, 'mcp', 'list'], { timeout: 60000 });
    const listed = r.ok && new RegExp(`(^|\\s)${t.mcpName}(:|\\s)`, 'm').test(r.stdout);
    return listed ? { ok: true, detail: `${t.mcpName} is registered with Claude Code` } : { ok: false, detail: `${t.mcpName} is not registered yet` };
  }
  return { ok: null, detail: 'unknown tool type' };
}

/** Register a local MCP server with Claude Code (user scope). */
export function addMcp(entry, runner = run) {
  const t = Object.values(CATALOG).flat().find((x) => x.id === entry.id);
  if (!t || t.kind !== 'mcp') return { ok: false, detail: 'not an MCP tool' };
  const inv = claudeInvocation();
  if (!inv) return { ok: false, detail: 'claude CLI not found' };
  const r = runner(inv.cmd, [...inv.prefix, ...t.addArgs], { timeout: 120000 });
  return { ok: r.ok, detail: (r.stdout || r.stderr || r.error || '').trim() };
}

/** Human readable "how it connects" text for the summary and README. */
export function connectionNotes(entry) {
  const t = Object.values(CATALOG).flat().find((x) => x.id === entry.id);
  if (!t) return [`Connect "${entry.label}" through a claude.ai connector or MCP server of your choice, then tell the manager.`];
  return t.steps;
}
