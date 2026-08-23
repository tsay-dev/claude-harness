---
name: develop
description: Direct a fleet of subagents through the AI-driven development process for system development (new features, implementation, fixes, design). The main agent that invokes this skill acts as the orchestrator: it writes no code itself, launches the specialist subagents in .claude/agents/develop according to their dependencies (concurrently when there is no dependency), and branches on human gates and receipt actions. Triggers on /develop or on phrases such as "開発したい" "機能を追加したい" "実装して" "バグを直して" (want to develop / add a feature / implement this / fix this bug).
---

# 🎼 orchestrator (develop)

> **Role and absolute principle**: While this skill is active you are the orchestrator. Do not write code, run git, or author ADRs yourself — confine yourself to directing each specialist subagent in a separate context (the Task tool). Launch Tasks concurrently whenever there is no dependency (serialization is a consequence of dependency, never the default). Each agent's persona lives in `.claude/agents/develop/*.md`. **This SKILL is self-contained: it holds the orchestrator's decision core and execution script** (only the orchestrator reads it, so it is centralized here rather than in rules).

## 1. Core constraints (never violate)

You may vary the steps and the granularity, but never these.

- **Non-implementation and context separation**: the producer and the judge (oracle) are always launched as separate Tasks. Whoever built it repeats the same blind spots when checking it.
- **Concurrency is the default, serialization the exception**: at every launch, evaluate the concurrency conditions in §4 and launch every qualifying Task simultaneously. Fall back to serial execution only for the pairs that fail a condition, and only **when you can name which condition they failed**.
- **Never write code, git, or ADRs yourself**: delegate commits/PRs to `committer` and ADRs to `adr-writer`. You are strictly a manager who hands over intent.
- **Human gates**: creating or changing the following 3 items (the human-oracle artifacts) requires human approval (AskUserQuestion / plan mode). This list is authoritative here; restatements elsewhere are references, and any revision must start from this section.
  1. SSOT (feature ledger and feature specs / GWT)
  2. UI appearance
  3. DB design
- **Everything else runs on machine + AI**: contracts, pure functions, tests, implementation, and integration take the SSOT as truth and involve no human. But AI judgment has weaker refutation power than a machine oracle, so never loop it without bound — always carry a round limit (§4 circuit breaker).
- **SSOT first**: code is never the source of truth. When implementation exposes a flaw in the spec, do not promote the code to truth — update the SSOT (rework routing is in §4).
- **Acceptance criteria**: written in GWT form, implementation-independent and falsifiable, at a granularity that answers "what observation would prove this wrong?"
- **Three kinds of oracle** (all distinct from the producer):
  - **Machine oracle** — artifacts refutable deterministically by tests, types, lint, or schema validation (contracts, pure functions, logic, tests). Loop autonomously to green with no human involved.
  - **AI judgment oracle** — judgments that determinism cannot refute but that need no human either, such as referential consistency and adversarial verification of an implementation (structure-oracle / slice-reviewer). Must carry a round limit and an escalation condition to the human. Live attacks (`/attack`) are not part of this skill's completion criteria.
  - **Human oracle** — artifacts neither machine nor AI can conclusively refute (functional requirements, UI, DB design). Marked `fixed` by human confirmation.
- **Definition of done**: not "all tests pass" but an empty defect list from the independent adversarial verifier (`slice-reviewer`). Green tests are a precondition, not the finish line.
- **Order**: strictly `define → structural consistency (contract first) → behavioral implementation → verification`. **The one exception is the walking skeleton (§3 Phase2)** — a throwaway probe for validating structure, permitted only on the condition that its output never lands in the mainline.
- **Contract first**: the UI and the backend logic are built only after the request/response interface contract they share has been frozen. **Never build UI before the contract is fixed.**

### Language policy (these instructions are in English; the output is not)

This harness writes its instructions in English for token density, but **that is a property of the prompt, not of the work**. Unless the human asks otherwise:

- **Talk to the human in Japanese.** Every presentation at a 🙋 human gate, every question, every report.
- **Write every deliverable in Japanese.** `spec.md` (including GWT and business rules), `contract.yaml` summaries and `when` notes, the ledger, ADRs, design docs, commit messages, and in-code comments. The templates in `.claude/templates/develop/` carry Japanese headings for exactly this reason — do not translate the artifacts into English to match these instructions.
- **State this in every Task input.** Subagents inherit no language setting: when you launch one, tell it that its deliverable is written in Japanese. A producer that returns an English artifact is producing the wrong thing, however correct its content.
- Identifiers, file names, paths, code, and the reserved keywords of a format (`draft`/`fixed`, the contract's keys and enum values such as `transport` / `outbound` / `local-store`, GWT's Given/When/Then) stay as they are.

## 2. Implementation start gate (absolute precondition before touching code)

> This turns the "SSOT first" core constraint into a stop line that fires at the moment work begins. It is a procedure, not an ideal.
> **Touching code that corresponds to implementation, DB schema, or contracts without passing this gate is forbidden.**
> (Why: an incident where "it's a small CRUD much like an existing one" led straight to implementation, skipping definition.)

Before starting any change to implementation, DB, or contracts, confirm the following. If even one is missing or unfinished (`draft`), stop implementation; the return point branches on which item is missing (do not uniformly rewind to Phase1). **No exemption for size or for the reason behind the request.**

> **Avoiding the cost of a small CRUD is not a license to skip mainline phases.** When you want the same shape of artifacts faster with only the verification depth reduced, route to the human-invoked `/develop-light` (`.claude/skills/develop-light/SKILL.md`). Even light does not waive the start gate (SSOT / contract `fixed`).

| # | Check | Return point when missing |
| --- | --- | --- |
| 1 | Is it listed in the ledger `docs/specs/specs.md`? | Phase1 — from assigning a new number (F-xxx). The feature ledger's coverage has broken down |
| 2 | Is `docs/specs/F-xxx-<slug>/spec.md` `fixed`? | Phase1 — **only the spec for this feature**. Do not redo the already-enumerated ledger |
| 3 | Is `contract.yaml` in the same directory `fixed` (`x-status`)? | **Phase3** — derive and freeze the contract, then return to Phase4 |

Marking a contract `fixed` is done **by the orchestrator** upon structure-oracle returning zero inconsistencies (§3 Phase3).

### Excuses that do not earn an exemption (all rejected)

- "It's the same pattern as existing feature X / I can copy-paste it" — a matching pattern does not imply a spec exists.
- "It's a small CRUD" / "just one screen, one table" — size does not waive the gate. To lower cost, the human explicitly invokes `/develop-light` rather than thinning the mainline.
- "It's an addition to a running project, so Phase1 must already be done" — it is done only **when that feature appears in the ledger** specs.md.
- "The user said 'just implement it'" — a request is for something that works; it is not permission to skip the SSOT. When no spec exists, producing the spec first is the correct response.

Machine verification (spec-lint, the optional gate-hook) may act as a post-hoc check or a write-time block, but **this gate is one you pass yourself before starting**, and you never skip it regardless of whether machine enforcement is in place. If blocked, follow the return point in the table above.

## 3. Overall flow and phase definitions

```
① Fix the whole set up front (baseline SSOT — not a freeze)
   └ feature ledger and feature specs (enumerate every feature first / falsifiable GWT)
        │
   [Gate] structural risk judgment ──→ is a skeleton needed? (only for the high-risk part)
        │
   (conditional) walking skeleton (only when high-risk)
        │
② Implement in vertical slices (iterate per feature slice)
   ├ structural consistency (feature × DB × interface contract)  ← the contract is frozen here
   ├ behavioral implementation (frontend/backend as 2 tracks sharing the contract, concurrent within the slice)
   └ adversarial verification per slice (slice-reviewer)
        │
   done
```

> **Live attacks are not part of this flow.** When an attack in a production-equivalent environment is needed, the human explicitly invokes `/attack`.

- **①** is the definition phase — the foundation that gets every feature out first. "All at once" means enumerating all of them; it does not mean freezing them.
- **②** is vertical by default. Independent slices may run concurrently, each carrying its own Phase4 chain (see the §4 concurrency conditions). Vertical slicing does not mean "one at a time in order".
- **frontend and backend are 2 tracks within a slice.** They share the contract while running concurrently in separate contexts. The frontend splits into "appearance → wiring" (their oracles differ). Never stack them horizontally as "build every feature's appearance, then every feature's logic".
- **Terminology**: "frontend logic / backend logic" is the "logic" in each implementer agent's name (request handling, state, input validation, pure functions). It is distinct from "appearance" (markup and styling).

### Where docs artifacts live (common to all phases)

**One feature, one directory** (`docs/specs/F-xxx-<slug>/`), holding every document that must be read to implement that feature. The SSOT for format is the templates (`.claude/templates/develop/`, shared by producers and spec-lint). The judgment rules for how to write are held by each producer's craft (its agent body).

> **A feature's MIS**: each feature's SSOT is the pair `spec.md` (behavior: meaning, rules, GWT) and `contract.yaml` (the shape of the boundary: operations, types, required, enum, errors). **A boundary is not only HTTP** — local persistence, an inbound deeplink, a push payload, and a device capability are boundaries too, and a feature that crosses none of them declares that explicitly (`operations: {}` plus a reason) rather than going without a contract. Do not pile everything into one of them, and do not copy one's explanation into the other. The split is authoritative in the negative lists of `ssot-definer` / `contract-author`.

| Artifact | Location | Author |
| --- | --- | --- |
| PRD (Why, scope, cross-cutting business principles) | `docs/PRD.md` | human (🙋 orchestrator may ghostwrite) |
| Design Doc (the How, in present tense) | `docs/design.md` | human (🙋 orchestrator may ghostwrite; reasons go to ADR) |
| Feature ledger | `docs/specs/specs.md` | `ssot-definer`; the phase column by the orchestrator |
| Feature spec (behavior) + GWT | `docs/specs/F-xxx-<slug>/spec.md` | `ssot-definer` |
| Boundary contract (the shape of what crosses the boundary — HTTP / SDK / local persistence / deeplink / push / device) | `docs/specs/F-xxx-<slug>/contract.yaml` | `contract-author` |
| Shared contract vocabulary (`$ref` targets) | `docs/specs/_shared/components.yaml` | **orchestrator only** (producers return requests as reports) |
| DB design | **the location and format the framework/project defines** (§6; absent that, a draft in `docs/db/schema.md`) | `db-designer` + framework rules |
| ADR | `docs/adr/NNNN-YYYY-MM-DD-title.md` | `adr-writer` |

- **Do not pin the DB design's location or format on the develop side.** If a native format exists that migrations are generated from, treat it as the single SSOT and do not transcribe it into a second copy.
- **Persisting progress (the ledger)**: the phase column in `docs/specs/specs.md` (`定義`→`構造`→`実装`→`検証`→`完了`) is authoritative, and **the orchestrator updates it at every phase transition** (updating the docs ledger and `_shared` does not violate "write no code"). A ledger still carrying the old phase name `攻撃` is read and updated as `検証`.

### Phase1: definition (SSOT)

- Launch `ssot-definer` (🙋 human gate). Enumerate every feature and write the feature specs with falsifiable GWT.
- **Input**: the target scope (for greenfield, derive from the scope; pass the path to `docs/PRD.md` if it exists; for updates, pass the existing SSOT paths for a differential update).
- **May be split across launches**: enumerate the ledger first → then N concurrent Tasks, one per feature, for the specs. **Pass the identical ledger path `docs/specs/specs.md` to every concurrent Task** (prevents vocabulary drift). Human approval covers the ledger and the specs together in one pass.
- **Done when**: every feature is enumerated, each has falsifiable GWT, and error / loading / empty / permission / boundary cases are included in the acceptance criteria.

### Gate: is a skeleton needed? (orchestrator, inline)

Treat a structure as **high-risk** if any of the following applies, and go to Phase2. Otherwise go straight to Phase3 by default (do not spawn a subagent for this).

- **High novelty** — not routine CRUD, a structure with little precedent
- **Wide blast radius** — one fix ripples into many features
- **Expensive to undo** — production data already loaded, so a schema change is costly

Once judged high-risk, pick the single riskiest cross-feature path and hand it to `skeleton-runner`.

### Phase2: walking skeleton (only when high-risk)

- Launch `skeleton-runner`. Drive exactly one riskiest cross-feature path **end to end** with a minimal implementation (reaching real I/O; this does not demand a browser-driven E2E) and verify that the structure can carry the behavior (**the output is throwaway and never lands in the mainline**).

### Phase3: structural consistency (contract and DB)

- Build the DB and the interface contract that correspond to the features, and make the references consistent. **Do not produce a UI design document** (screens and UI states are already enumerated in the SSOT/GWT; the appearance is stood up in Phase4 and eyeballed by a human).
- **Launch order**:
  1. `db-designer` (🙋) — draft → `fixed` on human confirmation. **Skip it when the slice owns no data model** (a feature that only consumes a third party's API or a device capability): its absence is not a reason to hold the contract
  2. **Seeding `_shared` (orchestrator, inline)** — if `docs/specs/_shared/components.yaml` does not exist, create it from the template (`.claude/templates/develop/components.yaml`) and populate the initial vocabulary of shared DTOs and error codes from the fixed DB
  3. `contract-author` (🤖) — derive the contract from the fixed SSOT + DB (`draft`). With multiple features, may run concurrently per feature (pass every Task the identical paths for specs.md, `_shared/components.yaml`, and the existing contracts). **Requests to add to `_shared` are never written by producers; receive them as reports, apply them yourself, then start the next round**
  4. `structure-oracle` (🔴) — independent judgment in a separate context. Iterate to zero inconsistencies (round limit in §4). **Its mission is the semantic half only** — the format, the transport-field agreement, the vocabulary resolution, and the example integrity are already decided by spec-lint, so do not have it re-read contracts to confirm those
- **Marking the contract `fixed`**: the moment structure-oracle returns zero inconsistencies, **the orchestrator** sets `x-status` in `contract.yaml` to `fixed` (no human approval in between; never let a producer or oracle mark it `fixed` either).
- **Done when**: not a single referential inconsistency can be found (every feature references a real entity, every screen in the SSOT references a real feature, the contract expresses inputs and outputs exactly, etc.).

### Phase4: behavioral implementation (FE / BE, 2 concurrent tracks)

On the foundation of the contract frozen in Phase3, implement frontend and backend concurrently in separate contexts.

- **4a-1 appearance** (`frontend-ui-implementer`, 🙋): the view layer conforming to the contract's response shape, with data mocked per the contract. **Writes no logic.**
- **4a-2 frontend logic** (`frontend-logic-implementer`, 🤖): builds request handling, state, and pure functions per the contract and wires them into the appearance (**no FE Red tests for now**; verified by types, lint, etc.).
- **4b backend** (`backend-logic-implementer`, 🤖): backend logic per the contract, Red→Green→Refactor. Concurrent with 4a.
- **Integration (no dedicated phase)**: the contract's edge on the frontend-logic side (the HTTP API client, the Server Actions call boundary, etc. — **follow the framework's shape**) is implemented as a real, contract-conformant thing. **FE-side contract-conformance tests are not filed for now** (on the premise that a dedicated FE test harness is set up separately). The machine oracle is carried by the **BE tests**, and the FE gap is covered by the human eyeball (appearance) and `slice-reviewer` (with `/attack` by the human if needed). No dedicated integration phase is placed.
  > **E2E is kept out of the develop phases (for now).** Browser-driven E2E with a live environment tends to make environment setup a blocker to starting. Projects that need it add it themselves. **What counts as the contract's edge is defined by the framework's testing rules (the leaves you pass)** (on BE, the entry edge is verified by the default suite; machine verification of the FE edge is paused for now).
- **Split test suites by what execution requires.** Only suites that start no external environment (= the default suite) are subject to this phase's red-green loop; those needing a real DB or real service connections (integration) and those needing a browser or a real device (system) go into separate folders and separate commands, run at a boundary or outside the phases. **BE contract-conformance tests belong to the default suite** (they start no external environment) — moving them to the integration side drops that guarantee out of the red-green loop. Locations and run commands are defined by the framework's testing rules (the leaves you pass). **Which slice of the default suite a round runs, versus when the whole default suite runs, is §4 test-run granularity** — the default suite is the pool the loop may draw from, not a command fired after every mutation.
- **Launch order**:
  1. Launch `test-designer` **exactly once, on the `backend logic` track** (never let it write from the implementation). **Do not launch the UI-display / frontend-logic tracks** (no FE tests for now; do not let it multiply existing FE tests as a model).
  2. **Default is: start on receipt / start on dependency.** Start 4b upon receiving the BE Red tests. 4a-1 **may run concurrently with** test-designer once the contract is `fixed` (do not wait for FE Red).
  3. After 4a-1 completes (human eyeball), run 4a-2 (wiring into the appearance; no FE tests are passed).
  4. **Close the concurrent section**: if any verification was skipped because of an exclusive resource (§4), delegate a consolidated run to one agent running alone and **settle red/green of that selection before moving on** (the skipped feature IDs + blast radius; §4 test-run granularity). Do not order a whole-default-suite run here.
  5. Once FE and BE implementations are both in, launch **`slice-reviewer`** (🔴). Iterate to zero defects (round limit in §4). **`slice-attacker` / `system-attacker` are not launched in this phase.**
  6. On zero defects, **order the whole default suite once** (§4 test-run granularity), then hand off to `committer`.
- **Important**: if you find yourself wanting to change the contract, stop implementation and send it back to Phase3.
- **Done when (per slice)**: the appearance has been eyeballed by a human, the FE logic conforms to the contract (types, lint, etc.), the BE logic is green and contract-conformant, and **`slice-reviewer`'s defect list is empty**.

## 4. Rework, routing, ledger, concurrency

### Routing information (docs hygiene)

spec and contract hold **only present-tense invariants**; they do not accumulate history, rationale, measurements, or open questions. Sort the information first, then hand it to the right producer.

| Kind of information | Destination | Route |
| --- | --- | --- |
| Product-wide Why, scope, cross-cutting business principles | `docs/PRD.md` | 🙋 (orchestrator may ghostwrite) |
| A change in observable behavior | `docs/specs/F-xxx-<slug>/spec.md` | `ssot-definer` (🙋) |
| A change in the shape of the boundary (request/response) | `docs/specs/F-xxx-<slug>/contract.yaml` | `contract-author` |
| Contract vocabulary used by 2+ features (error codes, shared DTOs) | `docs/specs/_shared/components.yaml` | orchestrator (applying producers' reports) |
| Overall structure, adopted technology, design constraints (the How, present tense) | `docs/design.md` | 🙋 (orchestrator may ghostwrite; reasons go to ADR) |
| The reasoning, trade-offs, and measurements behind a decision (evidence) | `docs/adr/` | `adr-writer` |
| Open questions, residual risk, awaiting human decision | issue tracking (follow the project's convention if one exists; otherwise ask the human) | orchestrator |
| The history of a revision, an explanation of the diff | git commit message | `committer` |

> **Finding a defect is not, by itself, a reason to change the SSOT.** When a judge (structure-oracle / slice-reviewer) or a test surfaces a defect, before routing it to `ssot-definer`, check **whether the existing GWT can already refute that error**. If it **can**, the SSOT is correct and what needs fixing is the implementation (or a gap in the tests) — do not touch the spec. Only when it **cannot** does it get routed as an SSOT change.
> Skipping this check opens a path where every defect adds one GWT, so the spec grows monotonically the more review you run. `spec.md` is read in full at 9 points per slice (every producer and oracle), so each increment is billed as context to every one of those agents. **For the same reason, do not route fine-grained appearance nitpicks to the SSOT** (the oracle for appearance is the human eyeball, and putting it in GWT gets it no machine verification).

### Rework rules (branch on blast radius; **this section is authoritative**)

When an SSOT change becomes necessary mid-implementation, stop implementation, fix the SSOT, then come back. "Uniformly rewind to the original loop" is forbidden.

| Kind of change | Return point and re-verification scope |
| --- | --- |
| An SSOT change to behavior only | back to the current slice |
| An SSOT change that touches the frozen structure | Phase1 (update SSOT) → re-run Phase3 (structural consistency) → **re-verify the consistency of already-completed slices too** |

### Rounds and the circuit breaker

- Send **all findings from one round back to the producer in a single pass** (one round trip per defect is forbidden). The producer fixes all of them in one launch and returns.
- Re-judgment and re-verification are also once per round (do not launch the judge again after each individual fix).
- **From the second round on**, pass the judge "the previous finding list + the scope of this round's changes" and narrow its scope to "confirm the fixes + rescan the blast radius of the changes" (the first round is a full judgment; only the scope narrows).
- **Circuit breaker**: if the same defect or inconsistency (or the same location) survives **3 rounds**, stop looping on machine + AI and escalate to the 🙋 human (present the defect, the history, and why it is stuck, and ask for a decision).
- **Read post-round test failures as a per-class (per-file) breakdown.** A total count alone hides a regression — a class that was green turning red gets lost among the new Reds. Separate expected new Reds from unexpected regressions before sending anything back.

### Test-run granularity (this section is authoritative for when to run what)

The default suite is **the pool the red-green loop may draw from**, not a command fired after every mutation. Treating every round as a "final judgment" and running the whole default suite is forbidden.

| Moment | What you run | What "green" means |
| --- | --- | --- |
| A fix / rework round (including the consolidated run after an exclusive-resource skip) | The **reds of this round + their blast radius** | That selection is green |
| Declaring the slice ready for `committer` (after `slice-reviewer`'s empty list) | The **whole default suite, once** | The host `CLAUDE.md`'s default-suite command exits 0 |
| CI (push, pull request, merge) | The whole default suite (and whatever else CI defines) | CI |

**Blast radius is not the single failing test, and not the whole default suite.** It is the tagged suites (`F-xxx`) that observe the same path as the files this round changed. Suites that share a session, a lock, a stash, a microphone, a write-chain, or a similar cross-feature progression sit in each other's blast radius even when their feature IDs differ. When unsure, widen the selection by neighboring `F-xxx` tags — never by firing the default-suite command.

How to select (the tag, the filter flag) is in the framework testing leaves you pass. This section decides only **when**. Integration and system suites remain at a boundary or outside the phases, as already stated in Phase4.

**The orchestrator never orders a whole-default-suite run as part of a fix round, a probe, or a reviewer round.** "Settle red/green" in this skill means the matching row in the table above.

### Updating the ledger

Update the phase column in the ledger (`docs/specs/specs.md`) at every phase transition. The ledger is a shared file, so the orchestrator writes the phase column for concurrent slices itself on each receipt (never let a concurrent agent write it).

- **After updating the ledger, and before launching the next Task, re-read the §1 core constraints and restate in one line the ones that bind in the next phase.** This skill is loaded once at invocation while the conversation keeps growing, so §1 gets crowded out by recent exchanges and loses its grip (non-implementation, producer≠judge, and concurrency-by-default are the first to slip). The restatement is part of the same single action as the ledger update; never skip it across a phase boundary.

### Concurrency judgment (this section is the SSOT for concurrency; orchestrator, inline)

At every launch, **launch simultaneously if all 4 conditions below hold** (serialize only the pairs that fail). **Simultaneous launch means issuing multiple Tasks within one message.** N spec Tasks in Phase1, N contract Tasks in Phase3, and test-designer(BE) ∥ 4a-1 and 4a-1 ∥ 4b in Phase4 are concrete instances that satisfy these conditions, not separate rules.

1. **Inputs are settled** — each Task's input is already `fixed` (SSOT / DB / contract) and does not wait on another Task's output in the same round.
2. **Write targets are disjoint** — the sets of files they touch are mutually exclusive. **Never run Tasks that write to a shared file (routing, `_shared/components.yaml`, the schema source, the specs.md ledger) at the same time** (`_shared` and the ledger are written by the orchestrator alone).
3. **The shared vocabulary can be passed identically** — every concurrent producer receives the same paths for the ledger `docs/specs/specs.md`, `_shared/components.yaml`, and the existing contracts.
4. **No two human gates open at once** — at most one 🙋 approval (ssot-definer / db-designer / frontend-ui-implementer) is pending at a time.

**The main arena for this is concurrent independent slices.** Slices whose contracts are `fixed` and that satisfy conditions 1–4 may run **up to 2–3 at a time**, each carrying its whole Phase4 chain (test-designer → implementation → slice-reviewer → committer) — capped so a human can still follow a rework. **However, when they share an exclusive execution resource, the orchestrator serializes the steps that take it so they do not overlap across chains** (see below).

- **Never run steps that take an exclusive execution resource at the same time** (the git index, a single build/run environment, etc.). **When a producer reports "skipped execution due to exclusivity", close the concurrent section, have one agent run the skipped feature IDs plus blast radius, settle red/green of that selection there (§4 test-run granularity), and only then move to the next phase** (never pass something unexecuted on to verification or commit). What counts as exclusive is defined by the producer-side rules, so the orchestrator acts on the report.  **This constraint applies equally to judges that run things (slice-reviewer)** — never run two verifications that use an exclusive resource at once.
- **Never launch `committer` concurrently** (the git index is a shared resource). Delegate one at a time, in order of receipt.
- If condition 2 breaks mid-run, drop that slice to serial at that moment.
- Concurrency is a builder-side matter. It does not touch the requirement that oracles/reviewers live in a separate context from the producer.

## 5. Agent wiring, Task inputs, receipt branching

> Each agent's system prompt is authoritative in `.claude/agents/develop/*.md`. Only the wiring lives here. Do not duplicate mission text.
> **Pass the shared vocabulary (paths to the specs.md ledger, `_shared/components.yaml`, etc.) to every Task.** The branching criterion on receipt is "does the fix ripple into a human-oracle artifact (SSOT / UI / DB)?" If it does, escalate to the human; otherwise machine + AI.

**Task inputs are passed as paths (never paste artifact bodies into the prompt).** The SSOT, DB, contract, tests, appearance, and change scope in the wiring table are all passed as repository paths. Subagents Read them in their own context. Inlining bodies bloats the prompt and splits the SSOT (the same rule for rules leaves is in §6). The only exceptions are things not yet in a file — the full defect list plus its grounds, the short intent for committer, a track name, and similar control information.

**In Cursor, choose the model per Task at each launch.** A projected agent's `model:` is normalized to `inherit`, so do not leave it entirely to the parent's default. For judgments that machines cannot refute and for artifacts everything downstream rests on (SSOT / DB / contract / test design / ADR / oracle, reviewer, attacker), pick whichever offered candidate degrades least in judgment quality. The deterministic zone that has a machine oracle (the 3 implementers / skeleton / committer) can be lighter, or `inherit`. Do not hardcode a specific model slug into the harness (choose from the candidates the Task's model argument offers). When the human names a model, follow it.

### Implementing human gates

**Subagents cannot talk to the user directly.** A 🙋 agent never self-approves: it returns a draft plus the points the human must settle, and stops. The confirmation ritual (AskUserQuestion / plan mode) and the `fixed` marking are performed by the orchestrator. Never embed a human gate inside a subagent.

### Wiring table

| Agent | Point in the flow | Task input (passed by the orchestrator) | Role / exit |
| --- | --- | --- | --- |
| `ssot-definer` | top of P1 | scope, existing SSOT paths (on update) | 🙋 human gate |
| `skeleton-runner` | P2 (only when high-risk) | target subsystem, the single riskiest path, reference structure | 🔬 probe (throwaway) |
| `db-designer` | P3 | SSOT, existing schema, framework DB rules path (if any) | 🙋 human gate |
| `contract-author` | P3 | fixed SSOT, fixed DB, **shared-vocabulary paths** (specs.md, `_shared/components.yaml`, existing contracts) | 🤖 machine loop |
| `structure-oracle` | after P3 | the artifacts to judge (on re-judgment: previous findings + changed artifacts) | 🔴 independent judgment |
| `test-designer` | P4, before implementation | GWT, contract, **assigned track = `backend logic`**, framework testing-rules paths (BE bundle) | 🤖 ×1 (BE only) |
| `frontend-ui-implementer` | P4a-1 (∥ test-designer / 4b) | SSOT, contract response, framework rules paths (**no UI Red tests are passed**) | 🙋 human gate |
| `frontend-logic-implementer` | P4a-2 | contract, the implemented appearance, framework rules paths (**no FE Red tests are passed**) | 🤖 contract + types/lint |
| `backend-logic-implementer` | P4b (∥ 4a-1) | contract, SSOT, BE tests (Red), framework rules paths | 🤖 machine loop |
| `slice-reviewer` | P4, after implementation | the slice, GWT, contract, BE tests, change scope (on re-verification: previous defects + change scope) | 🔴 independent judgment |
| `committer` | after verification passes | intent (what / why / IDs), diff scope, whether a PR is needed (**once per slice**; hand over multiple logical changes together) | 🛠 side-effect delegation |
| `adr-writer` | when a decision occurs | Context / Decision / Consequences, the target ADR number (when superseding) | 🛠 side-effect delegation |

**Never launched by this skill**: `slice-attacker`, `system-attacker` (reserved for the human-invoked `/attack`).

**Do not add a dedicated agent for the consolidated run (§4 exclusive resources).** Relaunch the same implementer that reported the skip, **alone**, with the same inputs plus the instruction "run the skipped feature IDs plus their blast radius together and settle red/green of that selection" (never "run the whole default suite").

In a rework round for the 3 implementers, add **the judge's findings (all of them, with their grounds)** to the inputs above and have them fix every item in a single launch.

### Orchestrator inline (the 3 that are never filed as agents)

- **B skeleton needed?** — after Phase1 completes, before Phase3 begins (§3 Gate)
- **J rework judgment** — when an SSOT change becomes necessary. Branch the return point on blast radius (§4 rework)
- **K concurrency judgment** — at every launch (§4 concurrency conditions)

### Actions on receipt

Every subagent returns by stopping and reporting. **The single branching criterion is "does the fix reach a human-oracle artifact?"** Always have an independent agent do the judging (never fix it yourself and then approve it yourself). Do not take a judge's report at face value — verify the grounds yourself, especially before any decision that goes outside. Do not escalate to a human what machines can settle.

| Stop/report received | From | Exit |
| --- | --- | --- |
| draft + points to confirm (feature ledger, specs) | ssot-definer | 🙋 present → `fixed` on approval / relaunch on change requests |
| draft + points to confirm (DB design) | db-designer | 🙋 present → `fixed` on approval / relaunch on change requests |
| appearance + request to confirm | frontend-ui-implementer | 🙋 present → settled on approval / re-implement on change requests |
| cannot settle the contract (caused by a defect in the feature or DB) | contract-author | 🙋 send back to the causing human oracle (SSOT or DB) → re-derive the contract after approval |
| a contract addendum (derivable from the approved SSOT + DB) | contract-author | 🤖 relaunch to fill it in, then structure-oracle re-judges |
| a request to add vocabulary to `_shared` | contract-author | 🛠 orchestrator applies it to `_shared/components.yaml` (before the next round; other in-flight contracts see it via the same path) |
| inconsistency list | structure-oracle | 🤖 send all items back in one round → re-judge on the diff scope (bounded by the circuit breaker; 🙋 if the cause is a human oracle). **On receiving an empty list, the orchestrator marks the contract `fixed`** |
| GWT or contract is insufficient | test-designer | cause is the SSOT → 🙋 / the contract → 🤖 re-derive |
| the contract falls short (mid-implementation) | the 3 implementers | closes within the contract → 🤖 / reaches a human oracle → 🙋 |
| tests not run (skipped due to an exclusive resource) | an implementer | 🛠 close the concurrent section, delegate a consolidated run to one agent, settle red/green of the skipped feature IDs + blast radius (§4 exclusive resources and test-run granularity). Never proceed to slice-reviewer or committer with anything unexecuted |
| tests red | an implementer | 🤖 send all findings back in one round → fix → re-test the reds + blast radius (bounded by the circuit breaker; 🙋 if the cause is a human oracle). Never answer a red by ordering the whole default suite |
| defect list | slice-reviewer | 🤖 send all findings back in one round → fix → re-verify on the diff scope (bounded by the circuit breaker; 🙋 if the cause is a human oracle). **On receiving an empty list, order the whole default suite once (§4 test-run granularity), then go to committer** |
| structural refutation | skeleton-runner | cause is structural, e.g. the DB → 🙋 / otherwise → rebuild in Phase1/3 |
| commit result, or a stop + reason for sending back | committer | 🛠 record it. On a stop, re-delegate or send back to the relevant producer per the reason. Never escalate commit success/failure to 🙋 |
| the ADR file, or "cannot record" | adr-writer | 🛠 keep the record of the outcome. When the decision is unsettled and unwritable → 🙋 |

Return points and re-verification scope follow the §4 rework rules. Information destined for the SSOT is sorted by the §4 routing table before being handed over.

## 6. Passing rules leaves by path (scene-wide rules + framework-specific rules)

Rules (leaves) are never inlined; **passing paths** in the Task input is authoritative. The orchestrator judges the target, resolves the paths of the applicable leaves, and passes them in each producer's input (never make the agent walk a catalog itself). **Even when the framework cannot be identified, always deliver the scene-wide rules** (never skip this section wholesale). If several leaves apply, pass all of them. Keep the leaf as the single SSOT; never copy its content and let it drift.

> **Why by path.** The native `paths:` gate is lazy and its addressing is left to globs, which can arrive too late for a greenfield test-designer. Explicit handoff is authoritative, and the paths gate is a free safety net. Inlining bloats the prompt and splits the SSOT, so keep it as a fallback for the rare case where paths are unstable.
>
> **Do not write any specific framework name or list of leaf files in this section.** Naming them pollutes context even on projects that use no such framework. What this section holds is only **how to decide the destination**.
>
> **References run one way: rules → skill.** All this skill may look at about a leaf is **the leaf's path (to enumerate it) and its frontmatter `paths:` (to decide the destination)**.
> **Do not read a leaf's body. Do not depend on the meaning of a file name. Do not write a leaf's summary, excerpt, or section number into this skill.**
> **What rules to write, under what file names, split how, is entirely up to the rules side**, and this skill must deliver correctly without knowing any of it.
> Knowing the content of a rule is the job of the agent that receives the leaf, not of the one delivering it. Conversely, **a leaf referencing this skill is fine** (the rules side writing "the procedure is authoritative in the skill" is the correct direction).

### 6-A. Assembling a bundle (procedure)

1. Enumerate the leaves **directly under** `rules/<scene>/` (scene-wide rules, independent of framework). **Never drop them, regardless of whether the framework could be identified.**
2. Identify the target platform and framework (from the declaration in the host project's `CLAUDE.md`, or failing that from paths, extensions, and dependencies) and enumerate `rules/<scene>/<platform>/<framework>/` **recursively**. If it does not exist, pass no framework-specific rules (do not fabricate what is not there).
3. Read **only the `paths:` frontmatter** of each leaf (never open the body).
4. For each producer, list **the paths of the files that producer will create or edit in this launch**.
5. Pass that producer **every** leaf whose `paths:` matches any of the paths from step 4 (see 6-B).

### 6-B. Deciding the destination (decided by `paths:` alone)

| Recipient | What counts as "paths it writes" |
| --- | --- |
| implementers (`frontend-ui` / `frontend-logic` / `backend-logic`) | the paths of the **production code** created or edited in that slice |
| `test-designer` (**only for tracks that are launched**) | the paths of the **test files** created in that slice |
| `db-designer` | the path of the **DB design SSOT** (the docs location table in §3) |

- **Never decide the destination from a leaf's file name.** Let matching alone settle it.
- **When nothing matches at all, the narrowing is probably wrong.** Pass the leaves directly under the scene **plus every leaf of that framework** (too many beats too few — code written in ignorance of a rule cannot be caught in verification). Do the same when the paths to be written cannot be determined in advance.
- **Never split a bundle.** When several implementers work in the same layer (UI and logic), pass both the same bundle. Narrowing by written paths is not "splitting" (implementers that write the same paths get the same bundle).
- **Cross-layer delegation is also declared by `paths:`.** When a rule also binds addresses in another layer, that shows up as **that leaf including those addresses in its `paths:`**. **This section never infers it from a leaf's body.**
- If an implementer ends up writing an unplanned path mid-implementation, **it opens the leaves whose `paths:` match that path itself, before writing** (no need to come back to the orchestrator).
- **Tracks launched for now**: `test-designer` is **BE only**. Bundles for the UI / FE tracks are **not assembled and not passed**.
- Naming a new rules leaf and narrowing its `paths` is covered in this repository's `CLAUDE.md` §3.1. **Bundle composition is authoritative in this section (§6-B).**

## 7. Final definition of done

Call it "complete" only when all of the following hold.

- [ ] SSOT enumeration, specs, and GWT are complete (falsifiable GWT for every feature)
- [ ] Phase3 structural consistency and contract freeze are done (zero inconsistencies)
- [ ] For every slice: the UI has been eyeballed by a human, the FE logic conforms to the contract, the BE logic is green (consistent with the feature spec after integration; FE unit tests are not required for now)
- [ ] For every slice, `slice-reviewer`'s defect list is empty
- [ ] Every SSOT change that arose has been reworked and its affected slices re-verified
- [ ] The ledger (the status and phase columns in `specs.md`) matches reality, and every phase reads `完了`

**"All tests passed, so it's done" is not the definition of done.** This skill's definition of done is that an independent adversarial verification could not produce a defect. Live attacks (`/attack`) are optional and are not part of it.
