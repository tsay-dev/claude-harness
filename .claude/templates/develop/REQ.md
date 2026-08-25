---
id: REQ-000
pattern: <Ubiquitous | Event-driven | State-driven | Unwanted behaviour | Optional>
uc: UC-000
br: BR-000             # optional — only when a business rule applies; delete the line otherwise
status: draft          # draft | active | withdrawn (active = approved by a human)
---

# REQ-000

> <EARS で 1 文。外部から観測可能な振る舞いのみ（R-401）。自己検査: 実装を全部差し替えてもこの文は真か>

## 検証方針

<!--
Owned by the test designer, not by the requirement's author (the author leaves this section as the scaffold below).
Only what cannot be reconstructed from the test code (R-604). Never the setup / action / expected value of a case (R-601).
The class list = the SSOT for the full set of tests to write (R-1101). Each test points at one class with @covers REQ-000#class (R-1102).
Placement: docs/goals/<GOAL-nn-slug>/<UC-000-slug>/REQ-000.md — directly under the UC named by uc: (trace-check C9).
Write the content in Japanese.
-->

- **分割クラス**:
  - `#<class-1>` — <この同値クラスの 1 行の意図>
  - `#<class-2>` — <…>
- **尽きている根拠**: <なぜこの分割で入力空間が尽きるか>
- **境界の扱い**: <該当時のみ>
- **検証しない**: <クラス化しない入力領域と理由（R-1104）>
- **参照先**: `<tests/ファイル>::<クラスまたは describe>`
