---
id: ADR-0006
title: 失敗経路を持たない操作は errors: [] で宣言し、反例には request.properties 外のキーを許す
status: accepted
date: 2026-08-25
---

# ADR-0006 失敗経路を持たない操作は errors: [] で宣言し、反例には request.properties 外のキーを許す

## Context

ADR-0001 の契約フォーマットは、`fixed` の全 operation に `examples` の正常 1 件＋異常 1 件（`error: <code>`）を要求していた。旧契約に 4xx が 1 つも無い読み取り専用の壁（設定値の読み出し、状態の秘伝など）を `fixed` のまま変換すると、この ERROR が恒久的に残る。移行の実測では 10 operation が該当し、1 名の author は根拠の無い `STORAGE_UNAVAILABLE` を足して赤を消した——検査が発明（A-1 違反）を誘発していた。

同じ `examples` の検査は、`request` のキーが `request.properties` に無いと ERROR にしていた。`additionalProperties: false` や `not:` で禁じたキー（計測要求に `body` を載せない、など）の**反例**が契約に書けず、旧 OpenAPI 契約が持っていた反例の入力が変換で失われた。

## Decision

- **`errors: []` を「この操作は失敗経路を持たない」の宣言とする。** この宣言がある operation には異常系の example を要求しない。`errors` の**省略**は宣言ではなく、従来どおり何も主張しない（`auth` の「忘れた／要らない」の区別と同じ流儀で、省略と空を区別する）。convert は旧契約に 4xx が無い operation を `errors: []` で出力し、失敗例を発明しない。
- **`error:` を持つ example の `request` は `request.properties` と突き合わせない。** 失敗例は「望まれない入力」であり、禁じたキーを含むことが反例の本体だから。必須キーの欠落も同様に検査しない。正常例は従来どおり検査する。

いずれも spec-lint（`validateContract`）で強制し、テンプレート `contract.yaml` のコメントを SSOT として書く。

## Consequences

**得られるもの**

- 読み取り専用の壁を、コードを発明せずに `fixed` にできる。検査が「失敗を持たない」と「書き忘れた」を区別する。
- 禁じたキーの反例が契約に戻り、実装とテストがそのままコピーできる。

**代償と今後の制約**

- `errors: []` は宣言であって証明ではない。本当に失敗経路が無いか（ストレージ不在・破損など）は structure-oracle の意味的判断に残る。
- 失敗例の `request` は形式検査の外に出る。タイポによる誤った反例（禁じたつもりが単なる綴り違い）は機械で見つからない。

## 却下した選択肢

- **失敗例の要求を全面的に外す**: 「異常系が無い」と「異常系を書き忘れた」が区別できなくなる。省略と空の区別を保つ方が既存の設計と整合するため退けた。
- **`x-no-failure: <理由>` のような別キーで宣言する**: `x-no-boundary` と同型で理由も書けるが、`errors: []` と意味が重複し、両方を書いたときの整合検査が増える。`errors: []` 一本で十分と判断して退けた。
- **反例専用の枠 `invalidRequest:` を examples に足す**: 反例が正常な `request` と別の場所に散り、実装側の写しがしにくい。`error:` の有無で既に正常／異常が分かれているので、その区別を検査の切り替えに使う方が小さいため退けた。
