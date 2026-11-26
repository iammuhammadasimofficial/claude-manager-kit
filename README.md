# claude-manager-kit

A manager for Claude Code: your personal AI manager. One command sets up a long-lived **manager** session
for Claude Code / Claude Desktop that triages your chat, mail and tasks, replies in your tone, keeps a board,
and sends the hands-on work to optional **leads** running on extra Claude accounts and/or other machines.

- Zero runtime dependencies, Node 18+, no postinstall script. Works on Windows, macOS and Linux.
- MIT licensed.

## Safety model

- **No passwords, tokens or API keys are ever asked for, stored or printed.** Accounts sign in with Claude's own
  login. Tools connect through their official connectors or OAuth. SSH uses your own keys.
- Credentials never live in the assistant's home folder. Account logins live in `~/.claude-manager-kit/accounts/<name>/`.
- Every area starts in **propose only** mode: the manager says what it would do and waits.
- A fixed **always-ask list** applies in every mode: production deploys, payments and money, permissions and
  access, deleting data, messages to senior people you list, anything external you mark as sensitive.
- Leads run headless with permission mode `acceptEdits` by default. `bypassPermissions` is used only if you choose it
  in the wizard, with a warning.
- Commits and PRs carry no AI attribution (settings are written for the manager and for every lead account).

## The three setup types

```
Solo                       Multi-account                      Multi-machine
+-----------------+        +-----------------+                +-----------------+
| Manager         |        | Manager         |                | Manager         |
| (your account)  |        | (your account)  |                | (your account)  |
| + subagents     |        +--------+--------+                +--------+--------+
+-----------------+                 | headless claude -p               | ssh + claude -p
                             +------+-------+                   +------+-------+
                             |              |                   |              |
                          Lead "Wolf"    Lead "Lynx"          Lead "Beast"  Lead "Titan"
                          (extra Claude  (extra Claude        (other computer, its own login)
                           account, here) account, here)
```

Mixed setups (accounts and machines together) are allowed. The terminal and Desktop session uses your main
account; leads use the extra accounts or machines. Plan limits are per account, which is the point of extra accounts.

## Install and start

```
npx claude-manager-kit
```

`npx claude-manager-kit setup` does the same. After that use `npx claude-manager-kit <command>`, or install it
globally and use the short alias:

```
npm install -g claude-manager-kit
cmk doctor
```

No Node yet? Install it first, then run the command above:

- Windows: `winget install OpenJS.NodeJS.LTS` (or the installer from https://nodejs.org)
- macOS: `brew install node`
- Linux: use your package manager, or https://nodejs.org

## What the wizard asks

Defaults are in brackets. It is safe to re-run. `--yes` accepts every default, `--dry-run` writes into a temp folder
and runs no logins, ssh or clipboard.

1. **Environment check**: Node, Claude Code CLI, Claude Desktop, git, gh (optional), ssh (if needed), with fix hints.
2. **About you**: name, role, company type (free text, stored locally), time zone, working hours, languages.
3. **Your assistant**: a name (random fun default) and its home folder (`~/<name>`).
4. **Setup type**: solo, multi-account or multi-machine (or both). For each extra account the wizard creates its config
   dir, hands the terminal to `claude` so you can `/login` and `/exit`, then verifies with `claude -p "/usage"`.
   For each machine it tests `ssh -o BatchMode=yes ... claude --version` and, if that fails, explains why and prints
   `npx claude-manager-kit join` to run on that machine.
5. **Tools** per role (or none): chat (Google Chat, Slack, Teams), mail (Gmail, Outlook), tasks (ClickUp, Jira, Linear,
   Asana, GitHub Issues), code (GitHub, GitLab), calendar, and a meeting transcripts folder. claude.ai connectors cannot
   be verified from a terminal: enable them at claude.ai > Settings > Connectors; they are recorded as "to verify" and the
   manager checks them on its first run. Local MCP servers and CLIs are added and verified by the wizard.
6. **Autonomy** per area: propose only, reply when the context is known, or act within guardrails. Plus your senior
   people and sensitive topics.
7. **Schedules** (optional): digests, board refresh, daily tone learning, weekly report. The manager creates them as
   Claude Desktop scheduled tasks on its first run.
8. **Models**: manager `opus` (planning and decisions only), leads and development `sonnet`, mechanical work `haiku`.
9. **Summary**, confirm, write, run `doctor`, copy the starter prompt to the clipboard, and try to open Claude Desktop.

Then: **Claude Desktop > Code > open folder `<home>` > paste.** On Linux (no Desktop): `cd <home> && claude`, paste.

## The home folder

```
<home>/
  manager-kit.json     config: profile, setup type, accounts, machines, tools, autonomy, schedules, models
  CLAUDE.md            the manager playbook (generated)
  .claude/settings.json  model opus, no AI attribution
  rules.md             triage rules and guardrails (yours to edit; never overwritten)
  tone/                tone model, examples, feedback (filled over time)
  memory/state.md      the manager's notebook
  memory/ratings.jsonl good and bad ratings and the rule learned from each
  board/               open work, done, jobs, plan limits
  leads/LEAD-RULES.md  rules every lead follows
  leads/<name>/        brief-start.md and tasks.md per lead
  meetings/            meeting notes (when a meeting source is set)
  STARTER-PROMPT.md    the first message for the manager session
  README.md            what each file is
```

## Moving to a new machine or account

Copy the home folder, then run `npx claude-manager-kit setup --home <path>`. It keeps the learned files (tone,
memory, ratings, tasks, rules) and only re-does accounts, machines and tool connections, because those belong to
each computer. A changed `CLAUDE.md` is saved as `CLAUDE.md.bak` before it is regenerated.

## Helper commands

```
cmk doctor                                   re-check environment, accounts, machines, tools
cmk usage [--json]                           plan usage of every account and machine; writes board/limits.json
cmk lead start <lead> <job> <brief-file> [--model sonnet|opus|haiku] [--cwd <dir>] [--wait]
cmk lead reply <job> <brief-file> [--model ...]   continue a job (--resume, same folder)
cmk lead status [job]
cmk lead result <job>
cmk lead stop <job>
cmk join [--name <name>] [--yes]             run on a remote machine to set up its lead
cmk setup [--home <path>] [--yes] [--dry-run]
```

Jobs run in the background. Their files live in `~/.claude-manager-kit/jobs/<job>/`: `prompt.txt`, `status.txt`
(running, done, failed, stopped), `session.txt`, `result.md`, `history.md`, `err.log`. The brief is always sent on
stdin, never on a command line. For a machine lead the job runs `claude -p` over SSH with the brief streamed to it.
A result that ends with a `QUESTION:` line is a question for the manager.

Environment variables: `CMK_HOME` (assistant home), `CMK_ROOT` (where accounts and jobs live), `CMK_ASCII=1`
(plain ASCII symbols), `CMK_CLAUDE_BIN` and `CMK_CLAUDE_BIN_ARGS` (use a different claude executable).

## Uninstall

1. Delete the home folder (it holds only what the assistant learned).
2. Delete `~/.claude-manager-kit/` (account config dirs and job files). Signing out of an extra account first
   (`claude` with its `CLAUDE_CONFIG_DIR`, then `/logout`) is optional.
3. `npm uninstall -g claude-manager-kit` if you installed it globally.
4. Remove the Claude Desktop scheduled tasks the manager created, and any MCP server you added
   (`claude mcp remove google-chat`).

## FAQ

**Does it need an API key?** No. It uses your Claude plan through Claude Code and Claude Desktop.

**Does it send my data anywhere?** The tool itself makes no network calls. Claude and your connectors work as usual.
The config (including company type and names) stays on your disk.

**Why extra accounts?** Plan limits are per account. Leads on their own accounts keep the manager's budget free.
Use accounts you are allowed to use under Anthropic's terms.

**How do I stop a runaway lead?** `cmk lead stop <job>`, or stop at 85 percent of the 5-hour limit: the playbook tells
the manager to check `cmk usage` before starting work.

**Windows notes?** `claude` may be `claude.cmd` or `claude.exe`; the tool finds it with `where`. For a Windows
machine reached over SSH, the OpenSSH default shell (cmd.exe) is detected automatically.

**Can I edit the playbook?** Edit `rules.md` freely. `CLAUDE.md` is regenerated by setup; put lasting rules in
`rules.md` or in `memory/state.md`.

## Development

```
npm test        # node --test
npm run check   # node --check on every file
```

## License

MIT
