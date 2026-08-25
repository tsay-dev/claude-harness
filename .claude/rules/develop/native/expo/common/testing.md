---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/*.spec.tsx"
  - "**/__tests__/**"
  - "**/jest.config.*"
---

# 🧪 Expo — common testing rules (all layers)

> **Scope: React Native apps on Expo (expo-router).** If it is not Expo, treat this document as inapplicable and discard it.
>
> **The principles of testing (what to test and why) rest on develop's development process.**
> One test = one behavior; include failure, empty, permission, and boundary in the conditions; mock only at the boundary;
> make it deterministic; coverage is a signal, not a target — these are common to all development, so they are not restated here; follow them there.
>
> This document holds only **the wiring that makes those principles hold in Expo**.
> **No frontend testing leaf is placed for now** (develop does not file FE tests). Notation is [common/coding.md](./coding.md).
>
> **Write test names and comments in Japanese.**

---

## 1. The runner and the preset

**Use Jest, with the `jest-expo` preset.**

Never build a bare `react-native` preset or your own ts-jest configuration. The preset already aligns where Expo modules resolve
and the transpilation exclusions (`transformIgnorePatterns`), and rolling your own reproduces the failure
**"a syntax error the moment you import the module"**.
That is a defect in the configuration, not in what you are testing, so do not burn time there.

---

## 2. One command to run

- **A single command must run everything, with the exit code deciding red or green**
- **If none is installed, installing it is the gate to starting.** Pushing implementation forward with no runner means
  develop's Phase4 (the red-green loop driven by the machine oracle) does not hold
- The choice, the configuration, and the run command are **recorded in the project's `CLAUDE.md`** (the harness does not pin them)
- **Scoped execution (the UC tag)**: in every test, make the outermost `describe` read
  `describe('UC-012 <UC title>', ...)`, so it can be selected mechanically by the UC ID
  (the same key as the UC directory name under `docs/goals/`). Run the selection with `jest -t "UC-012"`.
  **When to run a selection vs the whole default suite is authoritative in develop skill §4 (test-run granularity).** This leaf defines only how to stamp and select by UC ID
- **Requirement coverage**: every test names exactly one declared partition class with `// @covers REQ-045#class` as the first line of its body (`trace-check` C10 / C11 read it; declare the class in the REQ's `## 検証方針` first)

---

## 3. What "deterministic" means in React Native

The sources of non-determinism are not only real time, randomness, and the network. RN has its own wobbles.

| Source of wobble | How to handle it |
| --- | --- |
| Animations and transitions | never wait for completion. Never make an animation the thing under verification |
| `InteractionManager`'s deferred execution | advance it with fake timers |
| Layout measurement (`onLayout`) | returns 0 in the test environment. Never verify a branch that depends on dimensions |
| Async responses across the native bridge | mock them and resolve immediately |

**Never wait with a real-time `sleep`.** Express waiting through async queries and fake timers.
Real-time waiting is not just slow — it always produces a flake that fails depending on CI load.

---

## 4. Split suites by what execution requires

Rather than picking test-level names (unit / integration / system) first and classifying by them,
split by **what has to be started for that test to run**. This criterion needs no judgment, is decided
mechanically, and coincides with "may this be mixed into §2's red-green loop?"

| Suite | The criterion (this alone decides it) | Location (the default) | How often it runs |
| --- | --- | --- | --- |
| **Default** (unit) | starts no external environment (mocks only at the boundary) | as-is (mirroring the target structure, `__tests__/`) | the suite the red-green loop draws from (selection during a round; whole run at a boundary — develop skill §4) |
| **Integration** | **connects to a real API or a real service** | `tests/integration/` | at a boundary only (before returning, before commit, in CI) |
| **System** | **starts a simulator, a real device, or a browser** | `e2e/` (following the Maestro / Detox convention is fine) | outside the phases (opt-in) |

- **Separate by folder.** Separation by tag cannot be noticed when a gap in the run command's configuration lets something leak into the default suite
- **Exclude the integration and system locations from Jest's discovery.** Put `tests/integration` and `e2e` in `testPathIgnorePatterns`.
  Forget it and the mere names `*.test.ts` / `__tests__` get them picked up by the default suite, and a simulator launch slips into the red-green loop
- **The default suite must go green on a machine with neither a simulator nor a server available**
- **The system suite is not part of develop's phases** (Phase4's machine oracle is on the BE side for now; FE tests are not filed).
  A project that judges it necessary adds it itself, and this document does not cover how to write it. All it defines is **the location and "never mix it into the default suite"**

### Contract-conformance tests belong to the default suite

A contract-conformance test that starts no external environment is **not an integration test** (by the criterion above it falls into the default suite).

**It must never be moved into the integration suite.** develop's Phase4 machine oracle is carried, for now, by the **BE tests** (FE tests are not filed).
The moment it leaves the red-green loop, there is no means left of catching an integration defect in Phase4.
