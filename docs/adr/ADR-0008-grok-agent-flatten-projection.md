---
id: ADR-0008
title: Grok Build 向けに agent だけを name: で flatten して .grok/agents へ射影する
status: accepted
date: 2026-08-26
---

# ADR-0008 Grok Build 向けに agent だけを name: で flatten して .grok/agents へ射影する

<!-- File name: docs/adr/ADR-0008-grok-agent-flatten-projection.md (the prefix must equal id). One ADR, one decision. Never rewrite an accepted ADR — add a new one with supersedes: (R-802). Write the content in Japanese. -->

## Context

Cursor 併用は `.claude/` を SSOT にした機械射影（`cursor-sync` → `.cursor/`）で、3木すべてを写す。Grok Build（`grok` CLI）は Claude Code 互換を謳うが、探索の形が違う。

- **skills** は `.claude/skills/<name>/SKILL.md` をそのまま読む（この harness の1階層と一致する）。
- **agents** は `.claude/agents/*.md` と `.grok/agents/*.md` の直下だけを見る。手続きキーでネストした `agents/develop/foo.md` はカタログに乗らない。
- **rules** は `.claude/rules/` の `*.md` を全文ロードする。`paths:` ゲートが無い。

ハーネスの agent `name:` は木全体で一意である。Grok の spawn API（`task` / `spawn_subagent`）は `subagent_type` にその名前を取り、起動時の model 引数を持たない。`model: opus` は Grok で解決できない。

## Decision

- `.claude/` を SSOT のまま、**agent だけ**を `.grok/agents/<name>.md` へ機械射影する（`grok-sync` / `./init.sh grok`）。出力ファイル名は frontmatter の `name:`。`model:` 行は削除し、子は親モデルを継承する。
- **skills は写さない。** Grok が `.claude/skills/` を直接読むので、複製は二重登録になる。
- **rules は写さない。** 全文ロードされる射影は常駐ゼロを壊す。遅延ロードに近づけたいホストは、ユーザ設定で Claude rules スキャンを切る（プロジェクトの `.grok/config.toml` には compat が載らない）。
- 生成物に `GENERATED` マーカを刻み、手書きの同名ファイルは上書きしない。編集は `.claude/` 側だけ。
- slug（`grok-4.6` 等）は harness にベタ書きしない。orchestrator の台本は develop skill §5。

## Consequences

**得られるもの**

- Grok Build が `domain-definer` 等を subagent 型として発見できる。skills の `/develop` はそのまま使える。
- Cursor 射影と同じ「SSOT は `.claude/`、生成物は触らない」運用を、写す範囲だけ変えて再利用できる。

**代償と今後の制約**

- skill 本文の Task / `AskUserQuestion` は Claude/Cursor 前提のまま。Grok 側は `spawn_subagent` への読み替えに依存し、機械では強制できない。
- 判断ゾーンのモデルを Task 起動のたびに選べない（spawn に model 引数が無い）。品質は親セッションのモデルに従う。
- `.claude/rules/` の全文ロードは射影では止まらない。常駐ゼロは Grok では skills の on-demand と、ユーザが rules スキャンを切る選択に落ちる。
- agent の `name:` 衝突は生成が失敗する。一意であることは今の木の事実であり、検査は `grok-sync` が担う。

## 却下した選択肢

- **Cursor と同じく 3木をすべて `.grok/` へ複製する**: skills は二重登録になり、rules は常駐ゼロを壊す。探索の差分を無視したコピーになる。退けた。
- **ネストを崩して `.claude/agents/*.md` に flatten する**: Claude Code / Cursor の3木（キー名で揃える）を壊し、SSOT をランタイム都合で歪める。退けた。
- **`.grok/agents/` にネストを保ったまま複製する**: Grok は直下しか見ないので、射影しても乗らない。退けた。
- **`model: inherit` を残す（Cursor と同じ正規化）**: Grok が `inherit` をモデル ID として解決しようとする恐れがある。行ごと削除して親継承にする方が spawn API に合う。退けた。
- **プロジェクトの `.grok/config.toml` で `[compat.claude] rules = false` を生成する**: プロジェクト config は MCP / plugins / permissions 以外を読まない。効かない設定を生成物に置くことになる。退けた。
