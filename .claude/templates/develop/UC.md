---
id: UC-000
title: <動詞で終わる短い名前>
actor: ACT-00
goal: GOAL-00
status: draft          # draft | active | withdrawn (active = approved by a human)
phase: 定義            # 定義 | 構造 | 実装 | 検証 | 完了 — the progress ledger. Only the orchestrator advances it
---

# UC-000 <title>

<!--
Placement: docs/goals/GOAL-00-<slug>/UC-000-<slug>/UC.md — the file name is always UC.md (R-1006).
This directory is the vertical slice: UC.md + REQ-*.md + contract.yaml, and `ls` defines its scope.
Membership's SSOT is the frontmatter above; the directory is placement (trace-check C9 checks they agree).
This file is read in full, in a separate context, by every downstream producer and oracle. Keep it thin.
Write the content in Japanese.
-->

## 概要

<!-- 1–2 sentences. Who achieves what. -->

## 事前条件

- 適用される業務規則: BR-000（内容は転記しない。ID 参照のみ / R-101）

## 主シナリオ

<!-- Numbered. The subject of every step is either the actor or システム. A step that applies a BR carries "→ BR-nnn". -->

1. <アクター>が…
2. システムが…を検証する → BR-000

## 状態 × イベント表

<!-- R-501: every cell is filled. The only information this table holds is "cell → the REQ derived from it".
     Never write the requirement's content here. An impossible cell says 不可: <reason>. -->

| <中核リソース>の状態 \ イベント | <イベント1> | <イベント2> |
| --- | --- | --- |
| <状態A> | REQ-000 | 不可: <理由> |

## 例外系の走査（4 分類）

<!-- R-502: sweep every step for the 4 classes. 導出 names the table cell or the REQ. -->

| 軸 | 該当ステップ | 導出 |
| --- | --- | --- |
| 権限 | | |
| 不変条件違反 | | |
| 並行性 | | |
| 外部依存 | | |

## 事後条件

- 成功時: <観測可能な状態>
- 失敗時: いかなる状態変更も残っていない（部分適用なし）
