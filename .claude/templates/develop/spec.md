---
機能ID: F-000
機能名: <機能名>
ステータス: draft        # draft | fixed
更新日: YYYY-MM-DD
---

<!--
  This directory's SSOT is the pair spec.md + contract.yaml (the MIS).
  This file holds behavior (meaning, rules, observable conditions). The shape of the
  boundary (types, required-ness, enums, wire) goes to the contract.

  This spec is read in full, in a separate context, at 9 points per slice
  (every producer and oracle). Its volume is billed directly as context to all of them.

  The substance of this file is the 業務ルール (rules). 受け入れ条件 are representative
  examples placed where the rules alone admit divergent readings — not a list of test cases.
  Exhausting the cases is test-designer's job (one rule → N tests is the healthy ratio).

  Write the content in Japanese.
-->

## 目的
（ユーザー価値。1〜2行。実装方法には触れない）

## アクター・権限
- 対象ユーザー / ロール：
- 権限条件：

## 入力 (Input)
<!-- Types, ranges, required-ness, and enumerated values live in contract.yaml. Do not transcribe them here.
     Rules about accepted values ("an integer of 1 or more", etc.) go into 業務ルール as one sentence;
     the contract is derived from there. -->

| 名前 | 業務上の意味 |
| --- | --- |
| i_xxx | <この入力が業務上何を指すか> |

## 出力 (Output)
<!-- Only the kinds of information returned and their business meaning. The response shape lives in the contract.
     Do not write placement or decoration (spacing, ordering, label position, color). -->

- 正常時：（利用者が受け取る情報・遷移先）
- 契約：`./contract.yaml`

## 状態 (States)
（各 1 行。詳細は業務ルールへ）
- success：
- error：
- loading：
- empty：
- 権限なし：
- 境界：

## 業務ルール
<!-- This feature's invariants. This is the substance of the spec and the grounds for refutation.
     One rule per sentence, fitting one of the 4 patterns below (they may be combined):
       常時 (always):    「<主体> は 常に <成り立つこと>。」
       事象 (on event):  「<条件> のとき、<観測できる振る舞い>。」
       状態 (while in):  「<状態> の間、<観測できる振る舞い>。」
       異常 (on error):  「<異常条件> の場合、<観測できる振る舞い>。」
     A rule covers infinite inputs in one sentence. Do not enumerate the values that
     do or do not satisfy it. -->

- <主体> は 常に <成り立つこと>。
- <条件> のとき、<観測できる振る舞い>。

## 受け入れ条件 (GWT)
<!-- Place 1-2 representative examples only where the rules alone admit divergent readings.
     Do not paraphrase a rule, enumerate value variants, or sweep the cases here
     (that is test-designer's job).
     Write at a granularity that decides "what observation would prove this wrong". -->

- **Given** …
  **When** …
  **Then** …

<!-- The i_ prefix on input names is an example matching one framework's rules.
     Follow the conventions of the implementation language and framework in use. -->
