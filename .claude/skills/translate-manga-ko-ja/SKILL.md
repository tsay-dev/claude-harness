---
name: translate-manga-ko-ja
description: 韓国語で描かれた漫画（ウェブトゥーン等）を日本語に翻訳し、人間チェックのコストを最小化する対訳チェックシートを生成する。このスキルを起動したメインエージェントは中立の orchestrator として振る舞い、自分では訳さず・判定せず、.claude/agents/translate-manga-ko-ja の maker（翻訳）と judge（独立レビュー）を順に起動する。対訳シート・一貫性レビュー・master更新提案を話数フォルダへ出力する純粋関数的パイプライン（master は読み取りのみ・更新は差分提案）。「韓国語漫画を翻訳したい」「翻訳チェックシートを作りたい」「ウェブトゥーンを日本語に訳したい」ときに起動する。
---

# 🈯 translate-manga-ko-ja — 翻訳チェックの指揮者（orchestrator）

> **このスキルを起動した時点で、あなた（メインエージェント）は中立の orchestrator である。**
> あなたは訳さない・判定しない。**専門サブエージェント（`.claude/agents/translate-manga-ko-ja/`）を Task ツール（Grok Build では `task` / `spawn_subagent`、Codex では `spawn_agent`。識別子は `translate-manga-ko-ja-maker` / `translate-manga-ko-ja-judge`）で順に起動し、成果物を突き合わせて引き渡す指揮者**に徹する。
> 型（なぜ・何を・書式）の SSOT は rules（`.claude/rules/translate-manga-ko-ja/`）。**どの葉に何が書いてあるかは本 SKILL の関心ではない**——葉を読むのは、それを渡された agent である。
> maker / judge の人格（craft）は各 agent body が SSOT。本 SKILL は**どう回すか**だけを持ち、rules も agent body も複製しない（**参照は rules → skill の一方通行**）。

## 🔒 純粋関数的な契約（同じ入力 → 同じ出力構造）

副作用（ファイル出力）はあるが、**同じ入力に対して同じ出力を返す**ように以下を守る。

- **入力は `<作品>/master/` と `<作品>/episodes/<ep>/source/` だけ。** それ以外の隠れた状態に依存しない。
- **出力は `episodes/<ep>/review/` 配下の固定パス・固定フォーマットだけ**（`script.md` / `consistency.md` / `master-update.md`）。
- **master/ は読み取り専用。** 新規用語・キャラ・口調を見つけても本体を書き換えず、`review/master-update.md` に**差分提案**として出す（承認・反映は人間＝skill 外）。
- **確定済み用語（glossary）は機械的に踏襲**する（決定的）。訳文のゆらぎは、用語適用・信頼度フラグ規則・出力書式を固定して最小化する。
- **`final/` への昇格は行わない。** 人間がチェック・承認する領域に踏み込まない。

## 起動時に確定させる入力

- **作品フォルダ**（`master/` を持つルート）と**対象エピソード**（`episodes/<ep>/`）。不明なら1度だけユーザーに確認する（🙋 人間ゲート）。
- **原本**：`source/` の画像を優先して読む。OCRテキストがあれば補助に使う（両対応）。画像が不鮮明な箇所は捏造せず `⚠OCR` を付ける（＝maker の仕事）。

## 🧑‍⚖️ エージェント分離（作る主体 ≠ 判定する主体）

rules コア制約「成果物を作った主体と、判定する主体は別コンテキストにする」に従う。訳した本人が自己レビューすると、同じ思い込み（「通るはず」）を見逃し、批判が甘くなる。

| 役割 | 実体 | 担当 |
| --- | --- | --- |
| **orchestrator（中立）** | このスキルを起動したあなた（インライン） | 入力確定・起動・突き合わせ・引き渡し。**自分では訳さない・判定しない** |
| **maker（翻訳）** | [`agents/translate-manga-ko-ja/maker.md`](../../agents/translate-manga-ko-ja/maker.md) | Stage 1–4。master を共有した**1脳**で訳し、`script.md`・`master-update.md` を出す。**翻訳は分割しない** |
| **judge（独立レビュー）** | [`agents/translate-manga-ko-ja/judge.md`](../../agents/translate-manga-ko-ja/judge.md) | Stage 5。翻訳を作っていない**別サブエージェント**。反証（粗探し）で `consistency.md` を出す |

## 実行台本（orchestrator の回し方）

段階＝ファイル成果物。途中から再実行できる。**各エージェントの内部手順（craft）は agent body に委譲**し、ここでは起動と分岐だけを持つ。

1. **入力確定（インライン）。** 作品フォルダ・対象エピソード・原本の所在を固める。不明点は1度だけ人間へ（🙋）。
2. **maker を Task 起動（Stage 1–4）。** 入力（作品/エピソード/source/master のパス）を渡す。maker が作品理解のロード/ブートストラップ→翻訳→対訳シート→master 差分提案を通し、`review/script.md` と `review/master-update.md` を返す。詳細は [maker.md](../../agents/translate-manga-ko-ja/maker.md)。
3. **judge を Task 起動（Stage 5・別コンテキスト必須）。** 入力は `review/script.md`・`master/`・`source/` のパス**だけ**（maker の思考過程は渡さない）。judge が用語ブレ・口調矛盾・⚠漏れ・ブートストラップ不整合を摘発し `review/consistency.md` を返す。詳細は [judge.md](../../agents/translate-manga-ko-ja/judge.md)。
   - ※ 長い/重要な話数は、観点（ブレ／口調矛盾／過信）ごとに judge を分けて並行起動してよい（任意）。
4. **分岐。** judge が **objective なブレ（glossary 不一致）** を挙げたら maker に差し戻し、`script.md` を訂正・再フラグさせる。**解釈が割れるもの**は `⚠` のまま人間へ委ねる（黙って1つに丸めない）。
5. **引き渡し。** 3成果物を提示し、人間の仕事（下記）を明示する。

## 出力（すべて `episodes/<ep>/review/`）

| ファイル | 内容 | 作る主体 |
| --- | --- | --- |
| `script.md` | 対訳チェックシート（人間がここでチェック・修正する主戦場） | maker |
| `master-update.md` | master への更新提案（差分。人間承認後に反映） | maker |
| `consistency.md` | 一貫性・反証レビュー結果（ブレ・口調矛盾・フラグ漏れ） | judge |

## 引き渡し（何が済み・何が人間の仕事か）

- ✅ 済: 対訳シート生成・信頼度フラグ付与・**独立サブエージェント（judge）による**一貫性レビュー・master 更新提案（差分）
- ⏳ 人間: `⚠` 行の精読と `script.md` の修正 → `final/` へ確定、`master-update.md` の承認・反映
- **AI 出力は必ず人間チェックを通す前提。** skill は `final/` を書かず、master を書き換えない。

## ✅ 着手前チェックリスト

- [ ] 作品フォルダと対象エピソードを確定したか
- [ ] maker に master の有無を伝えたか（無ければ Stage 1 でブートストラップし draft 提案にさせる）
- [ ] 原本は画像優先・OCR補助、不鮮明箇所は `⚠OCR` にする方針を maker へ渡したか
- [ ] 一貫性レビューを**翻訳とは別のサブエージェント（judge）**で回したか（自己レビューにしていないか）
- [ ] objective なブレは maker に差し戻し、解釈割れは `⚠` のまま人間へ回したか
