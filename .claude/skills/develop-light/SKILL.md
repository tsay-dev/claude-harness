---
name: develop-light
description: Run a small single slice (standard CRUD and the like) fast, producing the same shape of docs, contract, and implementation artifacts as the mainline /develop, with only the depth of verification reduced. The main agent that invokes this skill acts as the orchestrator: it writes no code itself and directs the specialist subagents in .claude/agents/develop. Launch only when the human explicitly asks for light — "/develop-light", "軽量 develop", "小CRUDを light で". Never launch from "開発したい" "実装して" alone; if the work does not qualify, route to the mainline /develop.
---

# orchestrator (develop-light)

> **Role**: While this skill is active you are the orchestrator. Do not write code, run git, or author ADRs yourself — direct the specialist subagents in `.claude/agents/develop/*.md` in a separate context (Task). **The agents and rules are shared with the develop key** (there is no agents tree specific to this skill).
>
> **Where this sits**: a thin variant of the mainline `/develop`. Artifact locations and formats are identical to the mainline. What is trimmed is only the depth of verification and the number of launches. The gates (SSOT, DB where needed, contract `fixed`) are never waived.

## 1. Core constraints (never violate)

- **Human-explicit only**: the AI must never decide "this is a small CRUD" on its own and enter this skill. It is premised on the human having invoked `/develop-light` (or said something equivalent).
- **Non-implementation and context separation**: producer and judge are separate Tasks. Never write code, git, or ADRs yourself (delegate to `committer` / `adr-writer`).
- **Human gates**: the SSOT, the UI appearance, and (when touching the schema) the DB design require human approval. Subagents never self-approve; the confirmation ritual is performed by the orchestrator.
- **SSOT first, contract first**: never make code the source of truth. **Do not touch UI or implementation code before the contract is `fixed`.**
- **Implementation start gate**: identical to mainline develop §2 (no exemption for size). When something is missing, follow the return points in §5.
- **Definition of done**: green tests are a precondition, not the finish line. `slice-reviewer`'s defect list must be empty.
- **Escalation**: if the eligibility conditions break, do not push on in light — report what is unfinished and route to the mainline `/develop`.

### Language policy (these instructions are in English; the output is not)

Identical to mainline develop skill §1. **Talk to the human in Japanese, and write every deliverable (spec, contract descriptions, ledger, ADR, commit messages, in-code comments) in Japanese**; state this in every Task input. Identifiers, paths, code, and a format's reserved keywords stay as they are.

## 2. Eligibility check (immediately on launch, mandatory)

Continue only when **all** of the following hold. If even one fails, route to the mainline `/develop` and stop (never force it through light).

1. The human has explicitly asked for light
2. The target is **one feature slice**
3. The structure is not high-risk (not high-novelty, not wide blast radius, not expensive to undo)
4. Roughly 1 screen, and roughly **2 or fewer** operations added or changed (assumes standard CRUD on a single resource)
5. The main purpose is not a cross-slice NFR or a redesign of the permission model

If any of these breaks mid-run (the contract needs a large addition to the shared vocabulary, the reviewer exposes a cross-cutting defect, the SSOT touches the frozen structure, etc.), **stop there and escalate to the mainline**.

## 3. Differences from the mainline (authoritative)

| Item | `/develop` | `/develop-light` |
| --- | --- | --- |
| Entry | human-explicit or description | **human-explicit only** |
| Phase2 skeleton | conditional | **always skipped** |
| DB | always a human gate | **only when the schema changes** (otherwise skip and report why / note it in the ledger) |
| structure-oracle | independent AI judgment | **not launched** (machine lint only) |
| slice-reviewer | present | **same (×1)** |
| slice-attacker / system-attacker | not launched by that skill (`/attack` only) | **same** |
| test-designer | **×1 (`backend logic` only; UI / FE tracks not launched)** | **same (BE only, ×1)** |
| FE UI / logic | designed as 2 tracks | **sequential ui→logic** (the human eyeball happens when UI completes) |
| Circuit breaker | 3 rounds | escalate to the human at **2 rounds** |
| Implementation start gate | cannot be waived | **same** |

## 4. Overall flow

```
eligibility check
  → Phase1 SSOT (one feature)
  → Phase3 structure (only when the DB changes: db-designer → contract → machine lint → orchestrator marks the contract fixed)
  → Phase4 behavior (test-designer BE×1 ∥ FE ui → logic ∥ BE)
  → slice-reviewer
  → committer
```

### Where docs artifacts live

Identical to the mainline (the format SSOT is `.claude/templates/develop/`).

| Artifact | Location | Author |
| --- | --- | --- |
| Feature ledger | `docs/specs/specs.md` | `ssot-definer`; the phase column by the orchestrator |
| Feature spec (behavior) + GWT | `docs/specs/F-xxx-<slug>/spec.md` | `ssot-definer` |
| Boundary contract (the shape of what crosses the boundary) | `docs/specs/F-xxx-<slug>/contract.yaml` | `contract-author` |
| Shared contract vocabulary | `docs/specs/_shared/components.yaml` | **orchestrator only** |
| DB design | the location the framework/project defines (absent that, `docs/db/schema.md`) | `db-designer` (only when it changes) |
| ADR | `docs/adr/` | `adr-writer` (when a decision occurs) |

### Phase1: definition (SSOT)

- Launch `ssot-definer` (🙋). **The target is one feature** (if needed, one added ledger row plus the spec). Do not sweep the whole product.
- Done when: that feature appears in the ledger and its `spec.md` is `fixed` by human approval, with acceptance criteria covering error / loading / empty / permission / boundary.

### Phase3: structure (DB, contract, machine lint)

1. **DB branch**: if the schema is added to or changed, run `db-designer` (🙋) → `fixed` on human approval. If nothing changes, skip it and **leave the reason for skipping in the report** (a note column in the ledger or the completion report is fine).
2. **Seed `_shared` (orchestrator, inline)**: if `docs/specs/_shared/components.yaml` does not exist, create it from the template (`.claude/templates/develop/components.yaml`). If the DB was settled, reflect its vocabulary.
3. `contract-author` (🤖): derive the contract (`draft`) from the fixed SSOT (plus the fixed DB, if any).
4. **Machine lint (orchestrator, inline; no AI oracle is launched)**:
   ```bash
   node .claude/tools/spec-lint/spec-lint.mjs validate
   ```
   The contract's conformance is decided in full by `node .claude/tools/spec-lint/spec-lint.mjs validate` (it parses the contract structurally — no external validator is involved, and none is needed).
5. Once lint passes, **the orchestrator** sets `x-status` in `contract.yaml` to `fixed` (no human approval in between; never let a producer mark it `fixed`).
6. On lint failure, send all findings back in a single round to `contract-author` (or to the SSOT / DB if that is the cause).

**Not launched**: `skeleton-runner`, `structure-oracle`.

### Phase4: behavioral implementation

Only after the contract is `fixed`.

1. Launch `test-designer` **exactly once, on `backend logic`** (do not launch UI-display / frontend-logic; no FE tests for now). Never let it see the implementation code.
2. **Start on dependency**:
   - On receiving the BE Red tests, start `backend-logic-implementer` (🤖)
   - The FE runs **sequentially**: after the contract is `fixed`, `frontend-ui-implementer` (🙋 human eyeball; no UI Red tests are passed) → after approval, `frontend-logic-implementer` (🤖; no FE Red tests are passed)
   - 4a-1 **may run concurrently** with test-designer. BE **may run concurrently** with the FE ui step (as long as write targets do not intersect)
3. No dedicated integration phase (same as the mainline; the machine oracle is BE, and the FE gap is covered by the human eyeball plus `slice-reviewer`).
4. Once FE and BE implementations are both in (and if any verification was skipped for exclusivity, after a consolidated run has settled red/green of the skipped feature IDs + blast radius — mainline develop skill §4 test-run granularity), launch **`slice-reviewer`**. Iterate to zero defects (circuit breaker in §6). **No attacker is launched.**
5. If you find yourself wanting to change the contract, stop implementation and return to Phase3. If the change breaks eligibility, escalate to the mainline.

### Verification and completion

- If `slice-reviewer`'s defect list is empty, **order the whole default suite once** (mainline develop skill §4 test-run granularity), then hand off to `committer`.
- `slice-attacker` / `system-attacker` are not launched (the human runs `/attack` if needed).

## 5. Implementation start gate

Confirm before touching implementation, DB, or contract code. Return points when missing:

| # | Check | Return point when missing |
| --- | --- | --- |
| 1 | Is it listed in the ledger? | Phase1 |
| 2 | Is the target `spec.md` `fixed`? | Phase1 (only that feature's spec) |
| 3 | Is `contract.yaml` `fixed`? | Phase3 |

Excuses like "it's a small CRUD" are rejected. If all you want is lower cost, you are already in light — and if the work does not qualify, go to the mainline.

## 6. Rework, circuit breaker, ledger

- Send all findings from one round back in a single pass.
- **Circuit breaker: if the same defect survives 2 rounds, escalate to the 🙋 human** (the mainline allows 3; light escalates earlier).
- An SSOT change to behavior only → back to the current slice. A change that touches the frozen structure → re-run Phase1→3, or escalate to the mainline.
- At every phase transition, the orchestrator updates the phase column in `docs/specs/specs.md` (`定義`→`構造`→`実装`→`検証`→`完了`).
- Sorting for docs hygiene (PRD / ADR / issue / commit message) follows the mainline develop routing table.
- **Test-run granularity follows mainline develop skill §4.** A fix round runs the reds + blast radius. The whole default suite runs once before `committer`, and in CI. Never treat a mutation as a reason to fire the default-suite command.

## 7. Agent wiring

The SSOT for their personas is `.claude/agents/develop/<name>.md`. Do not duplicate mission text here. Pass the shared-vocabulary paths (`specs.md`, `_shared/components.yaml`, etc.) to every Task. Passing artifacts by path (never pasting bodies into a Task) and choosing the model at Task launch in Cursor both follow mainline develop skill §5.

**Concurrency is the default, serialization the exception**: always launch Tasks with no dependency simultaneously. Whether they can run concurrently, how to issue them, and how to handle exclusive resources are authoritative in mainline develop skill §4 (**when a producer reports that it skipped execution for exclusivity, close the concurrent section, have one agent run the skipped feature IDs plus blast radius, settle red/green of that selection, and only then move to verification**). When to run a selection vs the whole default suite is the same section (test-run granularity).

| Agent | Point in the flow | Task input | Exit |
| --- | --- | --- | --- |
| `ssot-definer` | P1 | one-feature scope, existing SSOT paths (on update) | 🙋 |
| `db-designer` | P3 (only when it changes) | SSOT, existing schema, framework DB-design rules path (if any) | 🙋 |
| `contract-author` | P3 | fixed SSOT, fixed DB (if any), shared-vocabulary paths | 🤖 |
| `test-designer` | before P4 | GWT, contract, **assigned track = `backend logic`**, framework testing-rules paths (BE bundle) | 🤖 ×1 (BE only) |
| `frontend-ui-implementer` | P4 FE-1 | SSOT, contract response, framework rules paths (**no UI Red tests are passed**) | 🙋 |
| `frontend-logic-implementer` | P4 FE-2 | contract, the implemented appearance, framework rules paths (**no FE Red tests are passed**) | 🤖 |
| `backend-logic-implementer` | P4 BE (may run ∥ FE-1) | contract, SSOT, BE tests (Red), framework rules paths | 🤖 |
| `slice-reviewer` | after implementation | the slice, GWT, contract, BE tests, change scope | 🔴 |
| `committer` | after verification passes | intent, diff scope, whether a PR is needed | 🛠 |
| `adr-writer` | when a decision occurs | Context / Decision / Consequences | 🛠 |

**Not launched**: `skeleton-runner`, `structure-oracle`, `slice-attacker`, `system-attacker`.

### Actions on receipt (essentials)

| Received | Exit |
| --- | --- |
| SSOT / DB / UI draft + points to confirm | 🙋 → `fixed`/settled on approval, relaunch if not |
| contract draft | machine lint → on success the orchestrator marks it `fixed`; on failure, send it back |
| a request to add to `_shared` | the orchestrator applies it before the next round |
| tests red, defect list | send all findings back in one round (limit 2; 🙋 if a human oracle is the cause). If the reviewer returns empty, go to committer |
| eligibility broken, cross-cutting defect | escalate to the mainline `/develop` |

## 8. Framework-specific rules (passed by path)

Rules leaves are never inlined; they are **passed as paths** in the Task input. Bundle composition and how the destination is decided are authoritative in mainline develop skill §6-A / §6-B (do not copy them here). Identify the target framework and pass the applicable leaf paths to each producer.

## 9. Definition of done (light)

- [ ] The SSOT (GWT) for the one target feature is `fixed`
- [ ] If the DB changed, it was confirmed by a human; if not, the reason for skipping is in the report
- [ ] The contract passed machine lint and is `fixed`
- [ ] The UI was eyeballed by a human, the FE conforms to the contract, the BE is green (FE unit tests are not required for now)
- [ ] `slice-reviewer`'s defect list is empty
- [ ] No eligibility condition was broken (if one was, it is handed to the mainline as unfinished)
- [ ] The ledger's phase column matches reality

**"All tests passed, so it's done" is not the definition of done.** `/attack` is not part of it.
