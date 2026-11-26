# Changelog

## 1.1.0

Added
- Ratings loop: `cmk rate good|bad "<what>" ["<why>"]` logs to `memory/ratings.jsonl`; `cmk doctor` shows recent ratings and warns about bad ratings with no rule; the generated playbook now describes the full reward/penalty loop (log in the same turn, write a rule for every bad rating, review the log at session start and weekly).
- `cmk update`: refresh the playbook from the latest templates and re-check everything while keeping what the manager learned.
- Setup now offers to update an existing assistant instead of creating a second one.
- README: benefit-led headline, "Best with Claude Code Desktop", "Who it is for", platform steps for Windows, macOS and Linux, overview image.
- Contribution setup: CONTRIBUTING, code owners, PR and issue templates, CI on Ubuntu, macOS and Windows with Node 18, 20 and 22.

Changed
- The environment check recommends Claude Desktop and explains what terminal-only mode lacks.
- Install hints are specific to the operating system (Claude Code, git).
- The generated playbook uses one runnable command form (`npx claude-manager-kit ...`) everywhere and names the integration branch.
- Setup says so when cancelled with Ctrl-C.

Fixed
- `npm run check` failed on Windows (the shell does not expand `*.js`).
- Unknown options (for example the typo `--dryrun`) were ignored and could write real files. They are now refused.
- Setup wrote the home with every default when input ended early. It now writes nothing unless the summary is confirmed (use `--yes` for defaults).
- An invalid SSH target (for example one starting with a dash) was saved in the config. It is now skipped.
- Section underlines in the output no longer overrun short headings.

## 0.1.0 (never published)

Internal first version: setup wizard, `cmk doctor|usage|lead|join`, portable home folder.
