# templates/develop — templates for docs artifacts (the SSOT for format)

Each template is **the single format definition shared by the producer (who writes) and spec-lint
(who verifies)**. spec-lint derives `spec.md`'s required sections and required frontmatter from the
templates in this directory, so revising the format means editing the template and the lint follows
(no duplication).

| Template | Generated into (the host project) | Author |
| --- | --- | --- |
| `PRD.md` | `docs/PRD.md` | human (orchestrator may ghostwrite) |
| `design.md` | `docs/design.md` | human (orchestrator may ghostwrite) |
| `specs.md` | `docs/specs/specs.md` (the ledger) | ssot-definer; the phase column by the orchestrator |
| `spec.md` | `docs/specs/F-xxx-<slug>/spec.md` (behavior) | ssot-definer |
| `contract.yaml` | `docs/specs/F-xxx-<slug>/contract.yaml` (the shape of the boundary — HTTP and non-HTTP alike) | contract-author |
| `components.yaml` | `docs/specs/_shared/components.yaml` | orchestrator only (producers report requests to add) |

`spec.md` and `contract.yaml` are a feature directory's MIS (two files forming one feature's SSOT).
The shape of the columns and keys comes from these templates; the judgment of what not to write comes
from each producer's craft.

- Placeholders (`F-000`, `YYYY-MM-DD`, `<...>`) must always be replaced with real values before something is marked `fixed` (spec-lint verifies this).
- The judgment rules for how to write (the negative lists, the craft) are not written into templates. Each producer's agent body holds them.
- **The generated artifacts are written in Japanese.** The templates carry Japanese headings and frontmatter keys for exactly that reason; the English text inside them is guidance for the producer and is not part of the artifact.
