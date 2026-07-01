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
3. **Sync onto latest `dev` before opening the PR** (avoids collisions with sessions that
   merged while yours was open): `git fetch origin && git rebase origin/dev`. Resolve any
   conflicts now — while you still have the context — not at merge time. Then force-push the
   branch (`git push --force-with-lease`). If the branch is long-lived or the rebase is messy,
   prefer `git merge origin/dev` instead of rebase.
4. Open a PR into `dev`: `gh pr create --base dev ...`.
5. Merge it: `gh pr merge <n> --squash --delete-branch` (deletes the remote branch).
6. **Promote to prod:** merge `dev` → `main` so it deploys. `gh pr create --base main --head dev ...`
   then `gh pr merge <n> --squash` (keep `dev`). **Whether to promote hands-off vs. wait for the
   user depends on the change — see the promotion policy below.**
7. **Delete the local feature branch** after it's merged: `git branch -d <branch>`.
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

After a squash-promote, `dev` and `main` are **content-equal but not history-equal** — the
squash creates a new commit on `main` with its own SHA, so the two branches diverge in history
even though the working tree matches. That's expected. `dev` gives a preview URL and a staging
step, `main` is prod.

### Why sessions collide (and how the steps above prevent it)

Branch-per-session stops sessions from *overwriting* each other; it does **not** stop *conflicts*.
Two things cause collisions:

- **Stale base:** every session branches off `dev` as it starts. If another session merges first,
  `dev` moves ahead and your branch is now based on an old `dev`. Step 3 (rebase/merge onto latest
  `dev` before the PR) resolves this while you still have context.
- **Overlapping edits:** two sessions editing the same lines of the same file will conflict no
  matter how clean the branching is — that's inherent to parallel work. Keep branches short-lived
  and file-scoped; don't run concurrent sessions that touch the same files.

**`gh` isn't on PATH/authed here.** Call `"/c/Program Files/GitHub CLI/gh.exe"` from the **Bash
tool** with a token from the git credential helper:

```bash
export GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2-)
```

(PowerShell can't pipe stdin to `git credential fill` reliably — use Bash.)

## Typecheck

`tsc --noEmit` is a no-op (project refs). Use `tsc -p tsconfig.web.json --noEmit`.
Avoid `tsc -b` — it litters `.js`/`.d.ts` files.
