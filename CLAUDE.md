# CLAUDE.md — EVE PI Helper

## Git workflow: GitHub Flow, one branch per session, base off `dev`

**Every session works on its own feature branch — never commit directly to `dev` or `main`.**
**Base branch is always `dev`, not `main`.** `main` is production (Vercel auto-deploys it).

At the start of a session, if you're on `dev`/`main`, create a feature branch off `dev` before
making changes (e.g. `feat/haul-plan-stages`, `fix/chain-arrow-counts`). If the session already
starts on a feature branch, keep using it. Do all commits for the session's work on that branch.

The full cycle, run **without asking** once tests pass and the change is clean:

1. Branch off `dev` (once per session, if not already on a feature branch).
2. Commit → push to that branch.
3. Open a PR into `dev`: `gh pr create --base dev ...`.
4. Merge it: `gh pr merge <n> --squash --delete-branch` (deletes the remote branch).
5. **Promote to prod:** merge `dev` → `main` so it deploys. `gh pr create --base main --head dev ...`
   then `gh pr merge <n> --squash` (keep `dev`). **Whether to promote hands-off vs. wait for the
   user depends on the change — see the promotion policy below.**
6. **Delete the local feature branch** after it's merged: `git branch -d <branch>`.
   Switch back to `dev` and `git pull` before starting the next thing.

### Promotion policy: when to auto-promote `dev` → `main` vs. wait

After merging into `dev`, decide based on the nature of the change:

- **README / docs changes:** do **not** auto-promote. Tell the user to look at the preview env
  (the `dev` deploy URL). If they like it, then promote to `main`.
- **Code changes sized small / trivial / medium:** auto-promote to `main` hands-off, no need to ask.
- **Everything else** (large, risky, user-facing behavior changes, anything you're unsure about):
  do **not** promote silently. Either ask the user "auto-promote or check preview first?" or tell
  them to verify in preview before you ship it.

When in doubt, don't auto-promote — ask.

Both `dev` and `main` track the same commits after promotion; `dev` gives a preview URL and a
staging step, `main` is prod.

**`gh` isn't on PATH/authed here.** Call `"/c/Program Files/GitHub CLI/gh.exe"` from the **Bash
tool** with a token from the git credential helper:

```bash
export GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2-)
```

(PowerShell can't pipe stdin to `git credential fill` reliably — use Bash.)

## Typecheck

`tsc --noEmit` is a no-op (project refs). Use `tsc -p tsconfig.web.json --noEmit`.
Avoid `tsc -b` — it litters `.js`/`.d.ts` files.
