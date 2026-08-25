# CLAUDE.md — the development guide for claude-harness itself

This repository is **the shared prompt for on-demand routing (Prompt as Code)**.
What you touch here is not an application's business code but **the wiring (`.claude/`) that lets an AI load rules only at the moment it needs them**.

The full text of the philosophy, the directory map, and the setup procedure is in [`README.md`](./README.md). This file carries **only the working guidance for modifying and extending the harness**.

> **Language policy.** Everything under `.claude/` (skills, agents, rules, tool READMEs, and the guidance comments inside templates) is written **in English**, for token density. That is a property of the prompt, not of the work: **conversation with the user is in Japanese**, and **so are the deliverables** — the docs under `docs/` (vision, UC, REQ, BR …), ADRs, commit messages, and in-code comments. The templates in `.claude/templates/develop/` therefore keep Japanese headings and frontmatter keys, and `README.md` stays in Japanese. When you add or edit anything here, follow that split.

---

## 0. What you must never do in this repository

- **Never break zero-residency.** Never revive an `index.md` or a catalog table of contents — and never commit a docs index or ledger either (`trace-check --index` generates it on demand). Never add automatic injection to `settings.json` (currently `{}`).
- **Never write project-specific deviations here.** The shared harness holds only what is generic. Facts about a particular engagement go in the host project's `CLAUDE.md`.
- **Never duplicate the same knowledge.** A format has exactly one SSOT (a rules leaf, a template under `templates/`, or the agent body being generated). Never copy craft or format into a skill. The format of a docs artifact is authoritative in the template, and spec-lint derives its required items from the template (never restate the format on the lint side).
- **Never hand-edit `.cursor/`.** The Cursor projection is generated output. To fix something, fix `.claude/` and regenerate with `./init.sh cursor` (or `.claude/tools/cursor-sync/sync.sh`).

---

## 1. Governing rules (always check before modifying)

> **The `.md` at a level = the rules at that level of abstraction / a subfolder = a further specialization. Deeper means more specific.**
> **The tree's axis is the kind, not the project.**

| Principle | What it means |
| --- | --- |
| Zero residency | Zero rules ride on the baseline. Discovery happens only through the `paths` gate and a skill invocation |
| Three aligned trees | A procedure key `<key>` has the same name under `skills/<key>`, `agents/<key>`, and `rules/<key>` |
| Building ≠ judging | The producer and the oracle / reviewer / attacker / judge are different agents in different contexts |
| A skill is how it is driven | Only the orchestrator's decision core and script. Types live in rules and templates; craft lives in the agent body |
| References run one way, rules → skill | **A leaf may reference a skill** ("the procedure is authoritative in skill §X"). **A skill does not know a leaf's body** — all it may see is the metadata delivery requires (the directory position, the file name, `paths:`), and never a summary, an excerpt, or a section number from the body. Knowing a rule's content is the job of **the agent that receives the leaf**, not of the one delivering it |

**The orchestrator-variant exception:** a thin, separate entrance that is only a script (`skills/develop-light`, `skills/attack`) may share agents and rules with the parent key (`develop`) rather than growing a full set of three trees. This avoids duplicating craft and rules.

---

## 2. What goes where (a quick reference for when you are unsure)

| What you want to place | Where it goes | When it loads |
| --- | --- | --- |
| A rule, a format, a type (one concern per leaf) | `rules/<key>/.../<leaf>.md` | when a file matching the leaf's `paths:` is touched |
| A procedure's entrance, the orchestrator script | `skills/<name>/SKILL.md` | on `/name`, or auto-invocation via `description` |
| A specialist subagent's persona and craft (the judgment rules for how to write) | `agents/<key>/<name>.md` | only when the orchestrator launches it as a Task |
| The scaffold for a docs artifact (the format's SSOT; spec-lint derives required items from it) | `templates/<key>/<name>.(md\|yaml)` | when a producer Reads it as a scaffold |
| An executable asset (lint, projection scripts) | `tools/<name>/` | when a producer / init invokes it directly |
| Installation, updating, the Cursor projection | `init.sh` at the root | when a human runs it explicitly |

**The skill hierarchy constraint:** Claude Code only explores the single level `skills/<name>/SKILL.md`. Never nest them.

---

## 3. Extension checklist

### 3.1 Adding a leaf (rules)

1. Decide the level: `rules/<scene>/<platform>/<framework>/<concern>.md` (e.g. `develop/web/crow/common/coding.md`). If a framework splits into layers (`common` / `frontend` / `backend`), you may interpose that one level (deeper is more specific). **A layer-side leaf holds only its delta on the common side and never transcribes the common rules.**
   In a scene with platform/framework levels (`develop`, and so on), **only a concern that binds every platform and every framework equally may go directly under the scene (`rules/<scene>/<concern>.md`)** (the in-code comment rules `comments.md` and the SDD docs conventions `docs.md`, for example). A scene with no platform level (`translate-manga-ko-ja`, and so on) has its leaves directly there. A leaf at this position is enumerated unconditionally by develop skill §6-A, regardless of framework detection, so **a gap in `paths:` coverage means that leaf alone stops being delivered** — update the coverage when you add a framework. Nothing else goes directly under the scene.

**A file name is nothing but a signpost for humans. What decides the destination is `paths:`.**
How things are split and what they are named is the rules side's freedom, and the develop skill does not know what a file name means (§1, one-way references).
By convention `coding.md` (the notation for production code) / `testing.md` (how to write tests) / `db.md` (DB design) are used, but
**those names have no delivery effect.**
2. **The `paths:` frontmatter is the delivery contract.** Only a producer that **writes** a file matching a glob listed there receives that leaf (develop skill §6-B). Therefore:
   - **Enumerate in `paths:`, exactly and completely, the addresses the intended recipient "writes".**
     For testing rules, the glob of **test files**; for DB design, the glob of the **DB design SSOT**; for the notation of production code, **that code's addresses**.
   - **Narrow it down to the addresses where the leaf actually binds.** A wide glob covering a whole framework (`**/<fw>_*/**`) may be written only for **a leaf that binds every address** (the common style, a layer's core).
     Leaving an address-specific leaf on a wide glob means every leaf loads the moment an unrelated file is touched, and the point of splitting is gone.
   - **Conversely, over-narrowing means it is never delivered.** "Testing rules whose `paths:` covers only production code" never reach test-designer.
     `paths:` is both Claude Code's automatic load trigger and **a declaration of who receives it**.
3. **One leaf = one concern** (coding / testing / db …). An overview holds nothing but entrance links.
4. When a layer's leaves have split into several, **make that layer's `coding.md` "the core + an index from address to leaf"**
   (holding only the boundaries and invariants, with address-specific matters in each leaf). **The index belongs to the leaves** —
   the skill does not read a leaf's body (§1, one-way references), so write it so that narrowing delivery is decided by each leaf's `paths:` alone.
5. **A delegation of implementation to another layer is declared by including that address in the delegate leaf's `paths:`.**
   Writing "for X, see the other layer's `coding.md`" in the body has no delivery effect (the skill does not read the body).
6. No addition to a table of contents is needed (there is none).

```yaml
#	a leaf that binds every address (the common style, a layer's core)
---
paths:
  - "**/crow3_*/**"
---

#	an address-specific leaf (e.g. the Domain side only, or SQL only)
---
paths:
  - "**/crow3_*/app/classes/**"
---
```

### 3.2 Adding a procedure (skill + agents + rules)

1. Decide the key name `<key>` and **grow three trees under the same name**.
2. `skills/<key>/SKILL.md` … only the orchestrator's invariants, flow, and delegation targets.
3. `agents/<key>/*.md` … producer and oracle separated. The format reference is embedded in the agent body being generated.
4. `rules/<key>/**` … the types, lazily loaded through the paths gate.
5. Point at agent paths relatively from the skill body (never write an absolute path or presume another project).

**When adding only an orchestrator variant** (`develop-light`, for example): do not create new agents / rules trees. Add only a thin `skills/<variant>/SKILL.md` that references the parent key's agents from its Tasks. Put a cross-reference in the parent skill, and never let it become an escape hatch from a gate.

### 3.3 The agent frontmatter type

```yaml
---
name: <unique-name>          # also the identifier in the Cursor projection
description: <one sentence that makes the launch condition clear>
tools: Read, Write, ...      # the minimum needed. Lean read-only for oracles
model: opus | inherit        # the default hint for Claude Code. Follow the assignment rule below.
                             # Normalized to inherit in the Cursor projection, where the choice at launch is authoritative
---
```

- Producer: input contract → craft → output contract. Never self-approves (never marks something `fixed`).
- Oracle / attacker / judge / reviewer: their mission is **exposing inconsistencies and defects**. Never settle for confirming agreement. As a rule, they fix nothing.

**The `model:` assignment rule (cut by whether a machine oracle exists)**

| Zone | Who | Claude Code `model:` | Cursor (at Task launch) | Why |
| --- | --- | --- | --- | --- |
| The judgment zone (machines cannot refute it) | domain-definer / usecase-definer / requirement-definer / db-designer / contract-author / test-designer / adr-writer / slice-reviewer, and every oracle, attacker, and judge | `opus` | the orchestrator picks a top-tier model to match the task | Everything downstream rests on these artifacts. Degradation here produces "correctly wrong" implementations |
| The deterministic zone (a machine oracle exists) | the 3 implementation producers / skeleton-runner / committer | `inherit` | lighter, or `inherit`, is fine | Tests and builds decide pass/fail, so the model makes little difference to final quality |

> **Never hardcode a specific model slug (`sonnet`, or a Cursor-specific name) into the harness.** The shared harness would then constrain the host's budget and model catalog (§0). In Cursor the projection becomes `inherit`, so **the orchestrator picks per Task launch, by zone and by the task's nature** (the script is authoritative in develop skill §5). In Claude Code, the agent frontmatter's `opus` / `inherit` acts as the default.

---

## 4. The working flow for a modification (development in this repo)

1. **Identify the SSOT for what you are changing** (a rules leaf / a skill / an agent body / tools / `init.sh` / `README.md`).
2. **Check no duplication arises** (is the same format scattered across a skill, an agent, and rules?).
3. After the change, visually confirm the related README sections, comments, and reference paths from other agents are not broken.
4. If you touched the Cursor integration, or changed rules / skills / agents, regenerate the projection for the host or for verification:
   ```bash
   ./init.sh cursor .
   # or
   .claude/tools/cursor-sync/sync.sh .claude .cursor
   ```
5. **When the change rests on a judgment that will be questioned later, record an ADR** in `docs/adr/ADR-nnnn-<slug>.md` (the format is authoritative in `templates/develop/ADR.md`; `adr-writer` lands it; `spec-lint validate` checks it even in this repository). This applies to the harness's own decisions, not only a host project's — a format replaced, an option deliberately rejected, a dependency deliberately refused. CLAUDE.md holds "how we do it now"; the ADR holds "why, and what we turned down".
6. For a change that does not break submodule users, cut a **`v*` release tag** where appropriate (`init.sh update` follows tags). **A breaking change** (one that makes an existing host's `spec-lint validate` fail until it migrates) says so in the tag annotation, along with the migration command.

---

## 5. Where to aim verification

| What changed | The minimum check |
| --- | --- |
| A rules leaf | Is `paths:` present? Is the glob valid? Is it one concern? |
| A skill | Does the description work as a launch trigger? Does it instruct the orchestrator not to write code itself? Does every status transition (`active` / `fixed` / `phase:`) stay with the orchestrator? |
| An agent | Is producer ≠ oracle separated? Are the input and output contracts explicit? Does `model:` follow the §3.3 assignment rule (no hardcoded `sonnet`)? |
| cursor-sync | `paths`→`globs`, `alwaysApply: false`, `model: inherit`, the GENERATED marker |
| templates | One artifact, one template? Are the placeholders unified as `UC-000`-style IDs / `YYYY-MM-DD` / `<...>`? Is an optional frontmatter key marked `# optional`? Is spec-lint's derivation (required keys, required sections, required `x-` keys) unbroken? |
| spec-lint | Does it follow `.claude/tools/spec-lint/README.md`'s usage, and can a producer invoke it directly? Required keys and sections are derived from the templates and never restated on the lint side. **The closed vocabularies are the deliberate exception**: `status` / `phase` / `pattern` / `transport` / `direction` live in the lint, because only executable code can enforce them — a template's comment documents them and is not a second authority. Format and lifecycle only — traceability is trace-check's. Does the baseline ratchet keep trace-check's semantics (only new errors fail; `--update-baseline` records the whole present state; `gate` never consults it)? Does `convert` preserve the shape and leave every judgment as a `# convert:` note instead of deciding? |
| trace-check | Does it stay traceability-only (C1–C13: coverage, `@covers` / `@implements` resolution, placement ↔ frontmatter, dead rules, numbering) and never re-check format? Does `--only` let a producer self-check its own concern? Does the baseline ratchet stay monotone (`--update-baseline` only shrinks)? Is `--next` the only numbering path agents use? |
| gate-hook | Never made permanent (installation is the host's `settings.local.json`, optional). Does it leave docs, `.claude`, and `traceconfig.json` unblocked? Does it read the gate state from `UC.md`'s `phase:` (no ledger file)? Does the block reason point at develop skill §2's return point? |
| init.sh | Do the help for install / update / cursor and the README agree? |

Application-level business tests are not this repository's primary target. **Consistency of the wiring, zero residency, and the alignment of the three trees** are the axes of quality.

---

## 6. Reading order (when unsure)

1. This file (the working guidance)
2. [`README.md`](./README.md) (the philosophy, the map, the setup)
3. Open only what you are touching:
   - Changing a procedure → the relevant `skills/<key>/SKILL.md`
   - Changing craft or a format → the relevant `agents/<key>/*.md`
   - Changing a framework's rules → the relevant `rules/.../*.md`
   - Changing the projection → `.claude/tools/cursor-sync/sync.sh`
   - Changing installation → `init.sh`
