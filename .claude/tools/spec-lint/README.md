# spec-lint

A zero-dependency Node tool bundled with the harness that mechanically verifies the **format and lifecycle** of
the docs SSOT (the singletons, GOAL / UC / REQ, BR / NFR / ADR, the boundary contracts).

- **The layout it verifies**: `docs/00-vision.md` `01-glossary.md` `02-actors.md` (+ optional
  `goals-backlog.md`, `design.md`, `verification/GLOBAL.md`), `docs/goals/GOAL-nn-<slug>/GOAL.md`,
  `…/UC-nnn-<slug>/` (`UC.md`, `REQ-nnn.md`, `contract.yaml`), `docs/rules/BR-nnn.md`, `docs/nfr/NFR-nnn.md`,
  `docs/adr/ADR-nnnn-<slug>.md`, `docs/_shared/components.yaml`
- **The format it verifies**: the SSOT is the templates in `../../templates/develop/`. Required frontmatter
  keys (a key whose template comment says `optional` is optional), required sections, and the contract's
  required `x-` keys are **derived from the templates** (revise the format by editing the template and the
  lint follows). The closed vocabularies live here because only executable code can enforce them:
  `status` (`draft|active|withdrawn` on nodes, `draft|frozen|living` on singletons, `proposed|accepted|superseded`
  on ADRs, `draft|fixed` on contracts), `phase` (`定義|構造|実装|検証|完了`), `pattern` (the 5 EARS patterns),
  `transport` / `direction`
- **Traceability is not its job**: coverage, `@covers` / `@implements` resolution, placement ↔ frontmatter
  (C9), and numbering collisions are `../trace-check/`'s 12 checks
- **Scope of contract verification**: a contract is **not OpenAPI** — it is the harness's own boundary-contract
  format (why: `docs/adr/ADR-0001`). This tool parses it with a hand-written parser for a deliberately narrow
  YAML subset (why: `docs/adr/ADR-0002`) and checks structure: `transport` / `direction` / `owned` validity,
  `wire` only on `http`, `entry` only on `deeplink` / `push`, `source` required when `owned: false`, `auth`
  explicit on every operation and resolving in `_shared`, `errors[].code` closed to `_shared` `errorCodes`, a
  `requires` with no matching `PERMISSION_DENIED`, and `examples` agreeing with the declared `request`.
  **Because the checker decides all of this, no agent needs to read a contract in full to judge conformance**
- **How it is used**: producers invoke it directly to machine-verify their deliverables. Wiring `gate` into a
  commit-msg hook is also possible (optional, on each project's side)

```bash
node spec-lint.mjs validate [--docs docs]     # format + lifecycle invariants + docs hygiene
node spec-lint.mjs gate --message <file>       # verify a commit's UC: trailer (UC / REQs active, contract fixed)
node spec-lint.mjs gate --uc UC-012            # the same for one UC
```

Exit codes: `0`=OK / `1`=violation / `2`=usage error. Node only (no external dependencies).
On detecting the old layout (`docs/specs/F-xxx-<slug>/`) it prompts for `/docs-migrate` and returns `1`.

## What it treats as an error (lifecycle and reference invariants)

- Missing required frontmatter / required sections / required `x-` keys; a status outside its vocabulary
- Directory-name violations (`GOAL-nn-<slug>`, `UC-nnn-<slug>`, `ADR-nnnn-<slug>.md`), an `id` that disagrees
  with the directory or file name, a duplicate GOAL / UC id, a missing `GOAL.md` / `UC.md`, a UC or REQ placed
  directly under a goal
- A REQ with zero or more than one EARS blockquote (one requirement, one sentence — R-401), a `pattern` outside
  the 5 EARS patterns, a `uc:` that disagrees with the directory
- A settled UC whose state × event table has an empty cell (R-501), or whose exception sweep lacks one of the 4
  axes (R-502)
- A settled document still carrying template placeholders (`UC-000`, `YYYY-MM-DD`, `<...>` …). A REQ's
  `## 検証方針` is exempt — its content is trace-check's C2 / C10
- A contract `fixed` while its UC is `draft` or while any of its REQs is still `draft`; a UC `draft` whose
  `phase` has advanced past `定義`; an `x-spec` or `$ref` that does not resolve; an ADR whose `supersedes`
  does not exist
- Syntax outside the accepted YAML subset: anchors / aliases (`&` / `*`), block scalars (`|` / `>`), tabs,
  duplicate keys; a contract still in OpenAPI form, or `api-contract.yaml` left in a UC directory
- An operation missing `transport` / `direction` / `owned` / `auth` / `summary`, or holding a field that does
  not belong to its transport; `operations: {}` with no `x-no-boundary` reason

## Docs-hygiene detection (all warnings)

Warns on signs that a document is drifting from "present-tense invariants" into a dumping ground (the SSOT for
the negative lists is each producer's craft):

| Detection | Target | What it means |
| --- | --- | --- |
| Dates in parentheses in the body (`（2026-01-01` and the like) | all | git holds the history. Integrate the body into the present tense |
| Implementation anchors (code file paths) | UC / REQ (not BR — a BR legitimately says "値の SSOT は `<path>`", R-102) | The code is the SSOT. Written into docs, it rots |
| Internal API references (`Class::method`) | UC / REQ | Written in the vocabulary of observable behavior |
| A "known issues / residual risks / backlog" section | UC / REQ | Open items are pushed out to issue tracking |
| Bloat (UC over 8,000 chars / REQ over 2,500 / BR over 2,500 / contract over 400 lines) | all | Measured in characters, not lines (a 1,000-character line slips under a line count) |
| An EARS sentence over 200 characters | REQ | Several requirements compressed into one (R-401) |
| Over 10 references to other UCs | UC | Suspected duplication of the referenced behavior. Extract a BR (R-105) |
| An NFR without a measurement, a BR without `**意図**` | NFR / BR | R-104 / the rule holds existence and intent |
| `x-*` restating business rules, a long `description` | contract | Rules and evaluation order belong to UC / REQ / BR. A contract holds only the shape |
| A UC `active` with no `contract.yaml` | UC | Declare zero boundaries (`operations: {}` + `x-no-boundary`) rather than omitting the file |
| A UC whose exception sweep derives cases but whose contract has no `errors` | contract | The failure path has no shape at the boundary |
| `PRD.md` present, singletons missing | docs root | The old layout's remains; `/docs-migrate` |

Why these are not errors: so that an existing project's `validate` does not die instantly (cleanup happens
progressively, at the opportunities differential updates provide).
