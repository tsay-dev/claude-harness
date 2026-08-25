# trace-check

A zero-dependency Node tool bundled with the harness that mechanically verifies **traceability** between
the docs SSOT (GOAL → UC → REQ, BR) and the code (tests, implementation): coverage, references, placement,
layering, and the contract vocabulary. It is the Node port of sdd-kit's `trace_check.py` (why the port:
`docs/adr/ADR-0003`).

- **What it verifies**: the 13 checks below. **Format and lifecycle** (frontmatter, sections, status
  vocabularies, the contract's structure) are `../spec-lint/`'s job; the two tools do not overlap
- **What it reads**: `traceconfig.json` at the host project root (seeded once from
  `.claude/templates/develop/traceconfig.json`; the host maintains `source` / `tests` / `schema` / `layering` / `contract`).
  Annotations are found by regex on every line (`covers_pattern` / `implements_pattern`), so any language works;
  `implements_pattern`'s capture may be a list (`@implements UC-001, REQ-009 / BR-015` — split on `,` or `/`)
- **What it generates**: the coverage matrix (its report) and the whole-project index (`--index`). Both are
  derived, never committed (R-1003 / R-603)
- **How it is used**: producers invoke it directly (`--only` narrows to their concern), the orchestrator runs
  it at the end of a slice (the merge condition is tests green + zero new violations, R-803), and CI runs it

```bash
node trace-check.mjs [--root .] [--config traceconfig.json]   # the checks; exit 1 on a NEW violation
node trace-check.mjs --update-baseline                        # record today's violations as the baseline
node trace-check.mjs --strict                                 # ignore the baseline (everything fails)
node trace-check.mjs --index                                  # the whole-project map, one line per ID
node trace-check.mjs --next req [--reserve N]                 # the next N free IDs (goal|uc|req|br|nfr|adr), one per line — R-204. Atomic:
                                                              # the numbers are reserved in .trace-reservations.json under a mkdir lock, so
                                                              # concurrent Tasks can all call it and never receive the same number. For req,
                                                              # IDs a UC.md table has reserved count as taken even before the file exists
node trace-check.mjs --only C9,C12                            # judge only these checks (a producer's self-check)
```

Exit codes: `0` = no new violation / `1` = new violation / `2` = usage error. Node only.

## The 13 checks

| # | Fails when | Rule |
| --- | --- | --- |
| C1 | an `active` REQ has no test that `@covers` it | R-1104 |
| C2 | an `active` REQ has no `## 検証方針` section | R-1002 |
| C3 | a test `@covers` a REQ that does not exist | R-602 |
| C4 | a BR is referenced by no UC and no REQ (a dead rule) | R-103 |
| C5 | code `@implements` an ID that does not exist (an orphan reference) | R-701 |
| C6 | a layer imports a layer it must not (`layering` in the config; `layer_pattern` names the path level that is the layer — `{layer}` = the first level under `root`, `*/{layer}` = the second, as in `Features/<name>/Domain`). C6 sees only `import_patterns`: a language whose layers share one module and never import each other (a single-module Swift app) gives it nothing to match, and a green C6 there is silence, not proof — enforce the direction with the platform linter instead and leave `layering` unset | R-702 |
| C7 | the implementation's error codes are not a subset of `docs/_shared/components.yaml` `errorCodes` (only when `contract` is configured) | R-703 |
| C8 | an `active` GOAL has no UC realizing it | — |
| C9 | placement disagrees with the frontmatter: directory prefix ≠ `id`, `GOAL.md` / `UC.md` missing, a REQ's file name ≠ `id`, a REQ not directly under its own `uc:`, a UC's `goal:` ≠ its directory | R-1006 / R-1007 |
| C10 | a declared partition class has no test, or an `active` REQ declares none (the lower bound) | R-1101 / R-1104 |
| C11 | a test names no class, or an undeclared one (the upper bound on generated tests); and, when `tests.test_pattern` is configured, a test function that carries no `@covers` at all — an unannotated test is invisible to C10 / C11 otherwise. A test carrying `tests.exempt_pattern` (an explicit `// 仕様外:` marker) is counted as exempt, not missing. A test's identity is **file + name** (`test_pattern` must capture the name), so the ledger never depends on line numbers. Where the annotation sits is **declared**, not guessed: `tests.covers_placement: before` (default — the doc comment right above the test mark) or `after` (the mark's line and the first lines of the body); trace-check looks only in that window, and an `@covers` outside every window is reported as belonging to no test | R-1102 / R-1103 |
| C12 | the same ID is defined in more than one file (a numbering collision) | R-204 |
| C13 | a BR whose `enforced_at` names the database has no `@implements BR-nnn` in the schema source (`schema.files` / `schema.dirs`; only when configured) | R-704 |

Only `active` docs are subject to C1 / C2 / C8 / C10 — a `draft` REQ demands nothing yet, and a `withdrawn`
one demands nothing any more. C11 applies to every test regardless.

## The baseline ratchet (adopting it on an existing project)

The first run on an existing project produces many violations. Do not leave CI red until they are all paid off:

```bash
node .claude/tools/trace-check/trace-check.mjs --update-baseline   # ledger today's violations → CI green
node .claude/tools/trace-check/trace-check.mjs                     # from now on only NEW violations fail
# as debts are paid, --update-baseline shrinks the ledger; when it is empty, switch to --strict
```

The ledger is keyed by the message with every `<file>:<line>` reduced to `<file>` (an unannotated test is identified
by its name, so the entry survives any edit that keeps the name), and equal keys are compared by count (the report
keeps the line numbers for navigation).

Only "no worse than today" is enforced at first; repayment is planned. **The baseline only ever shrinks**
(R-804) — a review sends back any growth. Whether `.trace-baseline.json` is monotonically decreasing is the
project's health indicator. The one sanctioned growth is the moment a check first applies to pre-existing material
(a migration turning REQs `active`, so C1 / C10 see partitions the existing tests never exhausted): it is recorded
once with `--update-baseline`, named with its count in that phase's report, and never repeated (`/docs-migrate` Phase 6).

## What green does and does not guarantee

When the tests and these 13 checks are all green, the following holds mechanically: every active GOAL has a UC
and every active REQ a test; every declared partition class has a test **and no test exists outside the
policy**; every ID referenced from code and tests exists; no rule is dead; no ID is defined twice; placement
agrees with the frontmatter; the dependency direction and the contract vocabulary agree with the implementation; every rule enforced at the database is annotated on a constraint in the schema source.

What remains for review (R-901): whether the partition exhausts the input space, whether an assertion verifies
the meaning of the EARS sentence, whether the EARS sentence itself is right, and whether a schema constraint annotated `@implements BR-nnn` really enforces that rule (C13 sees the annotation, not the semantics).
