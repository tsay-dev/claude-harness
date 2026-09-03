---
id: ADR-0019
title: active な REQ / BR に実装側の @implements を機械必須にする（C14）
status: accepted
date: 2026-09-03
---

# ADR-0019 active な REQ / BR に実装側の @implements を機械必須にする（C14）

## Context

C5 はコードの `@implements` が実在する ID を指していること（孤児参照）だけを落とす。注釈忘れは黙って通り、実装から要件への逆引きは AI 判定（`slice-reviewer`）に残っていた。AI 駆動では探索範囲を ID で切れないとコンテキストが腐る。C1 が「active な REQ にテストがある」を機械化したのと同じ向きで、実装側の存在も機械化する必要があった。

## Decision

- **`trace-check` に C14 を追加する。** `active` な REQ と `active` な BR は、`source` またはスキーマ源のいずれかに `@implements` が 1 件以上ある。無いと落ちる。C5 の逆方向である。
- **`source` 未設定のホスト（docs-only）では判定しない。** C13 が `schema` 未設定で飛ばすのと同じ。
- **`@implements UC-nnn` は C14 の対象にしない。** UC は REQ の束であり、grep の主経路は REQ / BR である。ユースケース入口への注釈は `comments.md` の craft のまま。
- **注釈は実現するユニットに置く。** C14 は存在だけを見る。ファイル先頭への列挙は grep がファイル全体を返すので、粒度は comments リーフが拘束する。
- **規約は R-705。** C14 が見るのは注釈の存在までで、そのユニットが文を実現するかは reviewer に残す（R-901）。
- **docs-migrate では BR も Phase 6 まで `draft` のままにする。** Phase 4 で BR を `active` にすると、注釈前に C14 が全件落ちる。REQ と同じく、コードへ繋いだ Phase 6 で `active` にする。

## Consequences

- `Grep @implements REQ-nnn` が空なら、実装が無いか検査が赤かであり、AI は UC ディレクトリ全体を開かなくてよい。
- 既存ホストでは C14 が新規違反として赤になる。導入時は R-804 の認められた増加として `--update-baseline` を一度だけ走らせ、以降は返済する。
- C14 は 1 件あれば通る。関係ない関数に付けても緑なので、置き場所の正しさは reviewer の残差である。
- Phase 4 で BR を `active` にしていた migrate 手順は変わる。C13 は `draft` の DB 保証 BR にも効くので、スキーマ注釈の機械検査は遅れない。

## 却下した選択肢

- **C14 を REQ だけにする**: BR 変更時の grep 経路が残る。欠ける件数は少なく、migrate の Phase 4 を REQ に揃えるコストの方が小さいため却下。
- **UC の `@implements` も必須にする**: UC は REQ の束であり、入口注釈は探索の主経路ではない。必須にすると入口ファイルへ ID が集中し、ロットが戻る。
- **AI 判定のまま（C14 を足さない）**: 注釈忘れは機械に映らず、探索がディレクトリ全体に広がる。C5 だけでは片方向しか閉じない。
- **ファイル先頭の列挙を許して存在だけ見る**: 検査は通るが、grep の戻りがファイル全体になり、導入理由（コンテキストロット）を満たさない。存在検査は残し、粒度は comments で拘束する。
