---
paths:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/__tests__/**"
  - "**/vitest.config.*"
  - "**/jest.config.*"
---

# 🧪 Next.js / backend — test design

> **Scope: server-side processing on Next.js (App Router).** If it is not Next.js, treat this document as inapplicable and discard it.
>
> **The common rules are [common/testing.md](../common/testing.md)** (the runner is declared by the project; one command to run;
> determinism; suite separation; `UC-nnn` / `@covers`). This document covers, **on top of following those**,
> only what to try and how, per role. It never restates the common side.
>
> Separation of responsibilities is [backend/coding.md](./coding.md).
> **FE-side tests for the read wiring (an RSC page) are not filed for now** (no frontend testing leaf is placed).
>
> **Write test names and comments in Japanese.**

---

## 1. The main arena per role

| Role | How it is handled in the default suite |
| --- | --- |
| **Domain** | **Highest priority.** Unit tests with no side effects and no mocks needed |
| **Use case** | **Write them.** Infrastructure gets a boundary mock or a fake implementation. Verify the **scenario result** (`ok` / `reason`, and so on) |
| **Infrastructure** | By default, never require a real DB or a real external API. If you write them, they go in the integration suite |
| **Mutation controllers** (Actions / Route Handlers) | **Write them thin.** Schema-validation failure at the edge, the mapping from scenario result to the caller-facing shape, and the use-case invocation. Actions = Result, RH = status + body ([backend/coding.md](./coding.md) §6). Mock `revalidatePath` and the like |

The further inside the onion, the easier and cheaper it is to refute. **Never gather the tests onto a fat Server Action.**

---

## 2. The domain

```ts
describe("UC-012 rename policy", () => {
  it("rejects empty display name", () => {
    // @covers REQ-045#empty-name
    expect(decideDisplayName(current, "  ").ok).toBe(false);
  });
});
```

- Never touch `next/*`, the DB, or the clock
- Never finish on the happy path alone — cover failure, empty, permission, and boundary

---

## 3. Use cases

- Presume infrastructure dependencies are in a shape that can be injected as arguments
- Mock **only the infrastructure boundary** (never mock all the way down through the domain)
- What it returns is the scenario result. The mapping into the caller-facing shape is examined in the mutation-controller tests

---

## 4. Mutation controllers (Server Actions / Route Handlers)

Common to both: on **invalid input**, the use case is not called and the failure is distinguishable. On **valid input**, the use case is called with the expected arguments and the scenario result lands in the caller-facing shape.

| Implementation form | What to look at |
| --- | --- |
| Server Actions | success / failure of the caller-facing Result |
| Route Handlers | the HTTP status + body (does it match the contract?) |

Mock the Next-specific APIs; sweeping cache keys is not required.

---

## 5. Infrastructure and the integration suite

- Put real-DB tests in the integration suite and keep them out of the default suite
- By default, stay on in-memory fakes or mocks and cover only the boundary's inputs and outputs

---

## ✅ Checklist before returning

- [ ] Is the pure domain test the main arena?
- [ ] In use-case tests, are you boundary-mocking infrastructure only?
- [ ] Do mutation-controller tests stay closed on the edge and on distinguishing success from failure? (Actions = Result, RH = status + body)
- [ ] Have you made read-wiring tests mandatory for the backend? (they are the frontend's)
- [ ] Are real-DB tests split into the integration folder and excluded from the default?
- [ ] Does the outermost group carry `UC-nnn`, and every test a `@covers REQ-nnn#class`?
