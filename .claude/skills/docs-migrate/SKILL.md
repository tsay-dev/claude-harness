---
name: docs-migrate
description: Bring a project's docs and code into conformance with the harness's SDD/SSOT layout (docs/goals/GOAL-nn/UC-nnn/ with EARS requirements, BR/NFR/ADR, boundary contracts, @covers/@implements annotations, trace-check), phase by phase with a human review gate at the end of each phase. Handles both a harness host on the old F-xxx layout and an existing project with no harness docs at all. Triggers on /docs-migrate or on phrases such as "docs を移行して" "docs が harness に準拠しているかチェックして" "SDD に準拠させて" "docs レイアウトを最新化して" (migrate the docs / check the docs conform / make it SDD-conformant / bring the docs layout up to date).
---

# 🔧 docs-migrate — phased conformance of an existing project (sdd-conform)

> **This skill does not own the definition of conformance.** Authority always rests with "the current harness's spec-lint + trace-check + the templates in `.claude/templates/develop/` + the conventions leaf `.claude/rules/develop/docs.md`". This skill holds only the playbook for getting there. When the harness is revised, those become the new authority and this skill follows without being rewritten.
>
> **Role**: While this skill is active you are the orchestrator. You do mechanical relocation yourself (the oracle is a machine); you delegate every content conversion to the producer that owns the format (the definers, `contract-author`, `test-designer`, `adr-writer`, `committer`), in separate contexts. **Language**: these instructions are in English, the output is not. Report to the human in Japanese; migrated docs stay in Japanese. State this in every Task input.

## Absolute rules (stop and ask the human on any violation)

- **A-1 No invention.** Never write a behavior as a requirement, a rule, or a table cell unless it can be read from existing code, docs, or tests. What cannot be read goes to `OPEN-QUESTIONS.md` as a question. **Inventing a plausible spec is this playbook's worst failure mode.**
- **A-2 No destruction.** Never delete an existing document. What has served its purpose moves to `docs/attic/` with a one-line tombstone at the old location (`git mv`, never copy-and-delete).
- **A-3 Behavior unchanged.** Through every phase, production behavior does not change. Permitted code changes: adding annotation comments, extracting a constant (value unchanged), moving files. A behavioral bug found on the way is not fixed — it goes to `OPEN-QUESTIONS.md` (fixing is `/develop`'s work).
- **A-4 Phase gate.** Stop at the end of every phase and have the human review the deliverables before the next. One phase = one commit (or commit group, via `committer`); never mix changes across phases.
- **A-5 Ratchet.** `trace-check` is introduced in Phase 1 with a baseline, and `spec-lint` runs with `--ignore-legacy-layout` plus its own baseline (`.spec-baseline.json`) until Phase 7; every phase keeps "zero new violations" (R-803). The baselines only shrink (R-804) with **exactly two sanctioned growths**, both the honest recording of pre-existing gaps and both named with their count in the phase report: spec-lint at the end of Phase 5 (`fixed` contracts whose REQs are still `draft` — the migration's order is contract before REQ) and trace-check at the end of Phase 6 (REQs turned `active` whose existing tests do not exhaust their classes — C1 / C10 first apply there). No growth after Phase 6.
- **Only the orchestrator writes `OPEN-QUESTIONS.md`.** Producers return their questions in their report; you append. Concurrent writers to one file corrupt it.
- **Cross-cutting single-file edits happen before a fan-out, never beside it.** Distributing `@implements` over a shared file, annotating every GOAL, editing `traceconfig.json` or `_shared` — do these alone, then launch the per-UC Tasks (anchor mismatches from concurrent edits to one file are otherwise guaranteed). An independent verifier and a fixer never share a working tree at the same time (sequence them, or give the verifier a worktree). Exclusive build resources (`xcodebuild` and the like) are serialized, and a test count is compared with the previous run's before it is believed.
- **Preserve approval state.** Migration neither promotes nor demotes: what was `fixed` (old) becomes `active` (new); what was `draft` stays `draft`. The one deferral: REQs approved in Phase 4 are written `active` only in Phase 6, once tests are connected (see A-5) — the approval itself is recorded in the Phase 4 report.
- **Never silently drop information.** Anything with no home in the new layout is routed per develop skill §4 "Routing information" (ADR, issue, commit message, attic) and named in both the plan and the report.

## Phase 0: inventory (no rewrites)

1. Run `node .claude/tools/spec-lint/spec-lint.mjs validate` once (add `--ignore-legacy-layout` when it stops on `docs/specs/`, so the rest of the report appears) and classify:
   - **Conformant** (exit 0, warnings only) → report the warnings as "handled in the next develop differential update" and **stop** (an invocation that is only a check ends here).
   - **Old harness layout detected** (`docs/specs/F-xxx-<slug>/`, `PRD.md`, `docs/specs/_shared`, dated ADR file names) → the mapping in Phase 2–5 below applies file by file.
   - **No harness docs** (an existing project) → the extraction playbook in Phase 2–6 applies.
2. Walk the repository and write `docs/INVENTORY.md` from the template `.claude/templates/docs-migrate/INVENTORY.md`: one row per document, README, spec-like comment block, or wiki file, classified as **SSOT候補 / 派生物 / 重複 / 不明・死蔵**, with the proposed treatment. For each duplicate pair, one line on which copy becomes the body.
3. From the code, list the core resources (entities) and their state values verbatim (glossary material; note every spelling variant).
4. Create `OPEN-QUESTIONS.md` and record every classification you hesitated over and every contradiction found.

**Deliverables**: `docs/INVENTORY.md`, `OPEN-QUESTIONS.md`. **Stop (🙋)**: the human approves the classification, above all "which copy is the body".

## Phase 1: skeleton and checks

1. Create `docs/goals/`, `docs/rules/`, `docs/nfr/`, `docs/adr/`, `docs/verification/`, `docs/_shared/`, `docs/attic/` (a directory that stays empty is not created — R-1008).
2. Seed `traceconfig.json` at the host root from `.claude/templates/develop/traceconfig.json` and edit `source` / `tests` / `layering` / `id_patterns` to the project's language, paths, and ID widths. **Enumerate the boundaries** (R-1201: time / OS / between modules / external API); set the `contract` block only when the implementation has a single error-code source (otherwise C7 skips). Seed `docs/_shared/components.yaml` from its template (on the old harness layout: `git mv docs/specs/_shared/components.yaml docs/_shared/components.yaml`).
3. Run `node .claude/tools/trace-check/trace-check.mjs --update-baseline` and `node .claude/tools/spec-lint/spec-lint.mjs validate --ignore-legacy-layout --update-baseline` to record the initial baselines (on the old layout the known red is the OpenAPI contracts, `PRD.md`, the old `_shared`). Add "tests + spec-lint + trace-check" to CI (or to a hook's stop condition) — a stub that calls the harness workflow is enough; pass `spec_lint_args: --ignore-legacy-layout` to the reusable workflow until Phase 7 removes it. From here every producer runs the plain commands (never an `rsync`ed copy of `docs/`).

**Deliverables**: the skeleton, a working check, the baseline. **No content is written in this phase.**

## Phase 2: vocabulary, actors, goals (`domain-definer`)

Delegate to **`domain-definer`** (`.claude/agents/develop/domain-definer.md`) with the inventory, the glossary material, and the existing material as paths, and the instruction **"extract, do not invent (A-1)"**:

1. `01-glossary.md` from the Phase 0 material — the main labor is collecting spelling variants into the forbidden-synonym column; the canonical term follows the majority in existing code; doubts go to `OPEN-QUESTIONS.md`.
2. `00-vision.md` from the old `PRD.md` / README (the Why, the audience, out of scope). **A KPI with no number in the material is written as `未計測`**, with a question in `OPEN-QUESTIONS.md`. On the old layout, `PRD.md`'s cross-cutting business principles are BR candidates — mark them for Phase 4. Then `git mv docs/PRD.md docs/attic/PRD.md`.
3. `02-actors.md` from authentication / authorization code and existing docs, system actors included.
4. Goals: on the old layout, group the `F-xxx` features by the actor's goal (the ledger's 概要 column is the material); each group becomes a `GOAL-nn-<slug>/GOAL.md` (started) or a backlog entry. Existing NFR-like statements become `docs/nfr/NFR-nnn.md` only if they carry a measurement.

**Stop (🙋)**: the canonical terms and forbidden synonyms — every later document is bound by this vocabulary. On approval, set the statuses (`frozen` / `living` / `active`).

## Phase 3: use cases and the state × event table (`usecase-definer`)

1. List UC candidates from the entry points (controllers, CLI commands, jobs; on the old layout, one `F-xxx` is usually one UC, sometimes two `F-xxx` fold into one sitting) and bundle them to R-503 granularity.
2. **Reserve a REQ band per UC before launching**: run `trace-check --next req` once (it counts IDs already reserved in UC tables) and hand each Task a disjoint range in launch order (20–30 numbers each is plenty; a number carries no meaning, R-205, so gaps are fine). Concurrent Tasks never call `--next req` themselves — they would all get the same number. Then delegate to **`usecase-definer`** per UC (concurrently across UCs; A-1 and the band in every input): `docs/goals/<GOAL-nn-slug>/<UC-nnn-slug>/UC.md`. **The state × event table is filled from the branches in existing code** (and, on the old layout, from `spec.md`'s 状態 section and its GWT). A cell with no corresponding branch is **not filled — it stays `?`** and goes to `OPEN-QUESTIONS.md`. Finding the holes is this phase's value.
3. The same validation or the same rule seen in several UCs is left as a `<!-- BR候補 -->` marker (an HTML comment; spec-lint does not scan comments for placeholders).

**Stop (🙋)**: the UC granularity and the list of holes. On approval, `status: active`.

## Phase 4: requirements and business rules (`requirement-definer`)

1. Delegate to **`requirement-definer`** per active UC (concurrently; A-1): each reserved cell becomes one `REQ-nnn.md` (EARS, one sentence) directly under the UC directory. **The REQ IDs are the ones the UC's table reserved in Phase 3** — pass them as input; the definer never calls `--next req` (R-204's numbering happened in Phase 3; concurrent calls collide). BR numbers come from `--next br`, which collides the same way under concurrency: run the BR extraction as a second, serial pass (one Task at a time), or reserve BR bands as in Phase 3. On the old layout, `spec.md`'s `業務ルール` bullets are the primary source (one bullet ≈ one REQ or one BR); its `受け入れ条件` (GWT) are evidence for the cell mapping, not requirements. Where an existing test observes the behavior, that observation is the sentence's grounds. `## 検証方針` stays the scaffold until Phase 6.
2. BR candidates become `docs/rules/BR-nnn.md` (one rule, one file) and the UC / REQ side is replaced by ID references (R-101 / R-105).
3. **Apply R-102**: for every BR value (threshold, enumeration, uniqueness), look for the existing constant, DB constraint, or schema. If it exists, declare it the SSOT and write only existence and intent. The same value hard-coded in several places goes to `OPEN-QUESTIONS.md` (consolidating it needs a behavior check — outside A-3).
4. Replace duplicate passages in existing documents with references and move the originals to the attic (A-2). On the old layout, `git mv docs/specs/F-xxx-<slug>/spec.md docs/attic/specs/F-xxx-<slug>/spec.md` once its content has a home, and leave a tombstone.

**Stop (🙋)**: the REQ list and the BR extraction. This is the center of conformance; spend the most time here. On approval, the BRs go `active`; **the REQs stay `draft` until Phase 6** (turning them `active` before the tests are connected fires C1 / C10 on every one and breaks the ratchet) — record the approval in the report.

## Phase 5: contracts and decision archaeology (`contract-author`, `adr-writer`)

1. **Contracts**: on the old layout the contracts are OpenAPI (`docs/specs/F-xxx-<slug>/api-contract.yaml`). Convert each one mechanically, yourself, inline: `node .claude/tools/spec-lint/spec-lint.mjs convert docs/specs/F-xxx-<slug>/api-contract.yaml --uc UC-nnn --direction <inbound for a server's own API / outbound for an API this app calls> --out docs/goals/<GOAL>/<UC>/contract.yaml`. The converter preserves the shape (operations, request / response, 4xx → `errors`, `components.schemas` → the contract's own `schemas:`, `x-status` carried over so `fixed` stays `fixed`) and leaves a `# convert:` note for every judgment it could not make (auth, an error code it had to guess, a missing summary). Then delegate to **`contract-author`** only the resolution of those notes plus the `_shared` migration (`components.schemas` → `schemas`, `securitySchemes` → `authSchemes`, error codes → `errorCodes`, applied by you) — **never a re-derivation**; a feature that split or merged into UCs is converted first and then split / merged by `contract-author`. An operation with no 4xx in the old contract comes out as `errors: []` (a declared absence of failure paths) — never invent an error code to produce a failure example. A project with no contracts: delegate per UC with the instruction "transcribe the boundary the code actually exposes" (A-1; `owned: false` + `source` for third-party boundaries; `operations: {}` + `x-no-boundary` for a UC with none). **Transport is decided once, uniformly, by the template header's table** — persistence → `local-store`, an OS capability → `device`, a third-party SDK → `sdk`, and a boundary between the app's own modules is not an operation at all (R-1204). When the old contracts modeled internal boundaries as HTTP, record that reading in one ADR and apply it to every UC; individual authors do not re-decide it. Then `git mv` the old file to the attic (A-2).
2. **ADRs**: on the old layout, `git mv docs/adr/NNNN-YYYY-MM-DD-title.md docs/adr/ADR-NNNN-title.md` and add the frontmatter (`id` / `title` / `status: accepted` / `date` from the old file name); move the "rejected options" paragraph into `## 却下した選択肢` (delegate to `adr-writer` if the content needs restructuring). For a project with no ADRs, delegate to **`adr-writer`** the main choices of the current architecture (layering, where authorization sits, persistence strategy, framework) **as records of the present**; the Context may honestly say "the history is unknown" and 却下した選択肢 uses the template's fixed line `- **記録なし**: 当時の比較は記録されていない（移行時に付した記録）` (A-1; spec-lint accepts it). Cite git log / PRs / commit messages in the Context only where they exist.

**Stop (🙋)**: the ADRs match reality; the contracts kept their shape. Then `spec-lint validate --ignore-legacy-layout --update-baseline` once — this is the first sanctioned growth (A-5): `fixed` contracts over REQs that stay `draft` until Phase 6. Name the count in the report.

## Phase 6: connecting verification (`test-designer`)

1. Set `tests.test_pattern` / `tests.exempt_pattern` in `traceconfig.json` first, so that a test left without `@covers` is counted by C11 rather than surviving only in a report. Then delegate to **`test-designer`** per UC **in `annotate-existing` mode** (pass the mode and the paths of the existing test files; the mode replaces its default Red-test brief): **declare the partition classes in each REQ's `## 検証方針`** from the existing tests' observations (R-1101), then annotate the existing tests with `@covers REQ-nnn#class` (R-1102) and the UC tag; an out-of-spec test gets the exempt marker. **A test that fits no REQ is guaranteed to appear**: either (a) a requirement was missed → back to Phase 4, or (b) it tests an implementation detail outside the spec → say so inside the test. Doubts go to `OPEN-QUESTIONS.md`. **Never justify an existing test's partition after the fact**; a REQ whose partition is not exhausted is recorded honestly as under-covered and stays in the baseline.
2. Add `@implements REQ-nnn / BR-nnn / UC-nnn` to the implementation (comments only, A-3) — delegate to the implementer that owns the layer, with the comments leaf passed by path.
3. Turn the REQs `active` (the human approved them in Phase 4; they stayed `draft` only so that C1 / C10 would not fire before tests were connected), run `trace-check`, and take the C1 list (unverified requirements). This run is the second sanctioned growth (A-5): C1 / C10 now see every partition the existing tests never exhausted. Record it once with `--update-baseline`, name the count in the report, and treat it as the honest ledger of under-coverage — not as a regression to be hidden by narrowing the classes. **The only new tests allowed here fix the current behavior as an observation** (characterization tests). If the expected behavior seems to differ from the current one, it goes to `OPEN-QUESTIONS.md`, not into a test.
4. `docs/verification/GLOBAL.md` holds only the project-wide "not verified" ranges.

**Stop (🙋)**: the coverage matrix and the baseline balance.

## Phase 7: repayment plan and steady state

1. List the baseline's remaining violations as repayment issues, prioritized C1 > C7 > C4 > the rest.
2. Record the steady-state rules in the host's `CLAUDE.md` / README: the merge condition (tests green + zero new violations, R-803), the upstream-first rule (R-801), the shrinking baseline (R-804).
3. `git rm` the emptied old directories (`docs/specs/`), re-point every remaining reference to old paths (the project's `CLAUDE.md`, README, CI config, hooks), drop `--ignore-legacy-layout` from CI, run `spec-lint validate` (no flag; `.spec-baseline.json` empty or every entry a repayment issue) and `trace-check` one last time, and delegate the commit to **`committer`** (intent: docs layout migration, with a summary of the mapping).
4. From here on, new development follows `/develop` (GOAL → UC → REQ → contract → verification → implementation).

## When in doubt

1. The rule IDs in `.claude/rules/develop/docs.md` > the templates > this playbook > common sense.
2. Still undecided → write the options and a recommendation in `OPEN-QUESTIONS.md` and stop. **Never proceed on a guess.**

## Definition of done

- Every INVENTORY row is resolved as SSOT / generated / reference / attic
- `spec-lint validate` exits 0 without `--ignore-legacy-layout`, and `spec-lint --strict` / `trace-check --strict` are green or every remaining violation is a repayment issue
- `OPEN-QUESTIONS.md` is empty, or every item carries a human answer

## What this skill does not do

- **Improve specs** (rewriting requirements for clarity, relieving bloat) — warnings only; they get done in a `/develop` differential update.
- **Fix the harness itself** — a flaw in a lint, a template, or the conventions leaf is reported to the human, never patched mid-migration (never move the conformance target during a migration).
- **Fabricate `design.md`** — if absent, report it as "optional, not written". Writing it is for the human (or on the human's instruction).
