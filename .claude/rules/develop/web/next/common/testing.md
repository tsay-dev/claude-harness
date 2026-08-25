---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "**/__tests__/**"
  - "**/vitest.config.*"
  - "**/jest.config.*"
  - "**/playwright.config.*"
---

# 🧪 Next.js — common testing rules (all layers)

> **Scope: TypeScript projects on Next.js (App Router).** If it is not Next.js, treat this document as inapplicable and discard it.
>
> **The principles of testing (what to test and why) rest on develop's development process.**
> One test = one behavior; include failure, empty, permission, and boundary in the conditions; mock only at the boundary;
> make it deterministic; coverage is a signal, not a target — these are common to all development, so they are not restated here; follow them there.
>
> This document holds only **the wiring that makes those principles hold in Next.js**.
> Layer-specific style is in [backend/testing.md](../backend/testing.md).
> **No frontend testing leaf is placed for now** (develop does not file FE tests).
> Notation is [common/coding.md](./coding.md).
>
> **Write test names and comments in Japanese.**

---

## 1. The runner is declared by the project

**The harness never pins a specific test runner or UI testing library.**
The choice, the configuration, and **the command that runs the default suite** are recorded in the host's `CLAUDE.md`.

- **A single command must run the whole default suite, with the exit code deciding red or green**
- **If none is installed, installing it is the gate to starting.** Pushing implementation forward with no runner means
  develop's Phase4 (the red-green loop driven by the machine oracle) does not hold

---

## 2. Scoped execution (the UC tag) and requirement coverage (`@covers`)

In every test, make the outermost group (`describe` in most runners) read

`UC-012 <UC title>`

so it can be selected mechanically by the UC ID (the same key as the UC directory name under `docs/goals/`).

- **Every test names exactly one declared partition class**: put `// @covers REQ-045#accept-standard` as the first line inside the `it` / `test` body (`trace-check` C10 / C11 read it; declare the class in the REQ's `## 検証方針` first)
- Write the concrete selection command, matched to the runner, in `CLAUDE.md` (e.g. a name filter for `UC-012`)
- **When to run a selection vs the whole default suite is authoritative in develop skill §4 (test-run granularity).** This leaf defines only how to stamp and select by UC ID
- **Never let a new test go untagged** (untagged, it falls out of scoped execution and regression detection is left to the boundary)

---

## 3. Make it deterministic (what wobbles in Next)

Never depend implicitly on real time, randomness, the network, or a real DB. Inject them where needed and pin them in the test.

| Source of wobble | How to handle it |
| --- | --- |
| The real network / a real DB | never used in the default suite. Mock or fake the boundary |
| `Date.now` / timers | pin them, or advance them with fake timers |
| Real-time `sleep` | **never use it.** It flakes under CI load |
| `next/cache`, `cookies`, `headers`, and so on | mock them if a mutation-controller (Actions / RH) test touches them. The premise is that they never enter a use case ([backend/coding.md](../backend/coding.md)) |

Tests **never depend on order.** If you modified a shared mutable global, always restore it.

---

## 4. Split suites by what execution requires

Rather than picking test-level names (unit / integration / system) first and classifying by them,
split by **what has to be started for that test to run**.

| Suite | The criterion (this alone decides it) | Location (the default example) | How often it runs |
| --- | --- | --- | --- |
| **Default** | starts no external environment (mocks only at the boundary) | mirroring the target structure, `__tests__/`, and so on | the suite the red-green loop draws from (selection during a round; whole run at a boundary — develop skill §4) |
| **Integration** | **connects to a real DB or a real service** | `tests/integration/` | at a boundary only (before returning, before commit, in CI) |
| **System** | **starts a browser** | `e2e/` | outside the phases (opt-in) |

- **Separate by folder.** Separation by tag alone cannot be noticed when a gap in configuration lets something leak into the default suite
- **Exclude the integration and system locations from the default suite's discovery** (ignore them in the runner config). Forget it and a browser or a real DB slips into the red-green loop
- **The default suite must go green on a machine with neither a DB nor a browser available**
- A project that renames the locations **declares it in `CLAUDE.md`**. The criterion and "never mix into the default" do not change
- **The system suite is not part of develop's phases.** How to write it is outside this document's scope. All it defines is the location and the ban on mixing

### Contract-conformance tests belong to the default suite

The backend's contract-conformance tests (inputs/outputs, pure functions — [backend/testing.md](../backend/testing.md))
start no external environment, so they are **not integration tests**.

**They must never be moved into the integration suite.** develop's Phase4 machine oracle is carried, for now, by the **BE tests** (FE tests are not filed).

---

## 5. Coverage is a signal, not a target

The coverage percentage is a hint about what you are not looking at — **never a target to hit**.
**Green tests are a precondition, not the definition of done.** After green, adversarial verification (`slice-reviewer`, and `/attack` if needed) exposes the defects.

---

## ✅ Checklist before returning

- [ ] Is the command that runs the default suite in `CLAUDE.md`, with red/green readable from the exit code?
- [ ] Does the outermost group carry `UC-nnn`, and every test a `@covers REQ-nnn#class`?
- [ ] Have real-time sleeps, a real DB, or a browser launch mixed into the default suite?
- [ ] Are integration and system in separate folders, excluded from the default discovery?
