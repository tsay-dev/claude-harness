---
id: ADR-0003
title: docs の構成を sdd-kit の SDD/SSOT 構造（GOAL→UC→REQ・分割クラス・trace-check）へ移す
status: accepted
date: 2026-08-25
---

# ADR-0003 docs の構成を sdd-kit の SDD/SSOT 構造（GOAL→UC→REQ・分割クラス・trace-check）へ移す

## Context

harness の docs は「1 機能 1 ディレクトリ（`docs/specs/F-xxx-<slug>/`）に `spec.md`（目的・入出力・状態・業務ルール・GWT）と `contract.yaml` を置き、台帳 `specs.md` の工程列で進捗を持つ」構成だった。ADR-0001 / 0002 で契約側は整えたが、spec 側に次の構造的な限界が残っていた。

1. **1 ファイルに種類の違う情報が同居する。** シナリオ・状態・規則・受け入れ例が同じ `spec.md` に載るため、改訂のたびに堆積し、負のリストと肥大 warn で押さえ込む運用になっていた（実例: 改訂 1 日で 164→540 行）。読む側（1 スライス 9 箇所）は全文を読むしかない。
2. **テスト生成に機械的な上限・下限が無い。** 「規則 1 本 → テスト N 本」は test-designer の craft に頼る説得的統制で、どこまで書けば十分か、なぜそのテストがあるかをコードからも docs からも復元できない。
3. **コードから docs への逆参照が無い。** どの実装がどの要求を担い、どの規則が死んでいるかは AI の読解に依存し、機械では検出できない。
4. **横断規則の家が無い。** 複数機能に効く規則は「所有機能の spec だけが持ち、他は 1 行参照」という約束だったが、所有者の選択が恣意的で、参照の逆引きも手作業だった。
5. **台帳ファイルが腐る。** `specs.md` の状態列は各 spec の写しで、再生成漏れがそのまま不整合になっていた。

ユーザーが別途整備した **sdd-kit v5**（`conventions/CONVENTIONS.md` の R-ID 付き規約、GOAL→UC→REQ の木構造、BR/NFR/ADR の中央配置、REQ 内の分割クラス宣言、`@covers` / `@implements` 注釈、`trace_check.py` の 12 検査と baseline ラチェット、Phase 0–7 の移行プレイブック）が、これら 5 点に対する答えを一式で持っていた。

## Decision

sdd-kit v5 のドキュメント構成を harness の docs 構成として採用し、harness の原則（常駐ゼロ・三木整列・建てる≠裁く・書式はテンプレート / craft は agent body）に合わせて次のとおり配置する。

- **レイアウト**: `docs/00-vision.md` / `01-glossary.md` / `02-actors.md` / `goals-backlog.md`、`docs/goals/GOAL-nn-<slug>/GOAL.md`、`…/UC-nnn-<slug>/{UC.md, REQ-nnn.md, contract.yaml}`、`docs/rules/BR-nnn.md`、`docs/nfr/NFR-nnn.md`、`docs/adr/ADR-nnnn-<slug>.md`、`docs/verification/GLOBAL.md`、`docs/_shared/components.yaml`、ホスト直下 `traceconfig.json`。**スライスの単位は F-xxx から UC-nnn へ**移り、UC ディレクトリが MIS になる。
- **契約は UC ディレクトリ直下の `contract.yaml`**（ADR-0001 の形式を維持。`x-feature-id` → `x-uc`、`x-spec: ./UC.md`）。sdd-kit の C7（実装のエラーコード ⊆ 契約）は `_shared` の `errorCodes` との突合として移植する。
- **ステータス語彙**: docs ノードは `draft → active → withdrawn`（`active` ＝ 人間承認。旧 `fixed` に相当。単票は `frozen` / `living`）、契約は従来どおり `draft → fixed`。C1 / C2 / C8 / C10 は `active` のみを対象にする。
- **工程は台帳でなく `UC.md` の frontmatter `phase:`** に持つ（R-1003: 索引はコミットしない）。gate-hook と orchestrator はこれを読む。
- **CONVENTIONS.md は常駐させず、`rules/develop/docs.md`（`paths: docs/**`）として paths ゲートで配る。** R-ID はレビュー指摘の語彙として残す。書式はテンプレート、機械検査はツールへ分配し、三者を複製しない。
- **`trace_check.py` は Node（依存ゼロ）へ移植し `tools/trace-check/`** に置く（annotation は regex モードのみ。`--only` で producer の自己検査を可能にする）。spec-lint は書式とライフサイクルに専念し、レイアウトを UC 木に合わせて書き直す（`convert` サブコマンドは削除）。
- **Phase1 の producer を 3 体に分割**する: `domain-definer`（vision / glossary / actors / GOAL / NFR）→ `usecase-definer`（UC ごと並行）→ `requirement-definer`（REQ ＋ BR 括り出し）。`ssot-definer` は廃止。REQ の `## 検証方針`（分割クラス）は `test-designer` が所有する。
- **コード側は `@implements REQ/BR/UC`（実装）と `@covers REQ#class`（テスト）**を必須とし、選択実行のタグは `F-xxx` から `UC-nnn` へ。
- **ADR の書式は sdd-kit 形式**（frontmatter `id/title/status/date/supersedes`、`却下した選択肢` 節、`ADR-nnnn-<slug>.md`）に統一し、テンプレートを SSOT にする。harness 自身の ADR-0001 / 0002 も改名した。
- **`/docs-migrate` は sdd-conform の Phase 0–7 と A-1〜A-5 を骨格に書き直す**（F-xxx → UC への分割は機械変換できないため producer 委譲）。
- `PRD.md` は `00-vision.md` に吸収する。`design.md` は任意の人間所有文書として残す。

## Consequences

**得られるもの**

- 仕様の種類ごとに家が分かれ、1 UC の読み込み単位が `ls` で閉じる。堆積は種類の境界で止まる。
- テスト生成の下限（C10）と上限（C11）が機械検査になり、「方針にないテスト」が構造的に落ちる。
- 実装 → 要求 → 規則の逆引きが `trace-check` の生成物になり、死んだ規則・孤児参照・配置ずれ・採番衝突が機械で見つかる。
- 既存プロジェクトは baseline ラチェットで「悪化しない」だけを先に強制できる。
- 索引と台帳が消え、frontmatter だけが所属と工程の SSOT になる。

**代償と今後の制約**

- **破壊的変更。** F-xxx レイアウトのホストは `/docs-migrate` を通すまで spec-lint が通らない。spec.md → UC + REQ の分割は agent 駆動で、機械変換ではない。移行前のホストは `v0.x` タグに留まる。
- docs を書く agent は `trace-check --next` での採番と `spec-lint` / `trace-check --only` の自己検査を前提にする。`traceconfig.json` の seed と保守という手順が 1 つ増える。
- `trace-check` の annotation 検出は行単位の正規表現に限る（Python AST モードは落とした）。docstring 以外の場所に書かれた `@covers` も拾うため、コメント以外に同じ文字列を置かないという規律が要る。
- 分割が入力空間を尽くしているか、assertion が EARS 文の意味を検証しているかは機械では判定できず、slice-reviewer の責務として残る（R-901）。
- 三木の agents が 13 → 16 体になり、Phase1 の人間ゲートが最大 3 段になる（domain → UC → REQ）。小さな追加は `/develop-light`（UC 1 本、domain-definer なし）で吸収する。

## 却下した選択肢

- **`trace_check.py` を Python のまま同梱する**: 実装コストは最小だが、harness のツールが Node / Python 混在になり、ホストに Python を要求する。spec-lint / gate-hook と同じ依存ゼロ Node に揃えるため却下。
- **trace-check を spec-lint に統合して 1 本にする**: ツールは 1 つになるが 3,000 行級になり、「書式」と「トレーサビリティ」という別の関心が 1 ファイルに同居する。役割を分けて別ツールにした。
- **契約を sdd-kit どおり `contracts/openapi.yaml`（中央・HTTP のみ）へ戻す**: ADR-0001 を 2 日で覆すことになり、native の非 HTTP 境界（deeplink / push / local-store / device）の居場所を再び失う。UC ごとの `contract.yaml` を維持した。
- **`ssot-definer` 1 体を 3 段階で起動する**: agent 数は増えないが body が肥大し、UC ごとの並行起動と人間ゲートの粒度が粗くなる。成果物の種類ごとに producer を分けた。
- **台帳 `specs.md` を残して工程列だけ使う**: 索引をコミットしない R-1003 と衝突し、腐る写しが 1 つ残る。工程は `UC.md` の frontmatter へ移した。
- **`CONVENTIONS.md` をそのまま `docs/` か `.claude/` に常駐させる**: 常駐カタログの禁止（CLAUDE.md §0）に反する。paths ゲート付きの rules 葉に置き換えた。
- **`PRD.md` を残して `00-vision.md` と併存させる**: 同じ Why が 2 箇所に割れる。vision に吸収し、横断業務原則は BR へ送った。
- **spec-lint の `convert`（OpenAPI → contract.yaml 機械変換）を残す**: 2 世代前の形式からの変換で、今回の移行経路（F-xxx → UC）では使えない。削除して lint を痩せさせた。
