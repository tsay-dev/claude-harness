---
paths:
  - "**/crow3_*/tests/**"
  - "**/crow3_*/phpunit.xml*"
---

# 🧪 crow — common testing rules (all layers)

> **The principles of testing (what to test and why) rest on develop's development process.**
> Deriving tests from GWT, decorrelating test design and implementation into separate contexts,
> Red→Green→Refactor, and closing with adversarial verification (`/attack` if needed) — these are
> common to all development, so they are not restated here; follow them there.
>
> This document defines **what to observe when writing tests in crow**.
> Layer-specific style lives in [backend/testing.md](../backend/testing.md).
> **No frontend testing leaf is placed for now** (develop does not file FE tests).
> **Never copy the common rules into a layer leaf** (the SSOT is here, in one place).
>
> **Write test names and comments in Japanese.**

---

## What gets tested is the domain (hand-written) only

crow has **(A) the framework proper under `engine/kernel/`** and **(B) generated members injected from `db_design.txt`**.
Both are the framework's responsibility: **trust them, and never make them the SUT of an app-level Red or characterization test.**

| Do file | Do not file |
| --- | --- |
| Domain methods, extension hooks, and `action_*` behavior **hand-written** under `app/` | **The behavior of `engine/kernel/**` itself** (sweeping input key shapes, validation, viewpart resolution, CSRF, and so on) |
| App-specific decisions, derivations, and failure paths that the GWT or the contract demands | Generated members crow injects (constant maps, `_*_str()`, `sql_select_all()`, and so on) |
|  | "Sweeps and characterizations of generated APIs and kernel APIs" whose combinations swell every time an enum or constant gains a value |

Why: transcribing the kernel or the generated surface adds cases every time the framework updates or an enum grows, buying nothing but maintenance cost. What must be refuted is **the meaning you wrote**.

- **Even when the GWT touches an enum value or a datetime input**, what you verify is how the **hand-written logic or gate** that received that input behaves — not the correctness of `get_<field>_map()` or `crow_db_table_model::input_from_request()`
- Even when the app is written around the kernel's constraints, **keep the SUT on the app side**. An "engine characterization test" that pins the kernel's measured behavior is outside develop's Red scope (testing the framework proper is crow's own repository's responsibility)
- Even if the existing suite contains kernel or generated-surface tests, **do not take them as a model and multiply them**
- Enumerating generated members follows "do not redefine generated members" in [backend/model.md](../backend/model.md) §3.6. Layer-specific carving is in [backend/testing.md](../backend/testing.md)

## One test = one behavior

- One test verifies **one behavior**. Do not stuff unrelated assertions into it
- **Never write a conditional or a loop in a test body.** Logic there breeds "bugs in the test".
  When you want to branch, that is either a separate test or a job for the runner's data-driven feature

## Do not stop at the happy path

Implement the development process's "include failure, empty, permission, and boundary in the conditions" as test cases.
A test that covers only the success path guarantees nothing by passing.
**But "coverage" applies only to hand-written domain logic** (see the section above). Do not claim coverage by expanding the kernel's or the generated surface's input shapes and value lists into cases.

## Mock only at the boundary

- Mock only **the "boundaries": the DB, external I/O, the network, time, randomness**
- **Never mock internal logic.** A test full of mocks becomes a transcription of the implementation and loses its refutation power

## Make it deterministic (never create a flake)

- **Never depend implicitly** on real time, randomness, the network, or the filesystem. Inject them where needed and pin them in the test
- Tests **never depend on order**. Do not carry shared state in, and always restore anything you changed

## One command to run

- **A single command must run everything, with the exit code deciding red or green.** CI runs the same command
- A setup that fails this cannot serve develop's Phase4 (the red-green loop driven by the machine oracle)

## Split suites by what execution requires

Rather than picking test-level names (unit / integration / system) first and classifying by them,
split by **what has to be started for that test to run**. This criterion needs no judgment, is decided
mechanically, and coincides with "may this be mixed into the red-green loop?"

| Suite | The criterion (this alone decides it) | How often it runs |
| --- | --- | --- |
| **Default** (unit) | starts no external environment (mocks only at the boundary) | the suite the red-green loop draws from (selection during a round; whole run at a boundary — develop skill §4) |
| **Integration** | **connects to a real DB or a real service** | at a boundary only (before returning, before commit, in CI) |
| **System** | **starts a browser or a real device** | outside the phases (opt-in) |

Locations and run commands are defined by [backend/testing.md](../backend/testing.md).

- **Separate by folder.** Separation by tag or annotation cannot be noticed when a gap in the run command's configuration lets something leak into the default suite.
  With folders separated, it is mechanically guaranteed by **the default suite's command not picking up that path**
- **The default suite must go green on a machine with neither a DB nor a browser available.** If that breaks, Phase4 does not hold
- "One command to run" means **one command per suite**. Never mix integration or system into the default suite's command

### Contract-conformance tests belong to the default suite

The backend's contract-conformance tests (inputs/outputs, pure functions — [backend/testing.md](../backend/testing.md)) start no external environment, so they are **not integration tests**. By the criterion above they fall into the default suite.

**They must never be moved into the integration suite.** develop's Phase4 machine oracle is carried, for now, by the **BE tests** (FE tests are not filed).
The moment they leave the red-green loop, there is no means left of catching an integration defect in Phase4.

### The system suite is "a place that merely exists"

**Browser-driven system tests are not part of develop's phases.** A project that judges them necessary adds them itself, and
this document does not cover how to write them (tool choice, scenario construction). It defines only **the location and "do not mix them into the default suite"**.
An empty folder there is not a gap.

## Scoped execution (the UC tag) and requirement coverage (`@covers`)

Beyond running everything, make **per-feature selective execution** possible with a single command.

- **Stamp every test with its UC ID (`UC-nnn` — the same key as the UC directory name under `docs/goals/`) in a machine-selectable form** (a group attribute or a test-name prefix; the concrete syntax is in the layer leaf)
- **Every test names exactly one declared partition class with `@covers REQ-nnn#class`** in its doc comment (`trace-check` C10 / C11 read it: a class with no test, a test with no class, or an undeclared class is a violation. Declare the class in the REQ's `## 検証方針` first — the placement is in the layer leaf)
- This turns "the tests relevant to this fix" from a judgment into a **mechanical resolution from `UC-nnn`**. **When to run a selection vs the whole default suite is authoritative in develop skill §4 (test-run granularity).** This leaf defines only how to stamp and select by UC ID
- An untagged test falls out of scoped execution, leaving regression detection to the boundary. **Never let a new test go untagged**

## Naming

- Symbols are snake_case per [common/coding.md](./coding.md).
  However, **identifiers the test framework mandates take precedence** (PHPUnit's `setUp()`, and so on)
- A test name must make "**what happens when you do what**" clear from the name alone

## Coverage is a signal, not a target

The coverage percentage is a hint about what you are not looking at — **never a target to hit**.
Per the development process, **green tests are a precondition, not the definition of done**. After green, adversarial verification (`slice-reviewer`, and `/attack` if needed) exposes the defects.
