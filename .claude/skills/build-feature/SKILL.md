---
name: build-feature
description: Orchestrate building a feature with a developer in the loop, routing to Matt Pocock skills based on feature size and where uncertainty lives. The orchestrator never reads code or writes feature code itself — it dispatches Haiku for exploration and Sonnet subagents for coding, staying lean. Use when the user wants to start a new feature, says "let's build X", "add Y", "create a Z tab/page/component", or otherwise begins feature work larger than a one-line fix. Not for greenfield "what should this product be?" — grill directly for that.
---

# Build Feature

Coordinate the full lifecycle of a feature built _with_ a developer — never solo, never AFK. The job is to route to the right specialist skill at each stage, with explicit pivot checkpoints because the developer can change their mind mid-feature.

This skill **invokes other skills and dispatches subagents**; it does not do the work itself. Announce the target skill before each invocation, Matt-style: _"I'm using `<skill>` to <purpose>."_

## Two hard rules for the orchestrator

These keep the orchestrator's context lean. They are not optional.

1. **Never read the codebase yourself for exploration.** Dispatch an `Explore` subagent on **Haiku** and consume only its conclusions — never raw file dumps. This applies at Frame, during grilling, and before slicing.
2. **Never write feature code yourself.** Each dispatched slice goes to a **coding subagent on Sonnet** that reads the issue + linked ADR and returns a summary. The orchestrator grills, slices, dispatches, and runs checkpoints — it does not hold file contents or hand-edit feature code.

(Model routing matches the project default: search/read → Haiku, code → Sonnet.)

## Glossary

Use these terms exactly. Drift weakens the routing.

- **Size** — `S` / `M` / `L`. Classified at Frame; drives ceremony.
  - **S** — a single small surface. One file or one tight cluster (new tab, one button, copy change).
  - **M** — a self-contained feature touching a handful of files in one area (a login page, a new modal flow, a new server action + UI pair).
  - **L** — a cross-cutting concern or a new shared abstraction (a reusable table component, a notification subsystem, a new domain concept).
- **Uncertainty type** — where the unknown lives. Determines whether to Explore, and how.
  - **UX** — "I don't know how this should feel or look."
  - **Data/state** — "I don't know what the model or transitions should be."
  - **Edge cases** — "I know the shape, but I'm unsure about the corners."
  - **None** — the developer already knows what they want.
- **Stable core** — business logic, services, domain rules. Survives pivots. Earns TDD.
- **Volatile shell** — UI, layout, copy, wiring. Likely to be redesigned. TDD here wastes effort the next pivot throws away.
- **Decision doc (ADR / CONTEXT)** — the _why_. Written by `grill-with-docs` only when a decision crystallizes. Frequently absent. Never a work order on its own.
- **Execution spec** — the _what + done_. A dispatchable vertical slice with acceptance criteria, published as a tracker issue by `to-issues`. References the ADR when one exists. This is what a coding subagent executes from.
- **Pivot checkpoint** — a deliberate pause between slices: _"is the plan still right?"_ Load-bearing — this is what makes the high pivot rate tractable instead of catastrophic.

## Process

### 0. Branch check (always)

Before framing, verify you're on an appropriate feature branch:

1. Run `git fetch origin`, then check `git status` and `git branch --show-current`.
2. If on `main`: create `feat/<description>` from `origin/main`. Never frame work on `main`. Uncommitted changes already in the tree carry over with `git checkout -b` — no stash needed.
3. If on an existing `feat/*` branch:
   - Check if its PR is merged: `gh pr list --state merged --head <branch>`.
   - If merged → return to `main`, `git pull`, create a fresh branch.
   - If still open → **ask the developer**: continue on the existing branch, or start a new one? Don't assume.

The cheapest checkpoint in the flow — skipping it forces awkward branch surgery mid-feature.

### 1. Frame (always)

**Dispatch a Haiku `Explore` agent** to read the feature request's relevant code area and report back; do not read it yourself. From its conclusions, produce a one-paragraph frame:

- **Target app**: Always ask `web` (`app/**`) or `mobile` (`apps/mobile/**`). Never skip this question.
- **Size**: `S` / `M` / `L` — propose, ask the developer to confirm or override.
- **Uncertainty**: which type dominates (`UX` / `Data` / `Edge` / `None`).
- **Stable core vs Volatile shell**: name them explicitly. "The phase-transition logic is core; the modal layout is shell."

If `CONTEXT.md` exists, use its vocabulary. If the feature introduces a concept not in `CONTEXT.md` and Size is `M` or `L`, flag it — it must be added during the work, not after.

Ask the developer to confirm the frame before moving on. No code yet.

### 2. Explore (skip if Uncertainty is `None`)

Each uncertainty type has a **lead** tool and a **support** tool. The lead comes first; the support is invoked only if the lead surfaces a question it can't resolve.

- **UX** — lead with `prototype` (UI branch), support with `grill-with-docs`.
  Grilling someone about a UI they haven't seen produces lies. Show two or three radically different variants on one route, let the developer point, _then_ grill on the trade-offs. Never grill UX first.
- **Data/state** — lead with `grill-with-docs`, support with `prototype` (logic branch).
  Talk the state machine through. If a transition resists being argued about — "I'd have to see it" — spin up a logic prototype for that transition, then return to grilling. Use `grill-me` when the question is broader than the model itself.
- **Edge cases** — lead with `grill-with-docs`, prototype rarely needed.
  Stress-test adversarially. Prototype only if a specific edge case demands seeing the system run.

Explore ends when the developer says "this feels right." `grill-with-docs` writes any crystallized **decision** into an ADR or `CONTEXT.md` inline — but only if a decision actually crystallized. "This fits the existing model" is a valid outcome with no ADR. The _decision_ is what survives; the prototype is throwaway.

### 3. Lock (skip for `S`)

For `M` and `L`, turn the locked design into **dispatchable execution specs**:

1. Ensure every crystallized decision is in an ADR / `CONTEXT.md` (`grill-with-docs` already did this in Explore; confirm nothing is missing).
2. _(L only, optional)_ `to-prd` first if the feature is large enough to warrant a PRD umbrella.
3. Invoke **`to-issues`** to break the design into tracer-bullet vertical slices and publish them to the tracker. Each slice carries acceptance criteria, a `blocked-by` order, an `AFK`/`HITL` tag, and a link to the ADR when one exists. **This issue — not the ADR — is what a coding subagent executes from.**

Each published slice must be tagged **stable core** or **volatile shell** so Build knows how to dispatch it. If `to-issues` can't tell, the design isn't crisp enough — return to Explore.

For `S`, skip the tracker. A two-line shared understanding ("we're adding tab X with content Y, wired in `<file>`") is enough; implement it directly without a subagent — dispatch overhead exceeds the work.

### 4. Build

Slice-by-slice, in dependency order. For each slice:

1. **HITL slice** → handle with the developer directly (architectural call, design review). Not dispatched.
2. **AFK slice** → **dispatch a Sonnet coding subagent** with the issue body + linked ADR. The orchestrator does not write the code.
   - **Stable core** → instruct the subagent to use `tdd` (red-green-refactor inside the slice). Tests survive pivots.
   - **Volatile shell** → instruct the subagent to build against the `frontend` skill and the slice's acceptance criteria. No TDD — the next pivot would collect that tax.
3. **Dev server must be running for any browser-testable slice — no exceptions.** Before the pivot checkpoint, check `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`; anything other than connection-refused means it's up. If not, launch `npm run dev` in the background so the developer can verify while answering. Don't poll — Next.js prints `Ready` to the log when up.
4. **Pivot checkpoint** (strict mode — every slice). Before the next slice, ask verbatim:

   > _"We just finished `<slice>`. Is the rest of the plan still right, or do you want to adjust before the next slice?"_

   The answer is the input to the next slice.

If a pivot rewrites enough that the **stable core / volatile shell** split changes, return to **Lock** and re-slice via `to-issues` rather than mutating issues in place.

### 5. Verify (always)

Invoke **`review`** before claiming done — it checks the branch on both axes (Standards: does it follow repo conventions? Spec: does it match what the issues asked for?). Add **`qa`** if the feature is user-facing and you want a bug sweep. Includes `S` — no exceptions.

## Routing table

| Decision                    | Skill / action                                            |
| --------------------------- | --------------------------------------------------------- |
| Explore the codebase        | **Haiku `Explore` subagent** — never read it yourself     |
| UX is uncertain             | `prototype` (UI) leads, `grill-with-docs` supports        |
| Data/state is uncertain     | `grill-with-docs` leads, `prototype` (logic) supports — or `grill-me` if broader |
| Edge cases are uncertain    | `grill-with-docs` — prototype only if a specific edge needs seeing |
| Record a decision           | `grill-with-docs` → ADR / `CONTEXT.md` (only if one crystallized) |
| Produce execution specs (`M`/`L`) | `to-issues` (`to-prd` first for large `L`)          |
| Implement a slice           | **Sonnet coding subagent** off the issue — never code it yourself |
| Stable-core slice           | subagent runs `tdd`                                       |
| Volatile-shell slice        | subagent builds against `frontend` skill + acceptance criteria |
| Claiming done               | `review` (+ `qa` if user-facing)                          |

## Strict mode (default)

- Pivot checkpoint after **every** slice, not just plan-shape changes.
- Frame confirmation before any code is written, even for `S`.
- The two hard orchestrator rules (Haiku-explore, Sonnet-code) are not waivable.
- Verification before completion is not optional.

To loosen later, candidates are: pivot only at plan-shape changes; skip frame confirmation for `S`; allow ad-hoc verification on `S`. Don't loosen until the workflow has proven itself across several features.

## What this skill does not do

- **Not for greenfield "what is this product?"** — grill directly (`grill-me`). This skill assumes a feature request already exists.
- **Not for AFK execution.** The developer is in the loop on every slice. `to-issues` publishes to the tracker here as the dispatch artifact for _in-session_ subagents — not as an unattended queue. Parking a feature for an unattended agent is a separate, deliberate gesture.
- **Not for architecture review.** For "is the codebase getting messy?" use `improve-codebase-architecture`.
- **Not for bugs.** For "X is broken / throwing / failing," use `diagnose`.
