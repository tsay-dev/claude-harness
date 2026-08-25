---
id: ADR-0005
title: spec-lint にも baseline ラチェットを持たせ、移行中の baseline 増加を 2 点だけ例外として認める
status: accepted
date: 2026-08-25
---

# ADR-0005 spec-lint にも baseline ラチェットを持たせ、移行中の baseline 増加を 2 点だけ例外として認める

## Context

既存プロジェクト（iOS アプリ、旧 F-xxx レイアウト、24 UC）を `/docs-migrate` で harness v1.1.0 の SDD レイアウトへ移行した際、検査の設計が移行の順序と 3 箇所で衝突した。

1. spec-lint は `docs/specs/` を検出すると即 exit 1 で止まり、新しく書いた REQ / BR / 契約の**形式検査が 1 件も走らない**。Phase 3〜6 の全期間、全 producer が `rsync` で `docs/` の隔離コピーを作って `--docs` で回す運用になった。
2. 移行は承認状態を保つ（旧 spec `fixed` → 契約 `fixed`）が、REQ は試験を接続する Phase 6 まで `draft` に置くのが正しい順序（先に `active` にすると C1 / C10 が数百件立って ratchet が壊れる）。この期間「契約が `fixed` なのに REQ が `draft`」の ERROR が 24 本残り、消す手段が無かった。
3. Phase 6 で REQ 363 本を `active` にした瞬間に C1 27 件・C10 141 件が立ち、`--update-baseline` で 168 件を記録した。R-804（baseline は減るだけ）の記録上は「増えた」。

いずれも harness の欠陥として人へ報告され、移行中は直さない掟（docs-migrate の「What this skill does not do」）に従って持ち越された。

## Decision

- **spec-lint に trace-check と同じ意味論の baseline ラチェットを持たせる**（`--update-baseline` / `--strict` / `--baseline <file>`、台帳は `.spec-baseline.json`）。台帳のキーは「ファイル（行番号を除く）: メッセージ」とし、無関係な編集で行がずれても既知の違反を新規と数えない。`gate` は baseline を見ない（実装着手は免除されない）。
- **`--ignore-legacy-layout` を足す**。旧ディレクトリを warn に落として新レイアウト側の検査を続ける。CI の再利用ワークフローは `spec_lint_args` 入力でこれを受け取り、移行完了時に外す。
- **「契約が `fixed` なのに REQ が `draft`」は ERROR のまま**とし、移行中は baseline に載せる。warn に落とさないのは、通常の develop では本当に順序違反だから。
- **R-804 の例外を 2 点だけ明文化する**（docs-migrate A-5・rules/develop/docs.md R-804）: spec-lint は Phase 5 の末尾、trace-check は Phase 6 の末尾。どちらも「検査が既存の材料に初めて掛かった時点の、既存の穴の正直な記録」であり、件数を工程報告に名指しする。それ以外の増加は従来どおり差し戻す。

## Consequences

**得られるもの**

- 移行中も producer が素の `spec-lint validate` を叩ける。隔離コピーの運用が消える。
- 既知の赤と新規の赤が機械で区別され、「新規違反ゼロ」を移行の全工程で判定できる。
- baseline が「増えた」ことの意味が記録上で区別できる（名指しされた 2 点か、差し戻すべき退行か）。

**代償と今後の制約**

- 台帳ファイルが 2 つになる（`.trace-baseline.json` / `.spec-baseline.json`）。両方を単調減少させる責務をホストが負う。
- 行番号を落としたキーは、同じファイル・同じメッセージの違反が複数行にあるとき 1 件に畳まれる。spec-lint のメッセージは操作名・キー名を含むため実害は小さいが、完全ではない。
- 例外を明文化したことで「移行中だから」を口実にした baseline 増加が起きうる。名指しの 2 点以外は review で差し戻す、という運用が前提になる。

## 却下した選択肢

- **「契約が `fixed` なのに REQ が `draft`」を移行中だけ warn に落とす**: 移行中かどうかをツールが知る手段が無い（フラグを増やすか、移行を検出する必要がある）。通常の develop では本当の順序違反であり、baseline があれば同じ効果が得られるため退けた。
- **移行では契約を `draft` に落とし、Phase 6 で `fixed` に戻す**: 承認状態を保つ掟（Preserve approval state）に反する。旧 spec で人間が承認した事実を一時的に消すことになり、A-1（発明しない）と同じ理由で退けた。
- **spec-lint に baseline を持たせず、隔離コピー運用を台本に書く**: 実測どおり 24 UC × 数回の `rsync` が要り、`--docs` の相対パスで `$ref` や `x-spec` の解決が本番と食い違う余地がある。検査は本物の `docs/` に掛けるべきで退けた。
- **C1 / C10 を「検査を導入した時点」から数え始める（既存 REQ を対象外にする）**: 既存の未被覆が機械の目から消える。baseline に載せれば同じ緑が得られ、かつ返済対象として残るため退けた。
