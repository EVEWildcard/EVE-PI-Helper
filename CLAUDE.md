# CLAUDE.md — EVE PI Helper

## Git workflow: one worktree per session, base off `dev`

**Every session works in its own git worktree with its own branch — never edit, commit, or
switch branches in the main checkout.**
**Base branch is always `dev`, not `main`.** `main` is production (Vercel auto-deploys it).

The main checkout (`C:\Users\Luciano Donati\EVE PI`) stays parked on `dev`, clean, at all
times. Its only jobs: host the worktrees under `.claude/worktrees/` and `git pull` the latest
`dev`. If you find uncommitted changes there, they belong to another session — leave them alone.

### Session start

- **Already inside a worktree** (cwd under `.claude/worktrees/`)? Keep using it.
- **In the main checkout?** Create a worktree before touching any file. Prefer the harness's
  worktree isolation (EnterWorktree / `isolation: "worktree"`) if available; otherwise:

  ```bash
  git fetch origin
  git worktree add .claude/worktrees/<slug> -b <type>/<slug> origin/dev
  ```

  (`<type>/<slug>` like `feat/haul-plan-stages`, `fix/chain-arrow-counts`.) Then do **all**
  work inside that directory.
- A fresh worktree has no `node_modules` — run `npm install` there before typecheck/tests/dev
  server. `.claude/worktrees/` is gitignored, so worktrees never show up as untracked files.

### The full cycle, run **without asking** once tests pass and the change is clean

1. Commit in the worktree → push: `git push -u origin <branch>`.
2. **Sync onto latest `dev` before opening the PR** (another session may have merged while
   yours was open): `git fetch origin && git rebase origin/dev`. Resolve any conflicts now —
   while you still have the context — not at merge time. Then force-push
   (`git push --force-with-lease`). If the rebase is messy, prefer `git merge origin/dev`.
3. Open a PR into `dev`: `gh pr create --base dev ...`.
4. Merge it: `gh pr merge <n> --squash`. **Don't use `--delete-branch` from inside a
   worktree** — after merging, gh tries to check out `dev` locally, which fails
   (`'dev' is already used by worktree ...`) and aborts before deleting the remote branch.
   Instead delete it explicitly: `git push origin --delete <branch>`.
5. **Promote to prod:** merge `dev` → `main` so it deploys. `gh pr create --base main --head dev ...`
   then `gh pr merge <n> --squash` (keep `dev`). **Whether to promote hands-off vs. wait for the
   user depends on the change — see the promotion policy below.**
6. **Clean up:** from the main checkout,
   `git worktree remove .claude/worktrees/<slug>` and `git branch -D <branch>` (`-D`, not
   `-d` — squash merges mean git can't see the branch as merged; confirm the PR merged
   first), then `git pull` on `dev`. (Harness-created worktrees clean themselves up via
   ExitWorktree.) If `git worktree remove` hits a Windows file lock ("Permission denied" /
   "in use"), it usually still deregisters the worktree — `git worktree prune`, carry on,
   and delete the leftover directory later once the lock is released.

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

### Why worktrees (and what they don't fix)

The old branch-per-session flow shared one working directory: concurrent sessions stepped on
each other's uncommitted files, and a `git checkout` in one session yanked the branch out from
under another. Worktrees remove that whole class of failure — each session gets its own
directory + branch, fully isolated until merge time.

What worktrees do **not** fix:

- **Stale base:** every worktree is cut from `dev` as it starts. If another session merges
  first, yours is based on an old `dev`. Step 2 (rebase/merge onto latest `dev` before the PR)
  resolves this while you still have context.
- **Overlapping edits:** two sessions editing the same lines of the same file will conflict no
  matter how isolated the working trees are — that's inherent to parallel work. Keep sessions
  short-lived and file-scoped; don't run concurrent sessions that touch the same files.

**`gh` isn't on PATH/authed here.** Call `"/c/Program Files/GitHub CLI/gh.exe"` from the **Bash
tool** with a token from the git credential helper:

```bash
export GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2-)
```

(PowerShell can't pipe stdin to `git credential fill` reliably — use Bash.)

## Typecheck

`tsc --noEmit` is a no-op (project refs). Use `tsc -p tsconfig.web.json --noEmit`.
Avoid `tsc -b` — it litters `.js`/`.d.ts` files.
