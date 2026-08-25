---
paths:
  - "docs/**"
  - "traceconfig.json"
---

# 📚 SDD / SSOT conventions for docs (the rules with IDs)

> **Scope: every file under `docs/` on every platform and every framework** (vision, glossary, actors, GOAL / UC / REQ, BR, NFR, ADR, verification, the boundary contracts). Cite these rules by ID in review findings and send-backs (`R-101`, not "the single-parent thing").
> **The format of each artifact is authoritative in `.claude/templates/develop/`**, and the machine checks are `.claude/tools/spec-lint` (format, lifecycle) and `.claude/tools/trace-check` (traceability C1–C12). This leaf holds only what neither a template nor a tool can hold: the principles, and who may write what.

---

## 1. SSOT principles

- **R-101 (MUST)** The body of a fact exists in exactly one place in the repository (the single-parent constraint). Everywhere else references it by ID or path and never transcribes it.
- **R-102 (MUST)** A fact that can be machine-readable (a type, a schema, a constraint, a constant, a setting) never has a document as its SSOT. The document states existence and intent only; the value and the structure live in code, the DB, or the contract.
- **R-103 (MUST)** References run one way, downstream → upstream. An upstream document never enumerates its downstream. The reverse map (which UCs use this BR, which tests cover this REQ) is derived by `trace-check`, never hand-written.
- **R-104 (MUST)** A statement with no means of verification (a test, a check, a measurement) is not written as a requirement or a rule. If it cannot be verified it is a direction, and belongs in the vision or in an ADR's Context.
- **R-105 (SHOULD)** When the same statement appears in two UCs, extract it into a business rule (BR). Duplication is the signal for extraction.

## 2. ID grammar

- **R-201 (MUST)** An ID is immutable; its content is mutable. Retirement is `status: withdrawn`, never deletion.
- **R-202 (MUST)** The ID scheme: `GOAL-nn` / `UC-nnn` / `REQ-nnn` / `BR-nnn` / `NFR-nnn` / `ADR-nnnn` / `ACT-nn` / `KPI-nn`. Numbers are never reused. A host that needs different widths changes `traceconfig.json`.
- **R-203 (MUST)** A definition is one ID, one file, declared in the frontmatter `id:` (the only exceptions are the `###` headings of `goals-backlog.md` and the ACT / KPI tables). Every other occurrence of an ID in a body is a reference.
- **R-204 (MUST)** Numbers are assigned by `node .claude/tools/trace-check/trace-check.mjs --next <goal|uc|req|br|nfr|adr>`. Never hunt for the largest number by eye. A collision (the same ID defined twice) is a C12 failure. `--next` reserves what it returns atomically (`.trace-reservations.json`, a transient file), so concurrent producer Tasks may each call it; `--next req` also counts the IDs a UC table has reserved, file or no file. `--reserve N` takes N consecutive numbers in one call.
- **R-205 (MUST)** The numeric part is fixed-width and zero-padded (lexical order = numeric order). A number carries no meaning: never bake membership or classification into an ID (membership's SSOT is the frontmatter, R-1007).

## 3. What each document may hold

| Document | Write (MUST) | Never write (MUST NOT) |
| --- | --- | --- |
| `00-vision.md` | the problem, the audience, measurable success metrics (KPI), out of scope | a feature list, screens, technology choices |
| `01-glossary.md` | term, one-sentence definition, code identifier, forbidden synonyms | class design, table definitions |
| `02-actors.md` | the closed set of actors (`ACT-nn`, system actors included) | the UCs that realize a goal (R-103) |
| `GOAL.md` | one sentence in the actor's words, `actor`, `origin` (KPI) | the list of its UCs |
| `UC.md` | scenario, the state × event table, pre/post conditions, BR **references** | the content of a BR, the content of a REQ, a list of derived REQs |
| `REQ-nnn.md` | one EARS sentence, frontmatter (`pattern`, `uc`, `br`, `status`), the verification policy | implementation means, UI detail, the content of a test case |
| `BR-nnn.md` | the rule's existence, its intent, `enforced_at` | its referrers, a value that could be machine-readable (R-102) |
| `NFR-nnn.md` | threshold + measurement method | anything unmeasurable (R-104) |
| `ADR-nnnn-<slug>.md` | Context / Decision / Consequences, the rejected options and why | the current design state (an ADR is never updated, only superseded) |
| `verification/GLOBAL.md` | the project-wide "not verified" ranges with reasons | per-REQ policy (that lives in the REQ) |
| `contract.yaml` | the shape of the boundary (operations, types, errors, examples) | a prose copy of the same content, rules, purpose |

## 4. Requirements (EARS)

- **R-401 (MUST)** One requirement, one sentence, externally observable behavior only. The test: **if every line of implementation were replaced, would the sentence still be true?** If it could become false, it is design, not a requirement.
- **R-402 (MUST)** State the pattern: `Ubiquitous` / `Event-driven` / `State-driven` / `Unwanted behaviour` / `Optional` (the frontmatter `pattern:`).
- **R-403 (SHOULD)** Every UC has at least one `Unwanted behaviour` requirement. Zero is a sign of under-examination.
- **R-404 (MUST)** Which cell of the UC's state × event table a REQ was derived from is held **by the UC's table** (the cell names the REQ). That mapping exists nowhere else and is not duplication.

## 5. Use cases

- **R-501 (MUST)** Fill every cell of the state × event table. An impossible cell says `不可` plus the reason. **An empty cell is a hole in the spec.**
- **R-502 (MUST)** Sweep every step of the main scenario for the 4 exception classes: permission, invariant violation, concurrency, external dependency.
- **R-503 (SHOULD)** A UC is "a unit of value the user completes in one sitting". Do not split down to login / logout.

## 6. Verification

- **R-601 (MUST)** The SSOT for a case's setup, action, and expected value is the test code. Never transcribe it into a document.
- **R-602 (MUST)** A test references its requirement directly with `@covers REQ-nnn#class`. No intermediate ledger of case IDs.
- **R-603 (MUST)** The coverage matrix is `trace-check`'s output and nothing else. Never hand-write one.
- **R-604 (MUST)** A verification policy always states what is **not** verified, with the reason. The test for every other line: **if this line were deleted, could it be reconstructed from the test code?** If yes, do not write it.

## 7. Connecting to code

- **R-701 (MUST)** Implementation references its upstream IDs with `@implements REQ-nnn / BR-nnn / UC-nnn` annotations (reference only, no content). Where to put them is in `comments.md`.
- **R-702 (MUST)** Layer dependency direction is enforced by lint / `trace-check` C6 (`layering` in `traceconfig.json`), never by prose alone.
- **R-703 (MUST)** Agreement between the implementation's error codes and the contract vocabulary (`docs/_shared/components.yaml` `errorCodes`) is machine-checked (C7) when the host configures `contract` in `traceconfig.json`.
- **R-704 (MUST)** The DB design's SSOT is the host's native schema source (a migration, `schema.prisma`, a model file — declared in `traceconfig.json` `schema`), never a document (R-102 applied). A BR whose `enforced_at` names the database is realized as a constraint annotated `@implements BR-nnn` in that source (C13). When a rule can be enforced at several points, the SSOT of the guarantee is decided by asymmetry — removing which point breaks correctness — and recorded in an ADR.

## 8. Change process

- **R-801 (MUST) The upstream-first rule.** When implementation exposes an error or a gap in the spec, never finish by fixing only the code: update the upstream SSOT, then re-derive (contract → tests → implementation).
- **R-802 (MUST)** A decision is changed by adding a new ADR with `supersedes:`. An existing ADR is never rewritten.
- **R-803 (MUST)** The merge condition: tests green **and** zero new `trace-check` violations.
- **R-804 (SHOULD)** The baseline (`.trace-baseline.json` and spec-lint's `.spec-baseline.json`, the ledgers of pre-existing violations) only ever shrinks. Growth is sent back in review. The one exception: when a check first applies to pre-existing material (a migration turning REQs `active`, a `fixed` contract landed before its REQs settle), the baseline records the pre-existing gaps once; the migration playbook names that point and the phase report names the count.

## 9. Kinds of control (choose knowingly)

- **R-901 (SHOULD)** For every rule, know whether it is **structural** (enforced by a type, a constraint, a check) or **persuasive** (a document, a review). Where only persuasive control exists (the glossary, for instance), say so in the document.

## 10. File granularity and the reading contract (context discipline)

- **R-1001 (MUST)** GOAL / UC / REQ / BR / NFR / ADR are one ID, one file. The file name is the ID (`REQ-047.md`; the node files are `GOAL.md` and `UC.md`, `ADR-nnnn-<slug>.md` for ADRs).
- **R-1002 (MUST)** A REQ's verification policy lives **inside the REQ file** (`## 検証方針`), so one ID's SSOT is one read. Only the project-wide exclusions go to `docs/verification/GLOBAL.md`.
- **R-1003 (MUST)** Indexes are generated, never committed. When a map of the whole is needed, run `trace-check --index`. A committed index rots on the first missed regeneration.
- **R-1004 (MUST)** Reading a whole directory (`cat docs/goals/**`) is never the default. Decide what to read from the reference graph (the table below).
- **R-1005 (SHOULD)** One file is roughly 100 lines or fewer. Past that, split, or make the value machine-readable (R-102).
- **R-1006 (MUST)** The vertical series GOAL → UC → REQ is a tree (pairwise disjoint), so the file system matches the tree: `docs/goals/<GOAL-nn-slug>/<UC-nnn-slug>/` holds `UC.md`, its `REQ-*.md`, and its `contract.yaml`; `GOAL.md` sits directly in the goal directory. The horizontal spaces (BR / NFR / ADR / glossary / `_shared`) are not disjoint and stay central under `docs/`. Mixed layouts (flat and nested) are forbidden.
- **R-1007 (MUST)** Membership's SSOT is the frontmatter (`goal:` on a UC, `uc:` on a REQ, `x-uc:` on a contract); the directory is only placement. Directory-prefix ↔ `id` agreement, the presence of the node file, and a REQ sitting directly under its own `uc:` are checked by `trace-check` C9. To reorganize, update the frontmatter first and move files by following C9's violations.
- **R-1008 (SHOULD)** A goal not yet started lives in `docs/goals-backlog.md` and is promoted to a directory when work begins (never create an empty directory).

### The reading contract per task (what a Task input passes)

| Task | Read | Do not read |
| --- | --- | --- |
| implement / test `REQ-nnn` | that REQ, the `UC.md` beside it, the BRs its `br:` names, related ADRs | other REQs, the vision, every BR |
| add a UC | `02-actors.md`, the goal's `GOAL.md`, `01-glossary.md`, the UC template, one neighboring UC directory in the same goal | other goals' directories |
| implement the vertical slice `UC-nnn` | the whole UC directory (`ls` defines the scope), the referenced BRs, related ADRs | other UC directories |
| change `BR-nnn` | that BR, `trace-check`'s C4 output (its referrers), related ADRs | — |
| get the whole picture (session start) | `trace-check --index` output only | file bodies |
| review | the changed files plus their frontmatter references | — |

To find an ID from meaning, grep the frontmatter first: `grep -rl "uc: UC-012" docs/goals/`, `grep -rl "IDOR" docs/rules/`.

## 11. Partition classes (the lower and upper bound of test generation)

The test code is the SSOT for case content, but "why this test exists" and "how many are enough" cannot be reconstructed from code. Those two are made machine-checkable by declaring partition classes.

- **R-1101 (MUST)** Every `active` REQ's `## 検証方針` declares one or more partition classes as `` - `#name` — one line of intent ``. **The class list = the SSOT for the full set of tests that must exist for that requirement.**
- **R-1102 (MUST)** Every test names exactly one declared class with `@covers REQ-nnn#class`. A `@covers` with no class, or naming an undeclared class, is a violation (C11).
- **R-1103 (MUST)** To add a test, first declare its class in the policy (R-801 applied). This is the **upper bound** on AI-generated tests: a test outside the policy fails C11.
- **R-1104 (MUST)** Every declared class is covered by at least one test (C10). An input region deliberately not verified is not declared as a class; it goes in `検証しない` with its reason.
- **R-1105 (SHOULD)** One class per equivalence class. Several tests per class is fine (several boundary points); one test spanning several classes is a failed partition.

**What the machine cannot see (know this):** C10 / C11 guarantee agreement between declaration and implementation. Whether the partition exhausts the input space, and whether an assertion verifies the meaning of the EARS sentence, remain the reviewer's responsibility (R-901 persuasive control).

## 12. Contracts in general (boundaries that are not HTTP)

A contract is a **machine-readable agreement at a boundary between two parties with different ownership, change cadence, or lifetime**. HTTP is one case.

- **R-1201 (MUST)** At the start (Phase 1 of a migration), enumerate the boundaries and assign each a contract SSOT and a checker. Consider at least: (a) **time** — persisted data written by a shipped version, (b) **the OS / platform**, (c) **between modules** (public types), (d) **an external API we do not own**.
- **R-1202 (MUST) The time boundary.** Data actually written by each shipped version is kept as golden fixtures under `contracts/fixtures/` (**append-only**; editing an existing fixture is itself a contract violation). A test proves the current code can read every fixture, declared as the partition class `#persist-vN-compat`. For an app that lives entirely on the device, this is the most important contract there is.
- **R-1203 (MUST)** OS contracts (Info.plist, entitlements, a manifest) are machine-readable and therefore their own SSOT. Never transcribe them into prose (R-102).
- **R-1204 (SHOULD)** Between modules the language's type system is the contract and the compiler plus C6 are the checkers. Unintended public-API drift may be watched with a snapshot comparison (the same shape as the baseline ratchet).
- **R-1205 (SHOULD)** An external API is held defensively on the client side: a DTO layer, recorded-response fixtures, and tolerant decoding that ignores unknown fields.
- **R-1206 (MUST)** Every UC carries `contract.yaml` (the harness format, not OpenAPI — why: `docs/adr/ADR-0001`). A UC that crosses no boundary **declares** it with `operations: {}` and `x-no-boundary: <reason>`; it never simply lacks a contract (that would open a hole in the implementation start gate). Never fabricate an HTTP operation for a boundary that is not HTTP.
