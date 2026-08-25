---
paths:
  - "**/*Tests.swift"
  - "**/*Test.swift"
  - "**/*Tests/**"
  - "**/*Spec.swift"
---

# 🧪 SwiftUI — common testing rules (all layers)

> **Scope: native iOS apps using SwiftUI.** If it does not apply, discard it.
>
> **The principles of testing (what to test and why) rest on develop's development process.**
> One test = one behavior; include failure, empty, permission, and boundary in the conditions; mock only at the boundary;
> make it deterministic; coverage is a signal, not a target — these are common to all development, so they are not restated here; follow them there.
>
> This document holds only **the wiring that makes those principles hold in SwiftUI iOS**.
> **No frontend (View) testing leaf is placed for now** (develop does not file FE tests).
> Notation is [common/coding.md](./coding.md). Where the layers live is [frontend/dataflow.md](../frontend/dataflow.md).
> **Who runs the tests you wrote, and when** (never during a concurrent section; consolidated into one run on one simulator) is authoritative in
> [test-execution.md](./test-execution.md). This document covers **what to write and which suite it goes in**.
>
> **Write test names and comments in Japanese.**

---

## 1. The runner is declared by the project

**The harness never pins a specific test runner** (either XCTest or Swift Testing is fine).
The choice, the configuration, and **the command that runs the default suite** are recorded in the host's `CLAUDE.md`.

- **A single command must run the whole default suite, with the exit code deciding red or green**
  (e.g. `xcodebuild test …`, or SPM's `swift test` — match the project's setup)
- **If none is installed, installing it is the gate to starting.** Pushing implementation forward with no runner means
  develop's Phase4 (the red-green loop driven by the machine oracle) does not hold

---

## 2. Scoped execution (the UC tag) and requirement coverage (`@covers`)

In every test, make the outermost group's name read

`UC-012 <UC title>`

so it can be selected mechanically by the UC ID (the same key as the UC directory name under `docs/goals/`).

- With Swift Testing use `@Suite("UC-012 …")`; with XCTest include `UC-012` in the outermost class name or the name
- **Every test names exactly one declared partition class** with `// @covers REQ-045#class` as the first line of its body (`trace-check` C10 / C11 read it; declare the class in the REQ's `## 検証方針` first)
- Write the concrete selection command, matched to the runner, in `CLAUDE.md`
- **When to run a selection vs the whole default suite is authoritative in develop skill §4 (test-run granularity).** This leaf defines only how to stamp and select by UC ID
- **Never let a new test go untagged** (when to run the selection is in [test-execution.md](./test-execution.md) and develop skill §4)

---

## 3. The machine oracle's main arena is the Domain (the UseCase)

On this stack, the center of the deterministically drivable red-green loop is the **UseCase** (and a thin ViewModel where needed).

| Priority | Target | How |
| --- | --- | --- |
| Primary | **UseCase** | Inject a **fake of the protocol** for the Repository. Exercise success, failure, empty, permission, and boundary |
| Next | **ViewModel** | Inject a fake UseCase and verify only the screen state and the Router calls |
| Not done (by default) | **View snapshots / XCUITest** | They tend to presuppose a simulator. Never mix them into the default suite |

- **Mock only at the boundary** (the Repository, the clock, randomness, and so on). Never mock a whole Domain Entity
- Never let a Data-layer `URLSession` implementation hit the real network in the default suite.
  To exercise the HTTP layer, close it off with a fake `URLProtocol` or similar; if that still needs an external environment started, it goes to the integration suite
- When examining a Router in a ViewModel test, use a fake or a spy that can observe the path change or the call

```swift
@Test("UC-012 ログイン — 成功するとセッションが立つ")
func loginSucceeds() async throws {
  // @covers REQ-045#accept-standard
  let users = FakeUserRepository(result: .success(sampleUser))
  let useCase = LoginUseCase(users: users)
  try await useCase.execute(email: "a@b.c", password: "secret")
  // 期待する Domains の結果だけを断言
}
```

---

## 4. Make it deterministic (what wobbles on iOS)

| Source of wobble | How to handle it |
| --- | --- |
| The real network / the real keychain / the real disk | never used in the default suite. Fake the boundary |
| Real time and timers | inject and pin them, or control them from the test |
| Waiting with a real-time `sleep` / `Task.sleep` | **never use it.** It flakes under CI load |
| Animations and transition animations | never wait for completion. Never make them the thing under verification |
| MainActor | respect `@MainActor` when testing a ViewModel (align the test function's annotation and the execution means) |

Tests **never depend on order.** If you modified a shared mutable global or a singleton, always restore it.
A test that depends on `.shared` is a signal the design has already dissolved ([frontend/dataflow.md](../frontend/dataflow.md)).

---

## 5. Split suites by what execution requires

Rather than picking test-level names (unit / integration / system) first and classifying by them,
split by **what has to be started for that test to run**.

| Suite | The criterion (this alone decides it) | Location (the default example) | How often it runs |
| --- | --- | --- | --- |
| **Default** (unit) | starts neither a simulator nor a real API (mocks only at the boundary) | mirroring the target, `Tests/`, and so on | the suite the red-green loop draws from (selection during a round; whole run at a boundary — develop skill §4) |
| **Integration** | **connects to a real API or a real service** | `Tests/Integration/`, and so on | at a boundary only |
| **System** | **starts a simulator or a real device** (XCUITest, snapshots, and so on) | `UITests/` / `e2e/`, and so on | outside the phases (opt-in) |

- **Separate by folder (or a separate test target).** Relying on names alone lets things leak into the default suite
- **Exclude the integration and system locations from the default suite's discovery**
- **The default suite must go green on a machine with neither a simulator nor a server available.**
  "Starts nothing" here means **the test itself does not start UI, a real device, or a real service**; it does not forbid
  a setup where the runner requires a simulator destination (an app target's `xcodebuild test`).
  How runs are driven in that setup is [test-execution.md](./test-execution.md)
- **The system suite is not part of develop's phases** (Phase4's machine oracle does not file FE tests for now).
  A project that judges it necessary adds it itself, and this document does not cover how to write it.
  All it defines is **the location and "never mix it into the default suite"**

### Contract-conformance and UseCase tests belong to the default suite

A UseCase or contract-conformance test that starts no external environment is **not an integration test**.
**It must never be moved into integration or UITests.** The moment it leaves the red-green loop, there is no means left of catching an integration defect in Phase4.

---

## ✅ Checklist before returning

- [ ] Is the command that runs the default suite in `CLAUDE.md`, with red/green readable from the exit code?
- [ ] Does the outermost group carry `UC-nnn`, and every test a `@covers REQ-nnn#class`?
- [ ] Is the main assertion on the UseCase (or a thin ViewModel) rather than escaping into a View/UI test?
- [ ] Does mocking stay at boundaries such as the Repository?
- [ ] Do the default suite's tests themselves avoid starting the real network, a real device, or UI? (the runner's destination requirement is a separate matter)
- [ ] Did you put in real-time waits or waits for animation completion?
- [ ] Are integration and system out of the default suite's discovery path?
