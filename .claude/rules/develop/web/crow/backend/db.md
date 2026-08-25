---
paths:
  - "**/crow3_*/**/db_design.txt"
---

# 🗄️ crow / backend — the format and location of the DB design (`db_design.txt`)

> In crow, the **single SSOT for DB design** is a text file in crow's own format, `db_design.txt`.
> crow **generates migrations directly from this file** (the equivalent of `schema.prisma` for Prisma in TypeScript).
> Therefore develop's DB design deliverable (the output of `db-designer`) is written **into `db_design.txt` itself**.
> The procedure rests on develop skill §3 (where docs artifacts live) and §6 (handing over framework rules).
>
> **Write the content in Japanese** (comments and any descriptive text in the file).

## Location (where to write it)

- **`db_design.txt`** (the path the crow project prescribes; the source of migrations).
- **Never write a docs draft** (`docs/db/schema.md` and the like). In crow the native format is the SSOT, and the host declares it as `schema.files: ["…/db_design.txt"]` in `traceconfig.json` so that `trace-check` C13 can read the `@implements BR-nnn` comments on rule-enforcing definitions.

## Format (how to write it)

- Written in crow's own format. **The concrete field notation, types, and how relations are written follow the crow version of the target project** (this leaf defines where to write it and as what SSOT; for the syntax itself, consult that project's crow documentation or its existing `db_design.txt`).
- If a `db_design.txt` already exists, update it **as a diff**, imitating its notation and naming (do not break existing conventions).

## Never split the SSOT (most important)

- **Treat `db_design.txt` as the single SSOT; never transcribe it into a second copy such as `schema.md`.** Duplication quietly breeds inconsistency between the migrations and the design document.
- The soundness of a DB design (normalization, boundaries, relations) cannot be refuted by machine → follow develop's **🙋 human gate** (`db-designer` stops at a draft; the orchestrator settles it on human confirmation). **The file being settled is `db_design.txt`.** If the native format has no draft/fixed status field, settlement is established by the orchestrator's human approval (do not force a status field into the file).
