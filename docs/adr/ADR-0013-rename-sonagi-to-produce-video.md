---
id: ADR-0013
title: 動画制作スキルの名前を sonagi から produce-video へ変える
status: accepted
date: 2026-08-31
---

# ADR-0013 動画制作スキルの名前を sonagi から produce-video へ変える

## Context

動画の制作定義を出すスキルは、当初 `sonagi` という固有名で作られた（[ADR-0009](ADR-0009-sonagi-stops-at-definitions.md)
〜[ADR-0012](ADR-0012-research-stage-confined-and-independently-verified.md) はこの名前で書かれている）。

固有名は `/sonagi` と明示すれば確実に起動するが、**何をするスキルかを名前が伝えない**。
harness の他のスキルは場面を動詞で表す命名（`develop` / `plan-app` / `docs-migrate` / `attack`）で揃っており、
`sonagi` だけがその規則から外れていた。

また description による自動起動（「ショート動画を作りたい」など明示のない言い方）では、
スキル名も判断材料になる。名前が内容を伝えないことは、そのまま起動精度の不利になる。

## Decision

**`sonagi` → `produce-video` にリネームする。** 三本木（`skills/` / `agents/` / `rules/`）と `tools/` の
ディレクトリ名、agent frontmatter の `name:`（`sonagi-researcher` → `produce-video-researcher` など）、
スクリプト名（`sonagi.py` → `produce-video.py`）、および全ての相互参照を機械的に置換する。

**ショートに限定した名前（`make-short-video` など）は採らない。** ロング対応は
`videos/long/` と `rules/produce-video/long/` を足すだけで済む形にしてあり、
そのときに名前が嘘になるのを避ける。

**ADR-0009〜0012 は書き換えない。** 決定内容は変わっておらず、accepted な ADR を書き換えないのが
このリポジトリの規約である。旧名で書かれた4件は、本 ADR が名前の対応を示すことで読める状態に保つ。

## Consequences

- 名前が内容を伝えるようになり、description による自動起動の材料が増える。他スキルとの命名も揃う。
- ロングを足しても名前が嘘にならない。
- **`/sonagi` は動かなくなる。** v1.6.0 を取り込んだホストにとっては破壊的変更であり、
  タグの注記で移行を示す。
- ADR-0009〜0012 は旧名のまま残る。本 ADR を辿らないと対応が分からない。

## 却下した選択肢

- **`sonagi` のまま残し、別名を薄いエイリアスとして足す**（`grill-me` → `grilling` と同じ手）:
  既存の起動方法を壊さない。しかし三本木のキー名は `sonagi` のままなので、
  ディレクトリを開いた人には依然として内容が分からず、問題の本体が解決しない。
- **`make-short-video`**: 内容は最も明確だが、ロング対応を足したときに名前が嘘になる。
- **`video-production`**: 名詞句。内容は伝わるが、動詞先頭で揃えている他スキルの命名から外れる。
