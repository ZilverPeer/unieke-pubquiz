---
description: Post-feature retrospective — review what was built, capture lessons in CLAUDE.md or skills, consolidate any bloat, and commit the improvements to the feature branch so they ship with the PR. Invoked from web-release-flow (step 4) or mobile-release-flow as part of the wrap-up; ends on the feature branch and hands control back to the calling flow for merge/deploy. Platform-agnostic — never switches branches itself.
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Bash(git status:*), Read, Edit, Write, Glob, Grep, Agent
---

## Context

- Current branch: !`git branch --show-current`
- Commits on this branch vs main: !`git log main..HEAD --oneline`
- Files changed vs main: !`git diff main..HEAD --name-only`

## Your task

The user has confirmed the feature works and the PR is open. Run a lightweight retrospective, capture any lessons, then commit the improvements to the feature branch so they ship with the PR.

### Step 1 — Review what was built

Look at the changed files and commits. For each area touched (migrations, services, components, actions, types), note anything that:
- Deviated from CLAUDE.md guidelines
- Required an unexpected workaround or a retry
- Revealed a missing assumption or a gap in the instructions

### Step 2 — Identify lessons worth keeping

Ask honestly:
1. Did anything fail or need a retry? (build errors, wrong DB assumptions, type errors, environment issues)
2. Was a step slower than it should be because instructions were missing or ambiguous?
3. Did a new recurring pattern emerge that isn't documented anywhere yet?
4. Was anything deployed to prod that was initially missed?

If the answer to any of these is yes, proceed to Step 3. If nothing noteworthy happened, skip to Step 4.

### Step 3 — Capture the lesson (follow this hierarchy strictly)

**A. Can an existing skill be improved to cover this?**
- Review the available skills listed in the system prompt.
- If yes: make the improvement directly to that skill file. Then proceed to Step 3D to validate it.

**B. Is this lesson broad enough to warrant a new standalone skill?**
- A skill makes sense if it's a multi-step workflow that will recur (e.g. "deploy a migration", "add a new Supabase table end-to-end").
- If yes: create the skill as `.claude/commands/<name>.md` following the `skill-development` best practices:
  - Frontmatter description uses third person: "This skill should be used when the user asks to..."
  - Body uses imperative/infinitive form (verb-first, not "you should")
  - Keep body lean (1,500–2,000 words); move detailed content to a `references/` subfolder if needed
  - Then proceed to Step 3D to validate it.

**C. Only if neither A nor B applies — add to CLAUDE.md**
- Project-specific rules, hard constraints, one-liners that don't warrant their own skill.
- Add under the most relevant existing section. One bullet per lesson. No editorializing.

**D. Validate any new or modified skill using the skill-reviewer agent**
- After writing or editing a skill (steps A or B), invoke the `skill-reviewer` agent from the `plugin-dev` plugin:
  ```
  Agent: skill-reviewer
  Task: Review the skill at <path-to-skill-file> and check if it follows best practices — trigger phrases, third-person description, imperative writing style, progressive disclosure, and lean body length.
  ```
- Apply any critical or major fixes the reviewer identifies before finishing.
- If the `plugin-dev` plugin is not installed, manually validate against this checklist:
  - [ ] Description uses third person with specific trigger phrases
  - [ ] Body is imperative/verb-first (not "you should")
  - [ ] Body is under 3,000 words
  - [ ] Detailed content is in a `references/` file, not inline
  - [ ] All referenced files exist

**E. If it's about how we prefer to collaborate** — save a feedback memory instead of touching any skill or CLAUDE.md.

### Step 4 — Consolidate CLAUDE.md (only if it was modified in Step 3)

If CLAUDE.md was not touched in Step 3, skip this step entirely.

Read CLAUDE.md in full and audit for bloat:
- **Near-duplicates:** Find bullets that say the same thing differently. Merge them into one.
- **Redundant specificity:** Find bullets so narrow they'll never recur. Either generalise or remove.
- **Trends:** If 3+ bullets across different sessions all guard against the same category of mistake (e.g. "check column names before using"), consolidate them into one structural rule rather than listing every instance.
- **Length check:** Count the bullets per section. If any section has more than 8 bullets, look for candidates to merge or promote to a skill.

Edit CLAUDE.md to apply consolidations. Do not remove information — compress it. Prefer one precise sentence over two vague ones.

### Step 5 — Commit improvements to the feature branch

If CLAUDE.md, any skill file, or any memory file was created or modified in Steps 3–4, commit those changes to the current feature branch so they are included in the PR and merged to main together with the feature.

```
git add CLAUDE.md .claude/commands/ .claude/projects/
git commit -m "Improve CLAUDE.md and skills based on retro for this feature"
git push
```

Only include files that were actually changed. Do not commit unrelated files.
If nothing was changed in Steps 3–4, skip this step.

### Step 6 — Report and hand back

Do **not** switch branches or merge. The calling release-flow (`web-release-flow` or `mobile-release-flow`) owns merge timing and the eventual return to `main`. End on the feature branch.

Tell the user:
- What lesson(s) were found (or "nothing noteworthy this time")
- Where each lesson was captured (skill improved / new skill created / CLAUDE.md updated / memory saved / skipped)
- Whether CLAUDE.md was consolidated and what was merged/removed
- Whether the skill-reviewer flagged anything and what was fixed
- Confirm the improvements were committed and pushed to the feature branch
- Hand control back to the calling release-flow for the next gate (merge for web, submit/deploy for mobile)
