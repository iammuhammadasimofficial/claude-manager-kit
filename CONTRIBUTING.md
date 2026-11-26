# Contributing

Thanks for helping. The owner reviews and merges every pull request.

## How to contribute

1. Fork the repo and create a branch from `main` (for example `fix-usage-parsing`).
2. Make **one small change** per pull request: one fix, one feature, one doc update. Commit each step with a clear message.
3. Run `npm test` and `npm run check` (both must pass). Add or update tests for what you change.
4. Open a pull request using the template. CI runs the tests on Ubuntu, macOS and Windows with Node 18, 20 and 22.
5. A code owner review is required before merge. Squash merge is used.

## Rules

- **Zero runtime dependencies** and no install scripts. Node 18+ built-ins only.
- Never ask for, store or print passwords, tokens or API keys.
- Keep it generic: no company, product or person names (a test enforces this).
- No em dashes anywhere in code, docs or messages. Plain punctuation only.
- **No AI attribution** in commits, pull request titles or descriptions: no "Generated with" lines and no "Co-Authored-By" lines naming an assistant.
- Do not force push to shared branches.
- Behavior changes need a README or CHANGELOG line.

## Testing on your platform

The author tests on Windows. If you use macOS or Linux, reports and fixes for the platform steps in the README are especially welcome.

## Security

If you find a security problem, do not open a public issue. Contact the owner through the profile on GitHub.
