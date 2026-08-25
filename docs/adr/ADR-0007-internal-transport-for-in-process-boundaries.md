---
id: ADR-0007
title: 契約の transport に internal を足し、プロセス内境界を契約に書く決定をホストの ADR に委ねる
status: accepted
date: 2026-08-25
---

# ADR-0007 契約の transport に internal を足し、プロセス内境界を契約に書く決定をホストの ADR に委ねる

## Context

ADR-0001 の `transport` は `http | sdk | local-store | deeplink | push | device` の閉じた語彙で、いずれも「プロセスの外へ出る壁」を指す。同じアプリの 2 モジュール間の境界は R-1204（型システムが契約、コンパイラと C6 が検査器）で operation にしない、が harness の既定である。

端末内で完結する iOS アプリを移行したホストは、旧 OpenAPI 契約 25 本が UI → ユースケースの「アクション境界」を HTTP として書いていたため、その形を保つ変換で全 operation を `sdk` 一律（`owned: true` / `auth: none`）に決めた（ホストの ADR-0042）。各 author からは `local-store` が近いという異論が 8 UC で出た。v1.2.0 でテンプレートに transport の決定表を置いたが、`sdk` を「第三者の SDK の面」と定めたため、ホストの契約は語の意味で harness と食い違ったまま緑になる（spec-lint は語彙の所属しか見ない）。ホストは ADR-0045 で `sdk` 一律を引き継ぎ、次の版に「端末内の壁に当てる語」を求めた。

## Decision

- `transport` の語彙に **`internal`** を足す。意味は「このアプリのプロセス内の境界を、ホストが ADR で『契約に書く』と決めたときの語」。`owned: true` / `auth: none` が通常で、`wire` / `entry` は持たない。
- **既定は変えない。** プロセス内境界は R-1204 のとおり operation にしないのが既定で、`internal` はその既定を **ホストの ADR が一律に覆した場合だけ**、全 UC に同じ規則で使う。author が UC ごとに `sdk` / `local-store` / `internal` を好みで選ぶことは許さない（テンプレートの決定表・contract-author・docs-migrate に明記）。
- spec-lint は `internal` を受理し、他の transport と同じ構造検査（`wire` は http 専用、`entry` は deeplink / push 専用）を掛ける。それ以上の意味検査（本当にプロセス内か）は structure-oracle に残す。

## Consequences

**得られるもの**

- 端末内アプリの契約が、他社 SDK と誤読される語ではなく、意味の合う語で書ける。
- 「プロセス内境界を契約に書くか」がホストの ADR 1 本に集まり、author 間の揺れが構造で止まる。

**代償と今後の制約**

- 語彙が 7 つになり、`internal` を「とりあえず何か書く」ための逃げ道に使う誘惑が増える。既定（operation にしない）とホストの ADR の要求は、決定表と craft の説得的制御に留まる。
- `internal` の operation は `owned: true` だが DB 対応の意味検査（contract-author の参照整合）の対象になる。プロセス内境界の「DB 対応」は多くの場合空で、author はその旨を報告に書くことになる。

## 却下した選択肢

- **`sdk` の定義を広げて「プロセス内の境界も含む」とする**: 第三者の SDK（`owned: false` + `source:`）と自前のプロセス内境界（`owned: true`）は所有が逆で、同じ語に畳むと `owned` の意味が薄まる。退けた。
- **語彙を足さず、R-1204 のとおり operation にしないことを強制する（`operations: {}` + `x-no-boundary`）**: 既に 25 本の契約がその境界の形を持ち、実装とテストがそれを写している。契約から消すのは情報の破壊で、移行の A-2 と衝突する。退けた。
- **`x-transport-note:` のような注記キーで意味だけ補う**: 語彙は `sdk` のまま残り、読む側が注記を見なければ誤読する。閉じた語彙の値で意味が決まる、という ADR-0001 の設計に反する。退けた。
