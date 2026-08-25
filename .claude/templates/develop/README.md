# templates/develop — templates for docs artifacts (the SSOT for format)

Each template is **the single format definition shared by the producer (who writes) and the lints
(who verify)**. spec-lint derives required frontmatter keys and required sections from the templates
in this directory, so revising a format means editing the template and the lint follows (no duplication).
The principles behind the layout (single parent, ID grammar, EARS, partition classes …) are the
rules leaf `.claude/rules/develop/docs.md`, delivered by its `paths:` to whoever writes under `docs/`.

| Template | Generated into (the host project) | Author |
| --- | --- | --- |
| `00-vision.md` | `docs/00-vision.md` | domain-definer (🙋 human gate → `frozen`) |
| `01-glossary.md` | `docs/01-glossary.md` | domain-definer (🙋 → `living`) |
| `02-actors.md` | `docs/02-actors.md` | domain-definer (🙋 → `living`) |
| `goals-backlog.md` | `docs/goals-backlog.md` | domain-definer |
| `GOAL.md` | `docs/goals/GOAL-nn-<slug>/GOAL.md` | domain-definer (🙋 → `active`) |
| `UC.md` | `docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/UC.md` | usecase-definer (🙋 → `active`); the `phase:` line by the orchestrator |
| `REQ.md` | `…/UC-nnn-<slug>/REQ-nnn.md` | requirement-definer (🙋 → `active`); `## 検証方針` by test-designer |
| `BR.md` | `docs/rules/BR-nnn.md` | requirement-definer (🙋 → `active`) |
| `NFR.md` | `docs/nfr/NFR-nnn.md` | domain-definer (🙋 → `active`) |
| `contract.yaml` | `…/UC-nnn-<slug>/contract.yaml` (the shape of the boundary — HTTP and non-HTTP alike) | contract-author (🤖 → `fixed` by the orchestrator) |
| `components.yaml` | `docs/_shared/components.yaml` | orchestrator only (producers report requests to add) |
| `ADR.md` | `docs/adr/ADR-nnnn-<slug>.md` | adr-writer |
| `verification-GLOBAL.md` | `docs/verification/GLOBAL.md` | test-designer |
| `design.md` | `docs/design.md` (optional) | human (orchestrator may ghostwrite) |
| `traceconfig.json` | `traceconfig.json` at the host root | orchestrator seeds it once; the host maintains it |

A UC directory (`UC.md` + `REQ-*.md` + `contract.yaml`) is one vertical slice's SSOT, and `ls` on it
defines the slice's scope. The shape of the columns and keys comes from these templates; the judgment of
what not to write comes from each producer's craft.

- Status vocabularies: docs nodes go `draft → active → withdrawn` (`active` means a human approved it;
  the singletons use `frozen` / `living` instead of `active`); the contract goes `draft → fixed`
  (`fixed` means the structure oracle found no inconsistency). A producer never advances a status itself.
- Placeholders (`GOAL-00` / `UC-000` / `REQ-000` / `BR-000` / `NFR-000` / `ADR-0000` / `ACT-00` /
  `KPI-00` / `YYYY-MM-DD` / `<...>`) must be replaced before something leaves `draft` (spec-lint verifies this).
- A frontmatter line whose comment says `optional` is optional; every other key in a template is required.
- The judgment rules for how to write (the negative lists, the craft) are not written into templates. Each producer's agent body holds them.
- **The generated artifacts are written in Japanese.** The templates carry Japanese headings and frontmatter values for exactly that reason; the English text inside them is guidance for the producer and is not part of the artifact.
