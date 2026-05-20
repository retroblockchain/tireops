# Content Log

Raw material from the tireops build. Each entry is a narratively-complete moment — a security fix, a guardrail added, a integration wired up. Plain English, date-stamped. The owner turns these into his own voice for posts.

---

## 2026-05-19 — Investigated a security alarm; the alarm was wrong

Started the session expecting to fix an "actively bleeding" security issue: a prior handoff brief claimed `.env.local` was committed to git with live Anthropic, OpenAI, and Supabase keys, and that the keys needed urgent rotation.

Ran the verification before the panic:

```
git ls-files -- ".env*"                    # empty
git log --all --diff-filter=A -- ".env*"   # empty
git check-ignore -v .env.local             # matched by .gitignore line 34
```

`.env.local` exists on disk (it has to — the app needs the values to run) but it has never been in any commit on any branch. The `.gitignore` already had `.env*` covered. The brief's "survey" had misread the situation.

Updated the brief to reflect reality: §8 now reads "Env file status (verified 2026-05-19)" instead of "⚠️ Security Issue." §13 and §14 cleaned up to match.

**The lesson worth keeping:** a handoff document is a snapshot, and snapshots can be wrong. Verify before you rotate. It would have been easy to burn an hour rotating three sets of keys and rewriting git history for an issue that didn't exist.
