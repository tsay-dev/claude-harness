---
id: ADR-0004
title: DB 設計の SSOT をホストの native スキーマ源に限定し、DB で強制する規則を C13 で機械検査する
status: accepted
date: 2026-08-25
---

# ADR-0004 DB 設計の SSOT をホストの native スキーマ源に限定し、DB で強制する規則を C13 で機械検査する

## Context

ADR-0003 で sdd-kit の構成を採用した際、DB 設計の扱いだけが旧来のままだった。`db-designer` は「framework が native 形式を定めていればそこへ、無ければ `docs/db/schema.md` に中立ドラフト」を書く建て付けで、これは採用した規約 R-102（機械可読にできる事実は docs を SSOT にしない）と正面から矛盾する。また「`enforced_at: database` の BR に対応する制約があるか」「状態×イベント表の全状態を実体が持つか」は structure-oracle の AI 判断に頼っており、値の SSOT が複数の保証点に割れる場合（ドメイン層の早期拒否と DB の UNIQUE 制約）に誰が決めるかも定まっていなかった。

## Decision

- **DB 設計の SSOT はホストの native スキーマ源のみ**（migration / `schema.prisma` / `db_design.txt` / SwiftData モデルなど）。ホストが `CLAUDE.md` または `traceconfig.json` の `schema.files` / `schema.dirs` に住所を宣言し、`db-designer` はそこへ直接書く。docs 側の中立ドラフトは廃止し、宣言が無ければ db-designer は書かずに止まる。人間ゲートは native ファイルの差分をそのまま見る。ER 概要は要るなら生成物とし、コミットしない。
- **スキーマ源の制約には `@implements BR-nnn` を書く**（SQL コメント、Prisma の `///`、Swift の doc comment）。`trace-check` に `schema` ブロックと **C13**（`enforced_at` に database を含む BR はスキーマ源から `@implements` されていること）を追加し、スキーマ源の注釈は C4 / C5 の対象にも入れる。C13 が見るのは注釈の存在までで、制約が規則を本当に強制するかは structure-oracle に残す（R-901）。規約は R-704 として `rules/develop/docs.md` に置く。
- **DB 設計はスライスごとの増分**（Phase3 で該当 UC 分だけ）。全ゴール分を先に引く手順は設けない。
- **保証点の非対称性は db-designer が提案し、人間が承認して ADR に落とす。** requirement-definer は資料から読める `enforced_at` を書き「要確認」として人間リストに載せるだけで、自分では決めない。承認後に adr-writer が記録し、`enforced_at` が変わるなら requirement-definer が BR を更新する。
- 端末内のローカル永続（SwiftData / SQLite / Core Data）も「永続データ」として DB 設計の対象にする。`local-store` 契約は境界の形、モデル定義はスキーマ源、と役割を分ける。

## Consequences

- docs に腐る 2 箇所目（schema.md）が無くなり、R-102 が DB にも一貫する。ホストごとの native 形式を尊重したまま、`@implements` の注釈だけを harness の要求にできる。
- DB 制約の有無が AI 判断から機械判定（C13）に格上げされ、structure-oracle の仕事は「制約の意味」に絞られる。
- スキーマ源が未宣言のホストでは db-designer が止まるので、`/develop` 初回に `traceconfig.json` の `schema` を埋める手順が 1 つ増える。永続データを持たない UC（他社 API / デバイス機能のみ）はスキップでよい。
- C13 は `enforced_at` の文字列に `database` / `db` を含むかで判定する粗い規則で、`enforced_at: DB 一意制約` のような表記はプロジェクトが合わせる必要がある。
- 用語集の状態値がスキーマの enum に存在するかは機械検査していない（ORM ごとの表記差を lint が吸収する必要があるため見送り）。用語集の遵守は説得的統制のまま。

## 却下した選択肢

- **native が無い初期だけ `docs/db/schema.md` を許す**: R-102 の例外を 1 つ抱え、native が決まった後に attic へ移す手順が増える。framework 未定の段階で DB を設計する必要は無い（Phase3 は契約と同時で、その時点で framework は決まっている）ため却下。
- **常に docs 側に ER 概要を併置する**: 人間には読みやすいが、マイグレーションとの不整合が再生成漏れで即座に生じる。生成物で足りる。
- **C13 で用語集の状態値 ↔ スキーマ enum の一致まで見る**: 価値はあるが Prisma / SQL CHECK / Swift enum の表記差を lint 側に持ち込む。BR 単位で止め、必要になったら supersede する。
- **Phase1 完了後に全ゴール分の骨格を先に引く**: 正規化の見通しは良いが最初の人間ゲートが重くなり、started でないゴールの設計を先取りすることになる（R-1008 の精神に反する）。高リスク判定時の walking skeleton で代替できる。
- **requirement-definer が BR 起草時に保証点を決める**: DB 設計前に決めることになり後で覆る。人間が最初から決める案は、AI に非対称性の分析をさせない分だけ判断材料が減る。提案は AI、決定は人間、記録は ADR、という分担にした。
