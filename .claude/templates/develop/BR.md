---
id: BR-000
title: <規則名>
enforced_at: <domain | database | usecase | …> 層
status: draft          # draft | active | withdrawn (active = approved by a human)
---

# BR-000 <title>

<規則の内容。ただし——>

<!--
R-102 check: can this rule's value (threshold, limit, enumeration) be machine-readable?
- Yes → move the value's SSOT to a code constant / DB constraint / schema and write here only
  "値の SSOT は <path>" plus existence and intent.
- Several enforcement points → identify which one is the SSOT by asymmetry (removing which one breaks correctness) and record it in an ADR.
Never list the referrers (R-103; trace-check C4 derives them). Placement: docs/rules/BR-000.md. Write the content in Japanese.
-->

**意図**: <なぜ存在するか。KPI / GOAL との接続>
