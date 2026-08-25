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
  1. The SSOT — everything under `docs/` that machines cannot refute: the vision, the glossary, the actors, the goals, the use cases (`UC.md`), the requirements (`REQ-nnn.md`), the business rules (`BR-nnn.md`), the NFRs
  2. UI appearance
  3. DB design
- **Everything else runs on machine + AI**: contracts, verification policies (partition classes), pure functions, tests, implementation, and integration take the SSOT as truth and involve no human. But AI judgment has weaker refutation power than a machine oracle, so never loop it without bound — always carry a round limit (§4 circuit breaker).
- **SSOT first (the upstream-first rule, R-801)**: code is never the source of truth. When implementation exposes a flaw in the spec, do not promote the code to truth — update the SSOT, then re-derive (rework routing is in §4).
- **Requirements**: one EARS sentence per `REQ-nnn.md`, implementation-independent and falsifiable, at a granularity that answers "what observation would prove this wrong?" — derived from a use case's state × event table, which has **no empty cell**. Cases are not enumerated in docs; `test-designer` declares partition classes and the tests exhaust them (the conventions are the rules leaf `.claude/rules/develop/docs.md`, delivered to whoever writes under `docs/`).
- **Three kinds of oracle** (all distinct from the producer):
  - **Machine oracle** — artifacts refutable deterministically by tests, types, lint, or schema validation (contracts, pure functions, logic, tests), plus **`spec-lint`** (format and lifecycle of the docs) and **`trace-check`** (traceability C1–C12: coverage, `@covers` / `@implements` resolution, placement, dead rules, numbering). Loop autonomously to green with no human involved.
  - **AI judgment oracle** — judgments that determinism cannot refute but that need no human either, such as referential consistency and adversarial verification of an implementation (structure-oracle / slice-reviewer). Must carry a round limit and an escalation condition to the human. Live attacks (`/attack`) are not part of this skill's completion criteria.
  - **Human oracle** — artifacts neither machine nor AI can conclusively refute (the SSOT, UI, DB design). Marked `active` (docs) or settled (UI / DB) by human confirmation.
- **Definition of done**: not "all tests pass" but an empty defect list from the independent adversarial verifier (`slice-reviewer`) **and zero new `trace-check` violations** (the merge condition, R-803). Green tests are a precondition, not the finish line.
- **Order**: strictly `define → structural consistency (contract first) → behavioral implementation → verification`. **The one exception is the walking skeleton (§3 Phase2)** — a throwaway probe for validating structure, permitted only on the condition that its output never lands in the mainline.
- **Contract first**: the UI and the backend logic are built only after the request/response boundary contract they share has been frozen. **Never build UI before the contract is fixed.**

### Language policy (these instructions are in English; the output is not)

This harness writes its instructions in English for token density, but **that is a property of the prompt, not of the work**. Unless the human asks otherwise:

- **Talk to the human in Japanese.** Every presentation at a 🙋 human gate, every question, every report.
- **Write every deliverable in Japanese.** Every document under `docs/` (the vision, glossary, actors, `GOAL.md`, `UC.md`, `REQ-nnn.md`, `BR-nnn.md`, NFRs, the verification policies), `contract.yaml` summaries and `when` notes, ADRs, design docs, commit messages, and in-code comments. The templates in `.claude/templates/develop/` carry Japanese headings for exactly this reason — do not translate the artifacts into English to match these instructions.
- **State this in every Task input.** Subagents inherit no language setting: when you launch one, tell it that its deliverable is written in Japanese. A producer that returns an English artifact is producing the wrong thing, however correct its content.
- Identifiers, file names, paths, code, and the reserved keywords of a format (`draft`/`active`/`withdrawn`, `fixed`, the EARS `pattern` values, the contract's keys and enum values such as `transport` / `outbound` / `local-store`, the `phase` values) stay as they are.

## 2. Implementation start gate (absolute precondition before touching code)

> This turns the "SSOT first" core constraint into a stop line that fires at the moment work begins. It is a procedure, not an ideal.
> **Touching code that corresponds to implementation, DB schema, or contracts without passing this gate is forbidden.**
> (Why: an incident where "it's a small CRUD much like an existing one" led straight to implementation, skipping definition.)

Before starting any change to implementation, DB, or contracts, confirm the following. If even one is missing or unfinished (`draft`), stop implementation; the return point branches on which item is missing (do not uniformly rewind to Phase1). **No exemption for size or for the reason behind the request.**

> **Avoiding the cost of a small CRUD is not a license to skip mainline phases.** When you want the same shape of artifacts faster with only the verification depth reduced, route to the human-invoked `/develop-light` (`.claude/skills/develop-light/SKILL.md`). Even light does not waive the start gate.

| # | Check | Return point when missing |
| --- | --- | --- |
| 1 | Does the use case exist as `docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/UC.md`, `status: active`? | Phase1 — if the goal itself is missing, `domain-definer` (a goal, not the whole domain); if only the UC is missing, `usecase-definer` for **this UC only** |
| 2 | Is every `REQ-nnn.md` its state × event table names present and `active` (none `draft`)? | Phase1 — `requirement-definer` for **only this UC's** requirements. Do not redo the already-approved UCs |
| 3 | Is `contract.yaml` in the same directory `fixed` (`x-status`)? | **Phase3** — derive and freeze the contract, then return to Phase4 |

`node .claude/tools/spec-lint/spec-lint.mjs gate --uc UC-nnn` decides all three in one run. Marking a contract `fixed` is done **by the orchestrator** upon structure-oracle returning zero inconsistencies (§3 Phase3).

### Excuses that do not earn an exemption (all rejected)

- "It's the same pattern as existing UC X / I can copy-paste it" — a matching pattern does not imply a use case exists.
- "It's a small CRUD" / "just one screen, one table" — size does not waive the gate. To lower cost, the human explicitly invokes `/develop-light` rather than thinning the mainline.
- "It's an addition to a running project, so Phase1 must already be done" — it is done only **when that use case's directory exists with active REQs**.
- "The user said 'just implement it'" — a request is for something that works; it is not permission to skip the SSOT. When no use case exists, producing it first is the correct response.

Machine verification (spec-lint, trace-check, the optional gate-hook) may act as a post-hoc check or a write-time block, but **this gate is one you pass yourself before starting**, and you never skip it regardless of whether machine enforcement is in place. If blocked, follow the return point in the table above.

## 3. Overall flow and phase definitions

```
① Fix the whole set up front (baseline SSOT — not a freeze)
   ├ domain: vision / glossary / actors / goals / NFRs        (domain-definer, 🙋)
   ├ use cases: UC.md with a complete state × event table      (usecase-definer per UC, 🙋)
   └ requirements: REQ-nnn.md (EARS) + BR-nnn.md              (requirement-definer per UC, 🙋)
        │
   [Gate] structural risk judgment ──→ is a skeleton needed? (only for the high-risk part)
        │
   (conditional) walking skeleton (only when high-risk)
        │
② Implement in vertical slices (one UC directory = one slice; iterate per UC)
   ├ structural consistency (UC × DB × boundary contract)  ← the contract is frozen here
   ├ behavioral implementation (partition classes → Red tests; frontend/backend as 2 tracks sharing the contract)
   └ adversarial verification per slice (slice-reviewer) + trace-check
        │
   done
```

> **Live attacks are not part of this flow.** When an attack in a production-equivalent environment is needed, the human explicitly invokes `/attack`.

- **①** is the definition phase — the foundation that gets every goal and use case out first. "All at once" means enumerating all of them; it does not mean freezing them (a goal not being started stays in `goals-backlog.md`).
- **②** is vertical by default. **A UC directory is the slice**: `ls` on it defines the scope, and it is read in full by every producer and oracle of that slice. Independent slices may run concurrently, each carrying its own Phase4 chain (see the §4 concurrency conditions). Vertical slicing does not mean "one at a time in order".
- **frontend and backend are 2 tracks within a slice.** They share the contract while running concurrently in separate contexts. The frontend splits into "appearance → wiring" (their oracles differ). Never stack them horizontally as "build every UC's appearance, then every UC's logic".
- **Terminology**: "frontend logic / backend logic" is the "logic" in each implementer agent's name (request handling, state, input validation, pure functions). It is distinct from "appearance" (markup and styling).

### Where docs artifacts live (common to all phases)

**One use case, one directory** (`docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/`), holding every document that must be read to implement that use case: `UC.md`, its `REQ-nnn.md`, and `contract.yaml`. The vertical series GOAL → UC → REQ is a tree, so the file system matches it; the cross-cutting documents (BR / NFR / ADR / glossary / `_shared`) stay central under `docs/`. **Indexes are generated, never committed** (`trace-check --index`). The SSOT for format is the templates (`.claude/templates/develop/`, shared by the producers and the lints); the principles are the rules leaf `.claude/rules/develop/docs.md` (its `paths:` deliver it to whoever writes under `docs/`); the judgment rules for how to write are held by each producer's craft (its agent body).

> **A slice's MIS**: `UC.md` (the scenario, the state × event table whose cells name the REQs, the exception sweep) + `REQ-nnn.md` (one EARS sentence each, plus the partition classes in `## 検証方針`) + `contract.yaml` (the shape of the boundary: operations, types, required, enum, errors). Rules shared by 2+ UCs live once, in `docs/rules/BR-nnn.md`, and are referenced by ID. **A boundary is not only HTTP** — local persistence, an inbound deeplink, a push payload, and a device capability are boundaries too, and a UC that crosses none of them declares that explicitly (`operations: {}` plus a reason) rather than going without a contract. Do not pile everything into one of them, and do not copy one's explanation into the other. The split is authoritative in the negative lists of the definers / `contract-author`.

| Artifact | Location | Author |
| --- | --- | --- |
| Vision (the problem, KPIs, out of scope) | `docs/00-vision.md` | `domain-definer` (🙋 → `frozen`) |
| Glossary (ubiquitous language, forbidden synonyms) | `docs/01-glossary.md` | `domain-definer` (🙋 → `living`) |
| Actors (the closed set) | `docs/02-actors.md` | `domain-definer` (🙋 → `living`) |
| Goals | `docs/goals/GOAL-nn-<slug>/GOAL.md` (started) / `docs/goals-backlog.md` (not started) | `domain-definer` (🙋 → `active`) |
| Use case (scenario, state × event table, exception sweep) | `docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/UC.md` | `usecase-definer` (🙋 → `active`); the `phase:` line by the orchestrator |
| Requirement (one EARS sentence) + verification policy | `…/UC-nnn-<slug>/REQ-nnn.md` | `requirement-definer` (🙋 → `active`); `## 検証方針` by `test-designer` |
| Business rule (shared by 2+ UCs) | `docs/rules/BR-nnn.md` | `requirement-definer` (🙋 → `active`) |
| NFR (threshold + measurement) | `docs/nfr/NFR-nnn.md` | `domain-definer` (🙋 → `active`) |
| Boundary contract (HTTP / SDK / local persistence / deeplink / push / device) | `…/UC-nnn-<slug>/contract.yaml` | `contract-author` (🤖 → `fixed` by the orchestrator) |
| Shared contract vocabulary (`$ref` targets) | `docs/_shared/components.yaml` | **orchestrator only** (producers return requests as reports) |
| Project-wide "not verified" ranges | `docs/verification/GLOBAL.md` | `test-designer` |
| DB design | **the location and format the framework/project defines** (§6; absent that, a draft in `docs/db/schema.md`) | `db-designer` + framework rules |
| Design Doc (the How, in present tense; optional) | `docs/design.md` | human (🙋 orchestrator may ghostwrite; reasons go to ADR) |
| ADR | `docs/adr/ADR-nnnn-<slug>.md` | `adr-writer` |
| Trace configuration | `traceconfig.json` at the host root | orchestrator seeds it once from the template; the host maintains it |

- **Do not pin the DB design's location or format on the develop side.** If a native format exists that migrations are generated from, treat it as the single SSOT and do not transcribe it into a second copy.
- **Persisting progress (the phase)**: the `phase:` line in each `UC.md` frontmatter (`定義`→`構造`→`実装`→`検証`→`完了`) is authoritative, and **the orchestrator advances it at every phase transition** (editing that one line does not violate "write no code"; no producer ever touches it). There is no ledger file — `trace-check --index` renders the map on demand.
- **Statuses**: docs nodes go `draft → active → withdrawn` (`active` = a human approved it; the singletons use `frozen` / `living`), the contract goes `draft → fixed`. **The orchestrator performs every status transition**; producers return drafts.

### Phase1: definition (SSOT)

Three producers, three gates, in dependency order. Before the first launch, if `traceconfig.json` does not exist at the host root, **seed it from `.claude/templates/develop/traceconfig.json`** (orchestrator, inline) and adjust `source` / `tests` to the host's layout (ask the human when unsure). On an existing project, run `node .claude/tools/trace-check/trace-check.mjs --update-baseline` once so that only new violations fail from here on.

1. **Domain** — launch `domain-definer` (🙋). **Input**: the target scope (for greenfield, derive from the scope; pass any brief or plan document as a path); on update, the paths of the existing domain docs. **Done when**: the vision has measurable KPIs, the glossary and the actor set are closed, every goal is either a `GOAL.md` or a backlog entry, and every NFR has a measurement. On approval, the orchestrator sets `frozen` / `living` / `active`.
2. **Use cases** — launch `usecase-definer` **one Task per UC, concurrently across UCs** (🙋 per UC). **Input**: the goal's `GOAL.md`, `02-actors.md`, `01-glossary.md`, one neighboring UC directory in the same goal if any, the existing BRs, as paths. **Done when**: the state × event table has no empty cell and every cell names a reserved REQ ID, a planned UC, or `不可` with a reason; the exception sweep covers the 4 axes. On approval, `status: active`.
3. **Requirements** — launch `requirement-definer` **one Task per active UC, concurrently** (🙋 per UC). **Input**: the UC directory, the reserved REQ IDs, the glossary, the existing BRs, as paths. **Done when**: every reserved ID is one EARS sentence with a pattern, at least one `Unwanted behaviour` per UC, and every rule shared by 2+ UCs is a BR referenced by ID. On approval, the REQs and BRs become `active`.

Human approval covers one producer's return in one pass (§4: at most one 🙋 pending). A defect report against an approved requirement is routed per §4 — never patched inline.

### Gate: is a skeleton needed? (orchestrator, inline)

Treat a structure as **high-risk** if any of the following applies, and go to Phase2. Otherwise go straight to Phase3 by default (do not spawn a subagent for this).

- **High novelty** — not routine CRUD, a structure with little precedent
- **Wide blast radius** — one fix ripples into many use cases
- **Expensive to undo** — production data already loaded, so a schema change is costly

Once judged high-risk, pick the single riskiest cross-UC path and hand it to `skeleton-runner`.

### Phase2: walking skeleton (only when high-risk)

- Launch `skeleton-runner`. Drive exactly one riskiest cross-UC path **end to end** with a minimal implementation (reaching real I/O; this does not demand a browser-driven E2E) and verify that the structure can carry the behavior (**the output is throwaway and never lands in the mainline**).

### Phase3: structural consistency (contract and DB)

- Build the DB and the boundary contract that correspond to the use cases, and make the references consistent. **Do not produce a UI design document** (screens and UI states are already in the state × event tables; the appearance is stood up in Phase4 and eyeballed by a human).
- **Launch order**:
  1. `db-designer` (🙋) — draft → settled on human confirmation. Pass the UC directories, the BRs whose `enforced_at` names the database, and the glossary. **Skip it when the slice owns no data model** (a UC that only consumes a third party's API or a device capability): its absence is not a reason to hold the contract
  2. **Seeding `_shared` (orchestrator, inline)** — if `docs/_shared/components.yaml` does not exist, create it from the template (`.claude/templates/develop/components.yaml`) and populate the initial vocabulary of shared DTOs and error codes from the settled DB
  3. `contract-author` (🤖) — derive the contract from the active UC directory + settled DB (`draft`). With multiple UCs, run concurrently per UC (pass every Task the identical paths for `_shared/components.yaml` and the existing contracts). **Requests to add to `_shared` are never written by producers; receive them as reports, apply them yourself, then start the next round**
  4. `structure-oracle` (🔴) — independent judgment in a separate context. Iterate to zero inconsistencies (round limit in §4). **Its mission is the semantic half only** — the format, the transport-field agreement, the vocabulary resolution, the example integrity (spec-lint), and placement / dead rules / duplicate IDs (trace-check) are already decided by machine, so do not have it re-read contracts to confirm those
- **Marking the contract `fixed`**: the moment structure-oracle returns zero inconsistencies, **the orchestrator** sets `x-status` in `contract.yaml` to `fixed` and advances the UC's `phase:` to `構造` (no human approval in between; never let a producer or oracle mark it `fixed` either).
- **Done when**: not a single referential inconsistency can be found (every state in every table is held by a real entity, every BR enforced at the database has its constraint, the contract expresses every cell and every derived failure exactly, etc.).

### Phase4: behavioral implementation (FE / BE, 2 concurrent tracks)

On the foundation of the contract frozen in Phase3, implement frontend and backend concurrently in separate contexts. Advance the UC's `phase:` to `実装` on entry.

- **4a-1 appearance** (`frontend-ui-implementer`, 🙋): the view layer conforming to the contract's response shape, with data mocked per the contract. **Writes no logic.**
- **4a-2 frontend logic** (`frontend-logic-implementer`, 🤖): builds request handling, state, and pure functions per the contract and wires them into the appearance (**no FE Red tests for now**; verified by types, lint, etc.). Annotates `@implements`.
- **4b backend** (`backend-logic-implementer`, 🤖): backend logic per the contract, Red→Green→Refactor, `@implements` on every unit that realizes a REQ / BR. Concurrent with 4a.
- **Integration (no dedicated phase)**: the contract's edge on the frontend-logic side (the HTTP API client, the Server Actions call boundary, etc. — **follow the framework's shape**) is implemented as a real, contract-conformant thing. **FE-side contract-conformance tests are not filed for now** (on the premise that a dedicated FE test harness is set up separately). The machine oracle is carried by the **BE tests** and `trace-check`, and the FE gap is covered by the human eyeball (appearance) and `slice-reviewer` (with `/attack` by the human if needed). No dedicated integration phase is placed.
  > **E2E is kept out of the develop phases (for now).** Browser-driven E2E with a live environment tends to make environment setup a blocker to starting. Projects that need it add it themselves. **What counts as the contract's edge is defined by the framework's testing rules (the leaves you pass)** (on BE, the entry edge is verified by the default suite; machine verification of the FE edge is paused for now).
- **Split test suites by what execution requires.** Only suites that start no external environment (= the default suite) are subject to this phase's red-green loop; those needing a real DB or real service connections (integration) and those needing a browser or a real device (system) go into separate folders and separate commands, run at a boundary or outside the phases. **BE contract-conformance tests belong to the default suite** (they start no external environment) — moving them to the integration side drops that guarantee out of the red-green loop. Locations and run commands are defined by the framework's testing rules (the leaves you pass). **Which slice of the default suite a round runs, versus when the whole default suite runs, is §4 test-run granularity** — the default suite is the pool the loop may draw from, not a command fired after every mutation.
- **Launch order**:
  1. Launch `test-designer` **exactly once, on the `backend logic` track** (never let it write from the implementation). It first **declares the partition classes in each REQ's `## 検証方針`** (the lower and upper bound of the tests — the only producer that writes into an active REQ, and only that section), then files the Red tests, each with `@covers REQ-nnn#class`. **Do not launch the UI-display / frontend-logic tracks** (no FE tests for now; do not let it multiply existing FE tests as a model).
  2. **Default is: start on receipt / start on dependency.** Start 4b upon receiving the BE Red tests. 4a-1 **may run concurrently with** test-designer once the contract is `fixed` (do not wait for FE Red).
  3. After 4a-1 completes (human eyeball), run 4a-2 (wiring into the appearance; no FE tests are passed).
  4. **Close the concurrent section**: if any verification was skipped because of an exclusive resource (§4), delegate a consolidated run to one agent running alone and **settle red/green of that selection before moving on** (the skipped UC IDs + blast radius; §4 test-run granularity). Do not order a whole-default-suite run here.
  5. Once FE and BE implementations are both in, advance `phase:` to `検証` and launch **`slice-reviewer`** (🔴). Iterate to zero defects (round limit in §4). **`slice-attacker` / `system-attacker` are not launched in this phase.**
  6. On zero defects, **order the whole default suite once and run `node .claude/tools/trace-check/trace-check.mjs` once** (§4 test-run granularity; the merge condition is both green, R-803), then hand off to `committer` and advance `phase:` to `完了`.
- **Important**: if you find yourself wanting to change the contract, stop implementation and send it back to Phase3.
- **Done when (per slice)**: the appearance has been eyeballed by a human, the FE logic conforms to the contract (types, lint, etc.), the BE logic is green and contract-conformant, `trace-check` reports zero new violations, and **`slice-reviewer`'s defect list is empty**.

## 4. Rework, routing, phase, concurrency

### Routing information (docs hygiene)

Every document under `docs/` holds **only present-tense invariants**; none accumulates history, rationale, measurements, or open questions. Sort the information first, then hand it to the right producer.

| Kind of information | Destination | Route |
| --- | --- | --- |
| Product-wide Why, KPIs, out of scope | `docs/00-vision.md` | `domain-definer` (🙋) |
| A term, a code identifier, a synonym to forbid | `docs/01-glossary.md` | `domain-definer` (🙋) |
| A new actor, a new goal | `docs/02-actors.md` / `GOAL.md` / `goals-backlog.md` | `domain-definer` (🙋) |
| A new state, event, or exception path (a table cell) | `…/UC-nnn-<slug>/UC.md` | `usecase-definer` (🙋) |
| A change in observable behavior | `…/UC-nnn-<slug>/REQ-nnn.md` (one sentence) | `requirement-definer` (🙋) |
| A rule that binds 2+ UCs, or where a rule is enforced | `docs/rules/BR-nnn.md` (`enforced_at`) | `requirement-definer` (🙋); the reasoning → ADR |
| A cross-cutting quality with a threshold | `docs/nfr/NFR-nnn.md` | `domain-definer` (🙋) |
| Which inputs a requirement's tests partition, and what is not verified | the REQ's `## 検証方針` / `docs/verification/GLOBAL.md` | `test-designer` |
| A change in the shape of the boundary (request/response) | `…/UC-nnn-<slug>/contract.yaml` | `contract-author` |
| Contract vocabulary used by 2+ UCs (error codes, shared DTOs) | `docs/_shared/components.yaml` | orchestrator (applying producers' reports) |
| Overall structure, adopted technology, design constraints (the How, present tense) | `docs/design.md` | 🙋 (orchestrator may ghostwrite; reasons go to ADR) |
| The reasoning, trade-offs, rejected options, and measurements behind a decision | `docs/adr/` | `adr-writer` |
| A value that can be machine-readable (a threshold, an enumeration) | the code constant / DB constraint / schema (R-102); the doc says where | the implementer / `db-designer` |
| Open questions, residual risk, awaiting human decision | issue tracking (follow the project's convention if one exists; otherwise ask the human) | orchestrator |
| The history of a revision, an explanation of the diff | git commit message | `committer` |

> **Finding a defect is not, by itself, a reason to change the SSOT.** When a judge (structure-oracle / slice-reviewer) or a test surfaces a defect, before routing it to a definer, check **whether the existing REQ sentences and BRs already refute that error**. If they **can**, the SSOT is correct and what needs fixing is the implementation (or a missing partition class — route that to `test-designer`) — do not touch the requirement. Only when they **cannot** does it get routed as an SSOT change.
> Skipping this check opens a path where every defect adds a requirement, so the UC directory grows monotonically the more review you run. That directory is read in full by every producer and oracle of the slice, so each increment is billed as context to every one of them. **For the same reason, do not route fine-grained appearance nitpicks to the SSOT** (the oracle for appearance is the human eyeball, and putting it in a requirement gets it no machine verification).

### Rework rules (branch on blast radius; **this section is authoritative**)

When an SSOT change becomes necessary mid-implementation, stop implementation, fix the SSOT (upstream first, R-801), then come back. "Uniformly rewind to the original loop" is forbidden.

| Kind of change | Return point and re-verification scope |
| --- | --- |
| A change to one requirement's sentence, or a new partition class | back to the current slice (re-derive: policy → tests → implementation) |
| A new table cell, a new BR, or an SSOT change that touches the frozen structure | Phase1 (update the UC / REQ / BR) → re-run Phase3 (structural consistency) → **re-verify the consistency of already-completed slices too** (a BR change ripples into every UC that references it — `trace-check` C4 output lists them) |

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
| Declaring the slice ready for `committer` (after `slice-reviewer`'s empty list) | The **whole default suite, once**, and **`trace-check` once** | The host `CLAUDE.md`'s default-suite command exits 0 and trace-check reports no new violation |
| CI (push, pull request, merge) | The whole default suite, spec-lint, trace-check (and whatever else CI defines) | CI |

**Blast radius is not the single failing test, and not the whole default suite.** It is the tagged suites (`UC-nnn`) that observe the same path as the files this round changed. Suites that share a session, a lock, a stash, a microphone, a write-chain, or a similar cross-UC progression sit in each other's blast radius even when their UC IDs differ. When unsure, widen the selection by neighboring `UC-nnn` tags — never by firing the default-suite command.

How to select (the tag, the filter flag) is in the framework testing leaves you pass. This section decides only **when**. Integration and system suites remain at a boundary or outside the phases, as already stated in Phase4.

**The orchestrator never orders a whole-default-suite run as part of a fix round, a probe, or a reviewer round.** "Settle red/green" in this skill means the matching row in the table above.

### Advancing the phase

Advance the `phase:` line in the slice's `UC.md` at every phase transition. `UC.md` is a shared file, so the orchestrator edits that one line itself on each receipt (never let a concurrent agent write it, and never touch anything else in the file).

- **After advancing the phase, and before launching the next Task, re-read the §1 core constraints and restate in one line the ones that bind in the next phase.** This skill is loaded once at invocation while the conversation keeps growing, so §1 gets crowded out by recent exchanges and loses its grip (non-implementation, producer≠judge, and concurrency-by-default are the first to slip). The restatement is part of the same single action as the phase update; never skip it across a phase boundary.

### Concurrency judgment (this section is the SSOT for concurrency; orchestrator, inline)

At every launch, **launch simultaneously if all 4 conditions below hold** (serialize only the pairs that fail). **Simultaneous launch means issuing multiple Tasks within one message.** N use-case Tasks in Phase1, N requirement Tasks in Phase1, N contract Tasks in Phase3, and test-designer(BE) ∥ 4a-1 and 4a-1 ∥ 4b in Phase4 are concrete instances that satisfy these conditions, not separate rules.

1. **Inputs are settled** — each Task's input is already `active` / settled / `fixed` (SSOT / DB / contract) and does not wait on another Task's output in the same round.
2. **Write targets are disjoint** — the sets of files they touch are mutually exclusive. **Never run Tasks that write to a shared file (routing, `docs/_shared/components.yaml`, the schema source, the domain singletons `00-vision.md` / `01-glossary.md` / `02-actors.md`, a `UC.md` another Task reads) at the same time** (`_shared` and every `phase:` line are written by the orchestrator alone). Two `requirement-definer` Tasks may both extract BRs — receive the candidates as reports and let one of them write, or write the BR yourself only if it is a verbatim relocation.
3. **The shared vocabulary can be passed identically** — every concurrent producer receives the same paths for the glossary, the existing BRs, `_shared/components.yaml`, and the existing contracts.
4. **No two human gates open at once** — at most one 🙋 approval (a definer / db-designer / frontend-ui-implementer) is pending at a time.

**The main arena for this is concurrent independent slices.** Slices whose contracts are `fixed` and that satisfy conditions 1–4 may run **up to 2–3 at a time**, each carrying its whole Phase4 chain (test-designer → implementation → slice-reviewer → committer) — capped so a human can still follow a rework. **However, when they share an exclusive execution resource, the orchestrator serializes the steps that take it so they do not overlap across chains** (see below).

- **Never run steps that take an exclusive execution resource at the same time** (the git index, a single build/run environment, etc.). **When a producer reports "skipped execution due to exclusivity", close the concurrent section, have one agent run the skipped UC IDs plus blast radius, settle red/green of that selection there (§4 test-run granularity), and only then move to the next phase** (never pass something unexecuted on to verification or commit). What counts as exclusive is defined by the producer-side rules, so the orchestrator acts on the report.  **This constraint applies equally to judges that run things (slice-reviewer)** — never run two verifications that use an exclusive resource at once.
- **Never launch `committer` concurrently** (the git index is a shared resource). Delegate one at a time, in order of receipt.
- If condition 2 breaks mid-run, drop that slice to serial at that moment.
- Concurrency is a builder-side matter. It does not touch the requirement that oracles/reviewers live in a separate context from the producer.

## 5. Agent wiring, Task inputs, receipt branching

> Each agent's system prompt is authoritative in `.claude/agents/develop/*.md`. Only the wiring lives here. Do not duplicate mission text.
> **Pass the shared vocabulary (paths to the glossary, the BRs, `_shared/components.yaml`, etc.) to every Task.** The branching criterion on receipt is "does the fix ripple into a human-oracle artifact (SSOT / UI / DB)?" If it does, escalate to the human; otherwise machine + AI.

**Task inputs are passed as paths (never paste artifact bodies into the prompt).** The SSOT, DB, contract, tests, appearance, and change scope in the wiring table are all passed as repository paths — for a slice, **the UC directory path** (the agent runs `ls` and Reads what is there). Subagents Read them in their own context. Inlining bodies bloats the prompt and splits the SSOT (the same rule for rules leaves is in §6). The only exceptions are things not yet in a file — the full defect list plus its grounds, the short intent for committer, a track name, the reserved REQ IDs, and similar control information.

**In Cursor, choose the model per Task at each launch.** A projected agent's `model:` is normalized to `inherit`, so do not leave it entirely to the parent's default. For judgments that machines cannot refute and for artifacts everything downstream rests on (the SSOT / DB / contract / test design / ADR / oracle, reviewer, attacker), pick whichever offered candidate degrades least in judgment quality. The deterministic zone that has a machine oracle (the 3 implementers / skeleton / committer) can be lighter, or `inherit`. Do not hardcode a specific model slug into the harness (choose from the candidates the Task's model argument offers). When the human names a model, follow it.

### Implementing human gates

**Subagents cannot talk to the user directly.** A 🙋 agent never self-approves: it returns a draft plus the points the human must settle, and stops. The confirmation ritual (AskUserQuestion / plan mode) and the status transition (`active` / `frozen` / `living`, settled UI or DB) are performed by the orchestrator. Never embed a human gate inside a subagent.

### Wiring table

| Agent | Point in the flow | Task input (passed by the orchestrator) | Role / exit |
| --- | --- | --- | --- |
| `domain-definer` | top of P1 | scope, existing domain docs (on update) | 🙋 human gate |
| `usecase-definer` | P1, per UC (∥ across UCs) | the goal's `GOAL.md`, actors, glossary, a neighboring UC directory, existing BRs; which UC(s) to write | 🙋 human gate |
| `requirement-definer` | P1, per active UC (∥ across UCs) | the UC directory, the reserved REQ IDs, glossary, existing BRs, vision (for intent) | 🙋 human gate |
| `skeleton-runner` | P2 (only when high-risk) | target subsystem, the single riskiest path, reference structure | 🔬 probe (throwaway) |
| `db-designer` | P3 | the UC directories, the BRs enforced at the DB, glossary, existing schema, framework DB rules path (if any) | 🙋 human gate |
| `contract-author` | P3 | the active UC directory, settled DB, **shared-vocabulary paths** (`_shared/components.yaml`, existing contracts) | 🤖 machine loop |
| `structure-oracle` | after P3 | the artifacts to judge (on re-judgment: previous findings + changed artifacts) | 🔴 independent judgment |
| `test-designer` | P4, before implementation | the UC directory (UC, REQs, contract), the BRs, **assigned track = `backend logic`**, framework testing-rules paths (BE bundle) | 🤖 ×1 (BE only; also writes each REQ's `## 検証方針`) |
| `frontend-ui-implementer` | P4a-1 (∥ test-designer / 4b) | the UC directory, contract response, framework rules paths (**no UI Red tests are passed**) | 🙋 human gate |
| `frontend-logic-implementer` | P4a-2 | contract, the implemented appearance, framework rules paths (**no FE Red tests are passed**) | 🤖 contract + types/lint |
| `backend-logic-implementer` | P4b (∥ 4a-1) | contract, the UC directory, BE tests (Red), framework rules paths | 🤖 machine loop |
| `slice-reviewer` | P4, after implementation | the slice, the UC directory, BE tests, change scope (on re-verification: previous defects + change scope) | 🔴 independent judgment |
| `committer` | after verification passes | intent (what / why / IDs), diff scope, whether a PR is needed (**once per slice**; hand over multiple logical changes together) | 🛠 side-effect delegation |
| `adr-writer` | when a decision occurs | Context / Decision / Consequences / rejected options, the ADR to supersede (when superseding) | 🛠 side-effect delegation |

**Never launched by this skill**: `slice-attacker`, `system-attacker` (reserved for the human-invoked `/attack`).

**Do not add a dedicated agent for the consolidated run (§4 exclusive resources).** Relaunch the same implementer that reported the skip, **alone**, with the same inputs plus the instruction "run the skipped UC IDs plus their blast radius together and settle red/green of that selection" (never "run the whole default suite").

In a rework round for the 3 implementers, add **the judge's findings (all of them, with their grounds)** to the inputs above and have them fix every item in a single launch.

### Orchestrator inline (the 3 that are never filed as agents)

- **B skeleton needed?** — after Phase1 completes, before Phase3 begins (§3 Gate)
- **J rework judgment** — when an SSOT change becomes necessary. Branch the return point on blast radius (§4 rework)
- **K concurrency judgment** — at every launch (§4 concurrency conditions)

### Actions on receipt

Every subagent returns by stopping and reporting. **The single branching criterion is "does the fix reach a human-oracle artifact?"** Always have an independent agent do the judging (never fix it yourself and then approve it yourself). Do not take a judge's report at face value — verify the grounds yourself, especially before any decision that goes outside. Do not escalate to a human what machines can settle.

| Stop/report received | From | Exit |
| --- | --- | --- |
| drafts + points to confirm (vision, glossary, actors, goals, NFRs) | domain-definer | 🙋 present → statuses set on approval / relaunch on change requests |
| `UC.md` draft + reserved REQ IDs + `?` cells / BR候補 | usecase-definer | 🙋 present → `active` on approval → launch requirement-definer on the reserved IDs / relaunch on change requests. A `?` cell is a hole: settle it with the human before approval |
| REQ / BR drafts + points to confirm | requirement-definer | 🙋 present → `active` on approval / relaunch on change requests. A BR that binds already-active UCs → re-verify those UCs' consistency (§4 rework) |
| draft + points to confirm (DB design) | db-designer | 🙋 present → settled on approval / relaunch on change requests |
| appearance + request to confirm | frontend-ui-implementer | 🙋 present → settled on approval / re-implement on change requests |
| cannot settle the contract (caused by a defect in the UC, a REQ, a BR, or the DB) | contract-author | 🙋 send back to the causing human oracle → re-derive the contract after approval |
| a contract addendum (derivable from the approved SSOT + DB) | contract-author | 🤖 relaunch to fill it in, then structure-oracle re-judges |
| a request to add vocabulary to `_shared` | contract-author | 🛠 orchestrator applies it to `docs/_shared/components.yaml` (before the next round; other in-flight contracts see it via the same path) |
| inconsistency list | structure-oracle | 🤖 send all items back in one round → re-judge on the diff scope (bounded by the circuit breaker; 🙋 if the cause is a human oracle). **On receiving an empty list, the orchestrator marks the contract `fixed`** |
| requirements or contract insufficient (a missing cell, a contradiction) | test-designer | cause is the SSOT → 🙋 (usecase- / requirement-definer) / the contract → 🤖 re-derive |
| the contract falls short (mid-implementation) | the 3 implementers | closes within the contract → 🤖 / reaches a human oracle → 🙋 |
| tests not run (skipped due to an exclusive resource) | an implementer | 🛠 close the concurrent section, delegate a consolidated run to one agent, settle red/green of the skipped UC IDs + blast radius (§4 exclusive resources and test-run granularity). Never proceed to slice-reviewer or committer with anything unexecuted |
| tests red, or a `trace-check` violation | an implementer | 🤖 send all findings back in one round → fix → re-test the reds + blast radius (bounded by the circuit breaker; 🙋 if the cause is a human oracle). Never answer a red by ordering the whole default suite |
| defect list | slice-reviewer | 🤖 send all findings back in one round → fix → re-verify on the diff scope (bounded by the circuit breaker; 🙋 if the cause is a human oracle; a missing partition class → test-designer). **On receiving an empty list, order the whole default suite and trace-check once (§4 test-run granularity), then go to committer** |
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
| the definers (`domain` / `usecase` / `requirement`), `adr-writer`, and `test-designer` for the policy section | the paths of the **docs files** created or edited in that launch (under `docs/`) |
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

- [ ] The domain (vision / glossary / actors / goals / NFRs) is approved, every started goal has its use cases, every use case's table has no empty cell, and every requirement is one falsifiable EARS sentence
- [ ] Phase3 structural consistency and contract freeze are done (zero inconsistencies)
- [ ] For every slice: the UI has been eyeballed by a human, the FE logic conforms to the contract, the BE logic is green (consistent with the requirements after integration; FE unit tests are not required for now)
- [ ] For every slice, `slice-reviewer`'s defect list is empty
- [ ] `spec-lint validate` passes and `trace-check` reports zero new violations (every active REQ covered, every declared class tested, no test outside a policy, no orphan reference, the baseline no larger than before)
- [ ] Every SSOT change that arose has been reworked upstream-first and its affected slices re-verified
- [ ] Every slice's `phase:` matches reality and reads `完了`

**"All tests passed, so it's done" is not the definition of done.** This skill's definition of done is that an independent adversarial verification could not produce a defect. Live attacks (`/attack`) are optional and are not part of it.
