# claude-chief-of-staff: build spec (v1)

One command (`npx claude-chief-of-staff`) on Windows, macOS or Linux sets up a personal AI "chief of staff"
for Claude Code / Claude Desktop: one MANAGER session (the user's replica: triage, routing, replies in the
user's tone, board, reports) plus optional LEADS on extra Claude accounts and/or extra machines that run
the hands-on work. Generic: no company, product or person names anywhere. Open source, MIT.

## Principles
- Zero runtime dependencies (Node 18+ built-ins only: readline, child_process, fs, os, path). No postinstall script.
- Never stores or asks for passwords, tokens or API keys. Accounts sign in with Claude's own login; tools
  connect through their official connectors / OAuth; SSH uses the user's own keys.
- Works the same on Windows (PowerShell / cmd / Git Bash), macOS and Linux: use path, os.homedir(),
  spawn with shell:false where possible; detect platform for clipboard and "open" commands.
- Everything the assistant learns lives in ONE portable folder (the "home") so it can be copied to a new
  account or machine. Credentials never live in it.
- Safe defaults: propose-only mode, approvals for production, payments, permissions, external messages.

## Install and start
- `npx claude-chief-of-staff` (alias `npx claude-chief-of-staff setup`) runs the wizard.
- `npx claude-chief-of-staff <command>` afterwards (or `cos <command>` if installed globally: bin names
  `claude-chief-of-staff` and `cos`).
- Fallback one-liners in README for users without Node (install Node first, then npx).

## Wizard (interactive, plain questions, defaults in brackets, can be re-run safely)
1. Environment check, each with a clear pass/fail and fix hint: Node version, `claude` CLI on PATH and
   version, Claude Desktop installed (Windows: %LOCALAPPDATA%\AnthropicClaude or Start menu; macOS:
   /Applications/Claude.app; Linux: not available, say terminal mode), git, gh (optional), ssh (if needed).
2. About you: name, role, company type (free text, stored locally only), time zone (default from the OS),
   working hours, language(s) you write in.
3. Name your assistant (default random from a fun list, e.g. Atlas, Juno, Orion) and choose where its
   home folder goes (default: ~/<assistant-name>). The folder is created with that name.
4. Setup type, each explained in one or two lines, then checked:
   - Solo: one Claude account on this machine. The manager does everything with subagents.
   - Multi-account: extra Claude accounts on THIS machine (each gets its own login and runs headless
     "lead" sessions). Ask how many and a name for each (defaults from a fun list: Wolf, Falcon, Lynx...).
     For each account: create its config dir OUTSIDE the home (~/.claude-chief-of-staff/accounts/<name>),
     then run `claude` with CLAUDE_CONFIG_DIR set to it so the user logs in (/login, then /exit), then
     verify with `claude -p "/usage" --output-format text` (shows plan usage when logged in).
     Explain: the terminal/Desktop session uses the main account; leads use the extra accounts.
   - Multi-machine: other computers reachable over SSH. Ask a name (defaults: Beast, Titan, Forge...)
     and the SSH target (user@host) for each; test `ssh -o BatchMode=yes -o ConnectTimeout=10 <target>
     claude --version`; if it fails, explain (SSH keys / claude not installed) and print the one command
     to run on that machine: `npx claude-chief-of-staff join` (sets up that machine's lead).
   Mixed setups are allowed (accounts AND machines).
5. Tools (role -> choices; "none" allowed; "other" free text). For each choice show how it connects:
   - Chat: Google Chat (local MCP `google-chat-mcp-local` via `claude mcp add google-chat --scope user --
     npx -y google-chat-mcp-local@1.0.1`, plus its own setup steps), Slack (claude.ai connector),
     Microsoft Teams (claude.ai connector or Microsoft 365 connector), other.
   - Mail: Gmail (claude.ai connector), Outlook (Microsoft 365 connector), other.
   - Tasks: ClickUp, Jira/Confluence (Atlassian), Linear, Asana, GitHub Issues, other (claude.ai connectors).
   - Code: GitHub (gh CLI: check `gh auth status`), GitLab (glab), none.
   - Calendar: Google Calendar, Outlook calendar.
   - Meetings: transcripts from a recorder or meeting tool folder (path), or none.
   For claude.ai connectors the wizard cannot verify from the terminal: tell the user to enable them at
   claude.ai > Settings > Connectors, and record them as "to verify"; the manager verifies them on first run.
   Local MCPs and CLIs are added and verified by the wizard.
6. Autonomy per area (propose only / reply when context is known / act within guardrails), with the
   always-ask list fixed: production deploys, payments, permissions and access, deleting data, money,
   messages to senior people the user lists, anything external the user marks sensitive.
7. Schedules (all optional): morning and evening digest times, board refresh interval, daily tone
   learning, weekly report. Recorded in config; the manager creates them as Claude Desktop scheduled tasks
   on first run.
8. Models (defaults, editable): manager = opus (planning and decisions only), leads and development =
   sonnet, mechanical work (posting approved text, git/tracker plumbing, file moves) = haiku. Lead accounts
   get CLAUDE_CODE_SUBAGENT_MODEL=sonnet in their settings env.
9. Summary screen, confirm, then write everything (below), run `doctor`, and finish:
   - Copy the STARTER PROMPT to the clipboard (Windows: clip, macOS: pbcopy, Linux: wl-copy/xclip/xsel if
     present, else print it), and print: "Open Claude Desktop > Code > open folder <home> > paste".
   - Try to open Claude Desktop (Windows: start "" "claude://", macOS: open -a Claude, Linux: skip).

## Home folder layout (portable; copy it to move the assistant)
<home>/
  chief-of-staff.json        config: profile, setup type, accounts, machines, tools, autonomy, schedules, models
  CLAUDE.md                  the manager playbook (generated from templates + config)
  .claude/settings.json      project settings for the manager session: model opus, attribution off
  rules.md                   triage rules and guardrails (generated, user edits)
  tone/                      tone model, examples, feedback (filled by the manager over time)
  memory/state.md            the manager's notebook
  memory/ratings.jsonl       good/bad ratings and the rule learned from each
  board/                     board data files (open work, done, jobs, limits)
  leads/LEAD-RULES.md        rules every lead follows (generated)
  leads/<name>/brief-start.md and tasks.md per lead
  meetings/                  meeting notes and summaries (if a meeting source is set)
  STARTER-PROMPT.md          the first message for the manager session
  README.md                  what each file is, how to move the folder, how to re-run setup
Credentials: never in the home. Account config dirs live in ~/.claude-chief-of-staff/accounts/<name>.
Moving to a new machine: copy the home, run `npx claude-chief-of-staff setup --home <path>`; it keeps the
learned files and only re-does accounts, machines and tool connections.

## Helper commands (used by the manager session and by leads)
- `cos doctor`             re-check environment, accounts (logged in?), machines (reachable?), tools.
- `cos usage`              plan usage of every account and machine (`claude -p "/usage"`), JSON + table;
                           also writes <home>/board/limits.json.
- `cos lead start <lead> <job> <brief-file> [--model sonnet|opus|haiku] [--cwd <dir>]`
                           starts a headless job for that lead: local account (CLAUDE_CONFIG_DIR) or remote
                           machine (over SSH, `claude -p` on the remote with the brief streamed over stdin).
                           Saves session id, status, result, history under ~/.claude-chief-of-staff/jobs/<job>/.
                           Leads run with --permission-mode chosen in config (default: acceptEdits; bypass only
                           if the user explicitly chose it in the wizard, with a warning).
- `cos lead reply <job> <brief-file> [--model ...]`  continue a job (--resume, same cwd).
- `cos lead status [job]`, `cos lead result <job>`, `cos lead stop <job>`.
- `cos join`               run on a remote machine: checks claude login there, creates its lead folder.
- `cos setup`              the wizard (default command). `--home`, `--yes` (accept defaults), `--dry-run`.

## Generated content (templates in /templates, filled from config)
- CLAUDE.md (manager playbook), generic version of: intake and triage (every item ends done, ignored,
  waiting or dispatched), never answer for the user on high-stakes items, reply in the user's tone,
  one voice to the user, ratings and learning, digest and board rhythm, talk only to leads (never to their
  children), merges only after review, production only with explicit OK, small PRs and small commits,
  no AI attribution in commits/PRs, limit saving (fresh job per task, one dev job at a time per account,
  lean teams, targeted tests, check usage before starting work, stop at 85% of the 5-hour limit),
  meeting notes read after each meeting, always read code from the latest origin refs.
- LEAD-RULES.md: the generic lead rules (own dev and review children, merge into develop only after
  review, never production, models, teams, worktree reuse within one feature track, questions go to the
  manager with QUESTION:, reporting format).
- STARTER-PROMPT.md: tells the manager session to read CLAUDE.md, rules.md and the config; verify each
  connector with one read call; create the scheduled tasks; create the board (a claude.ai artifact if
  available, otherwise board/*.md); learn the tone from the user's recent sent messages in the chosen
  chat and mail tools (read only); start each lead with its brief; then run the first intake pass in
  propose mode and report.

## Quality bar
- Unit tests with node:test for: config building, name defaults, template rendering, path handling on
  win32/posix (path.win32/path.posix), job file handling, usage parsing (sample /usage text).
- `node --check` on every file; a `npm test` script; a `--dry-run` that writes into a temp dir.
- README: what it is, safety model, the three setup types with diagrams in text, install, what the wizard
  asks, the folder layout, moving to a new machine, helper commands, uninstall, FAQ. No em dashes.
- No company/person names; generic examples only.
