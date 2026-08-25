---
paths:
  - "**/*.swift"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.mjs"
  - "**/*.cjs"
  - "**/*.php"
  - "**/*.py"
  - "**/*.rb"
  - "**/*.go"
  - "**/*.rs"
  - "**/*.kt"
  - "**/*.java"
  - "**/*.cs"
  - "**/*.sql"
  - "**/*.css"
  - "**/*.scss"
  - "**/*.html"
---

# 💬 In-code comments describe only the current spec

> **Scope: production code and test code, on every platform and every framework.**
> Framework-specific notation (the form of doc comments, and so on) is overridden by each
> framework's `coding.md`. What this document defines is only **what to write and what not to write**.
> **When you add a new framework to the harness, add that language's extensions to the `paths:` above**
> (this leaf binds every platform, so a gap in the coverage means this document alone stops being delivered).

---

## 0. Language

**Write comments in Japanese.** These rules are written in English for token density, but that is a
property of the instructions, not of the code. Identifiers, API names, and framework keywords stay as
they are; only prose is Japanese.

---

## 1. The principle

**A comment exists so that whoever reads this code now understands the current spec.**
The history of a change, a work log, a past state — **none of it stays in the code.**

Why: the history is already in git (the commit message) and in ADRs. Copying it into the code creates
a second copy that the next change does not update, and **stale history gets read as the current spec.**

---

## 2. What not to write (delete it when you find it)

- Diffs against the past: "it used to be X but was changed to Y", "in the old implementation…", "fixed for Z"
- Work logs, dates, assignees, or notes that are only a ticket number (`// 2026-08-14 修正`)
- Commented-out old code (**it is in git, so delete it. Never "keep it just in case"**)
- Explanations of the intent behind a change ("why this modification was made") — that belongs to the commit message / ADR
- Restatements of what the code already says (`// ユーザーを取得する` directly above `getUser()`)

## 3. What may be written

- **Reasons and constraints** that reading cannot reveal (quirks of an external spec, a deliberately inefficient choice, a bug being worked around)
- Fragile premises and invariants ("the caller has already taken the lock", and the like)
- Doc comments required by the framework's or language's conventions (follow each `coding.md`)

All of it **in the present tense, as the current spec**. Not "changed to X" but "is X".

---

## 4. Traceability annotations (an ID, never content)

The one comment that always goes in. `trace-check` (`.claude/tools/trace-check/`) reads it to derive the map between docs and code, so it is machine-read, not prose.

- **Production code** that realizes a requirement, a rule, or a use case carries `@implements REQ-nnn` / `@implements BR-nnn` / `@implements UC-nnn` in the doc comment of the unit that realizes it (a use-case class, a rule function, the branch that enforces a check). Several IDs may share one line. **Write the ID only — never restate the requirement** (R-701; an ID that does not exist fails C5).
- **Test code** carries `@covers REQ-nnn#class` — exactly one declared partition class per test (the placement per runner is in each framework's testing leaf; C10 / C11 check it).
- These annotations are the current spec's address, not history: when a requirement is withdrawn or moved, update or remove the annotation in the same change.

---

## 5. Where history belongs

| What you want to write | Destination |
| --- | --- |
| What was changed and why | git commit message |
| The reasoning and trade-offs behind a design decision | `docs/adr/` |
| The current behavior and rules | `docs/goals/**/UC-nnn-<slug>/` (UC.md, REQ-nnn.md) and `docs/rules/BR-nnn.md` |
| Why the code as it is now is the way it is | an in-code comment (this document) |

---

## 6. Existing history comments

**Delete them within the range of the files you touched.** Do not file a bulk cleanup as separate work.

- If a history comment doubles as an explanation of the current spec, **rewrite it in the present tense first**, then drop the history part
- For a comment whose continued correctness you cannot confirm, judge with the code as authoritative (never change an implementation on the grounds of a comment)
- Treat the cleanup as **part of the same commit as that change**, not as a separate logical change. If you cleaned something up, leave one line about it in your report

---

## ✅ Checklist before returning

- [ ] Nothing of the "it used to be", "changed", "fixed for" kind is left
- [ ] No commented-out code is left
- [ ] No notes that are only a date, an assignee, or a ticket number
- [ ] No comment you kept is merely a restatement of what the code says
- [ ] The history was routed to the commit message / ADR
- [ ] Every unit that realizes a REQ / BR / UC carries its `@implements`, and every test its `@covers REQ-nnn#class`
