---
name: docs-migrate
description: Mechanically inspect whether a project's docs fully conform to the harness's current docs layout and format (docs/specs/F-xxx-<slug>/, boundary contracts, template conformance), and migrate or fix anything on an old layout or in violation. Triggers on /docs-migrate or on phrases such as "docs を移行して" "docs が harness に準拠しているかチェックして" "docs レイアウトを最新化して" (migrate the docs / check the docs conform to the harness / bring the docs layout up to date).
---

# 🔧 docs-migrate — conformance inspection and migration of docs

> **This skill does not own the definition of conformance.** Authority always rests with "the current harness's spec-lint + the templates in `.claude/templates/develop/`". This skill holds only the procedure for running those two as machine oracles. When the harness is revised, the lint and templates become the new authority and this skill follows without being rewritten.

## Invariants

- **Change the shape, not the content.** Migration converts format and location; it never changes the meaning of a spec (GWT, inputs/outputs, the shape of a contract). If you find yourself wanting to change meaning, stop the migration and route it to `/develop` (the proper flow through ssot-definer / contract-author).
- **Let machines judge.** Conformance is judged in full by spec-lint (it parses contracts structurally; no external validator is involved). Never make your own visual inspection the grounds for a pass.
- **Preserve draft / fixed.** Migration neither promotes nor demotes status (what was fixed moves over still fixed).
- **Never silently drop information that would be lost.** Information with no home in the new format is routed to the destinations in develop skill §4 "Routing information" (ADR, issues, commit message) and stated explicitly in both the plan and the report.
- **Preserve history with git mv.** Do not copy and delete.
- **Language**: these instructions are in English, the output is not. **Report to the human in Japanese**, and keep migrated docs in Japanese (migration converts format and location, never language). State this in every Task input.

## Flow

### 1. Diagnose (read-only)

1. Run `node .claude/tools/spec-lint/spec-lint.mjs validate`.
   Contracts still in OpenAPI form (`api-contract.yaml`, or a top-level `openapi:`) are reported as errors — that is the signal to run the mechanical conversion in step 3.
2. Classify the result:
   - **Conformant** (exit 0, warnings only) → report the warning list plus "these get handled in the next develop differential update" and **stop** (an invocation that is only a check ends here).
   - **Old layout detected** → go to 2 (migrate).
   - **Current layout but with violations** → go to 2 (fix; use only the relevant lines of the migration recipe).
3. Alongside that, **take inventory of every file** under docs and list anything outside the lint's jurisdiction (design notes, images, and so on) as "out of scope for migration — left as is".

### 2. Plan (🙋 human gate)

Present the migration mapping table and **always get approval before executing** (AskUserQuestion / plan mode):

| Item | What to present |
| --- | --- |
| Mapping | old path → new path (per feature, including proposed slug names) |
| Conversion | what is relocated mechanically vs. what is content-converted (OpenAPI contract → boundary contract via `spec-lint convert`, etc.) |
| Homeless information | descriptions with no home in the new format, and where each is routed |
| Out of scope | files that will not be touched |

### 3. Execute

**Mechanical relocation (done directly by the main agent; the oracle is a machine, so producer separation is unnecessary):**

- Creating directories, `git mv`, rewriting the ledger, re-pointing links, aligning frontmatter keys.
- Where a scaffold is needed, use the templates (`.claude/templates/develop/`) as authority.
- If `_shared/components.yaml` is needed, seed it first by mechanically extracting shared vocabulary (error codes and so on) from the old contracts (stand up the `$ref` targets before the conversion Tasks run).

**Content conversion (delegated to the owner of the format via Task):**

- **Converting OpenAPI contracts (`api-contract.yaml` → `contract.yaml`) is done by machine, not by an agent**: run `node .claude/tools/spec-lint/spec-lint.mjs convert` to see the plan, then `--write` to apply it. It also rewrites `_shared/components.yaml` (`securitySchemes` → `authSchemes`, the `ErrorCode` enum → `errorCodes`). It prints everything it could not carry over — `owned` lands as `true` on every operation, `description` prose is dropped, `errorCodes` values stay as placeholders. **Work through that list yourself** (third-party boundaries become `owned: false` with a `source`, dropped prose is routed per develop skill §4), then `git rm` the old files and re-run validate.
- Converting a contract from some other old shape (a hand-written md, say) is delegated per feature to **`contract-author`** (`.claude/agents/develop/contract-author.md`). Pass "the old contract, the corresponding spec, the shared-vocabulary paths" as input, and state explicitly that this is **a conversion that preserves the shape of the old contract**. May run concurrently (never let them write to `_shared`; receive requests as reports and apply them from the main agent).
- Restructuring a spec body that has drifted from the current template is delegated the same way to **`ssot-definer`** (content-preserving, following the differential-update protocol).

### 4. Verify

1. Iterate step 3 until `spec-lint validate` returns **exit 0** (if the same violation survives 3 rounds, escalate to 🙋).
2. Grep for any remaining references to old paths in the repo (the project's CLAUDE.md, README, CI config, hooks). Re-point what remains, or put it in the report if it is out of scope.
3. Warnings are not in scope to fix (cleaning up content is outside migration). Report them as a list and leave them to the next develop differential update.

### 5. Record

- Delegate the commit to **`committer`** (`.claude/agents/develop/committer.md`) (intent: docs layout migration, with a summary of the mapping).
- If the migration routed information elsewhere (bound for an ADR or an issue), leave each in the report as a delegation to `adr-writer` or a handoff to the human.

## What this skill does not do

- **Improve or clean up specs** (relieving spec bloat, rewriting GWT) — report them as warnings only. They get done in a `/develop` differential update.
- **Fix the harness itself** — if you find a flaw in the lint or the templates, report it to the human rather than fixing it (never move the conformance target during a migration).
- **Fabricate PRD.md / design.md** — if absent, simply report them as "optional, not written". Writing them is for the human (or on the human's instruction).
