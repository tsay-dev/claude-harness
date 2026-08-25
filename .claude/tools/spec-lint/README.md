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
  `transport` (`http|sdk|local-store|deeplink|push|device|internal` — `internal` is an in-process boundary the host
  has decided, in an ADR, to contract explicitly; the default under R-1204 is that such a boundary is not an operation)
  / `direction`
- **Traceability is not its job**: coverage, `@covers` / `@implements` resolution, placement ↔ frontmatter
  (C9), and numbering collisions are `../trace-check/`'s 13 checks
- **Scope of contract verification**: a contract is **not OpenAPI** — it is the harness's own boundary-contract
  format (why: `docs/adr/ADR-0001`). This tool parses it with a hand-written parser for a deliberately narrow
  YAML subset (why: `docs/adr/ADR-0002`) and checks structure: `transport` / `direction` / `owned` validity,
  `wire` only on `http`, `entry` only on `deeplink` / `push`, `source` required when `owned: false`, `auth`
  explicit on every operation and resolving in `_shared`, `errors[].code` closed to `_shared` `errorCodes`, a
  `requires` with no matching `PERMISSION_DENIED`, `errors: []` accepted as the declaration "no failure path"
  (then no failure example is demanded; an omitted `errors` is not that declaration), and success `examples`
  agreeing with the declared `request` (a failure example may carry forbidden keys — it is a counter-example).
  **Because the checker decides all of this, no agent needs to read a contract in full to judge conformance**
- **How it is used**: producers invoke it directly to machine-verify their deliverables. Wiring `gate` into a
  commit-msg hook is also possible (optional, on each project's side)

```bash
node spec-lint.mjs validate [--docs docs]     # format + lifecycle invariants + docs hygiene
node spec-lint.mjs validate --ignore-legacy-layout   # keep checking the new layout while docs/specs/ still exists (mid-migration)
node spec-lint.mjs validate --update-baseline # ledger today's errors in .spec-baseline.json; from then on only NEW errors fail
node spec-lint.mjs validate --strict          # ignore the baseline (everything fails)   [--baseline <file> to relocate it]
node spec-lint.mjs gate --message <file>       # verify a commit's UC: trailer (UC / REQs active, contract fixed) — never uses the baseline
node spec-lint.mjs gate --uc UC-012            # the same for one UC
node spec-lint.mjs convert <openapi.yaml> --uc UC-012 [--direction outbound|inbound] [--out contract.yaml] [--date YYYY-MM-DD]
```

Exit codes: `0`=OK / `1`=violation / `2`=usage error. Node only (no external dependencies).
On detecting the old layout (`docs/specs/F-xxx-<slug>/`) it prompts for `/docs-migrate` and returns `1` — unless
`--ignore-legacy-layout` is given, in which case the old directory is a warning and the new layout is checked in full.

## The baseline ratchet

The same semantics as trace-check's: `--update-baseline` records every current error (keyed by file without line
number + message, so unrelated edits that shift lines do not turn a known error into a new one; equal keys are
compared by count, so one more error of an already-ledgered kind is still new); a later `validate`
prints known errors as `known` and fails only on new ones; `--update-baseline` again shrinks the ledger once errors
are repaid. Use it for an existing project's first adoption and for the known red of a migration (`fixed` contracts
whose REQs are still `draft`, old-format files not yet converted). The ledger only shrinks (R-804) except at the
points `/docs-migrate` names. The `gate` command ignores the baseline — an implementation start is never excused.

## convert (old OpenAPI contract → harness contract)

`convert` is the mechanical half of the format change decided in `docs/adr/ADR-0001`: it reads an OpenAPI 3.x
contract with the lenient parser (block scalars folded), preserves the shape, and writes a harness contract:
`paths.*.<method>` (`operationId`) → `operations.<name>` with `transport: http` and `wire`; path / query
`parameters` + `requestBody` → one `request` object; the first 2xx → `response`; each 4xx / 5xx → `errors[]`
(`code` from `x-error-code`, else the response schema's `code` `const` / `enum`, else a status default such as
`INVALID_INPUT` for 400); `example(s)` → `examples`; `components.schemas` → the contract's own top-level `schemas:`
with `$ref` rewritten to `#/schemas/<Name>`; `security` → `auth` (`[]` = `none`); `x-status` carried over.
Every judgment it cannot make — the direction (`--direction`, default `outbound` = this app calls the API; a server's
own API is `inbound`), a missing `security`, a guessed error code, a missing `summary`, the UC (`--uc`) — is left as a
`# convert:` note at the end of the file and printed to stderr. An operation with no 4xx in the old contract comes out
with `errors: []` (no failure path is invented). The result is meant to pass `validate` after the notes are resolved.

## What it treats as an error (lifecycle and reference invariants)

- Missing required frontmatter / required sections / required `x-` keys; a status outside its vocabulary
- Directory-name violations (`GOAL-nn-<slug>`, `UC-nnn-<slug>`, `ADR-nnnn-<slug>.md`), an `id` that disagrees
  with the directory or file name, a duplicate GOAL / UC id, a missing `GOAL.md` / `UC.md`, a UC or REQ placed
  directly under a goal
- A REQ with zero or more than one EARS blockquote (one requirement, one sentence — R-401), a `pattern` outside
  the 5 EARS patterns, a `uc:` that disagrees with the directory
- A settled UC whose state × event table has an empty cell (R-501), or whose exception sweep lacks one of the 4
  axes (R-502)
- A settled document still carrying template placeholders (`UC-000`, `YYYY-MM-DD`, `<...>` …). A `<...>` counts
  when it is a string the templates themselves use, or a non-ASCII `<…>` not glued to a following word (`<言語>.lproj`
  is a meta-variable, not a hole); HTML comments, code spans / fences, and YAML comments are never scanned. A REQ's
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
| Dates in parentheses in the body (`（2026-01-01 改訂` and the like; a date followed by a particle — `（2026-02-29 は不正` — is a value under discussion, not history; code spans are skipped) | all | git holds the history. Integrate the body into the present tense |
| Implementation anchors (code file paths) | UC / REQ (not BR — a BR legitimately says "値の SSOT は `<path>`", R-102) | The code is the SSOT. Written into docs, it rots |
| Internal API references (`Class::method`) | UC / REQ | Written in the vocabulary of observable behavior |
| A "known issues / residual risks / backlog" section | UC / REQ | Open items are pushed out to issue tracking |
| Bloat (UC over 8,000 chars / REQ over 2,500 / BR over 2,500 / contract over 400 lines) | all | Measured in characters, not lines (a 1,000-character line slips under a line count) |
| An EARS sentence over 200 characters | REQ | Several requirements compressed into one (R-401) |
| Over 10 references to other UCs **in the prose** (table rows — `不可: UC-010` cells included — and the 事前条件 section are not counted: an ID there is a reference by design, not a copy) | UC | Suspected duplication of the referenced behavior. Extract a BR (R-105) |
| An NFR without a measurement, a BR without `**意図**` | NFR / BR | R-104 / the rule holds existence and intent |
| `x-*` restating business rules, a long `description` | contract | Rules and evaluation order belong to UC / REQ / BR. A contract holds only the shape |
| A UC `active` with no `contract.yaml` | UC | Declare zero boundaries (`operations: {}` + `x-no-boundary`) rather than omitting the file |
| A UC whose exception sweep derives cases but whose contract has no `errors` (a 導出 cell starting with `なし` / `—` / `-`, reason or not, counts as no derivation) | contract | The failure path has no shape at the boundary |
| `PRD.md` present, singletons missing | docs root | The old layout's remains; `/docs-migrate` |

Why these are not errors: so that an existing project's `validate` does not die instantly (cleanup happens
progressively, at the opportunities differential updates provide).
