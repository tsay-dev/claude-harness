---
id: ADR-0022
title: Codex カスタム agent のモデル ID を models.json にピンし、カタログ更新のたびに harness を追従する
status: accepted
date: 2026-09-04
---

# ADR-0022 Codex カスタム agent のモデル ID を models.json にピンし、カタログ更新のたびに harness を追従する

<!-- File name: docs/adr/ADR-0022-codex-model-pins.md (the prefix must equal id). One ADR, one decision. Never rewrite an accepted ADR — add a new one with supersedes: (R-802). Write the content in Japanese. -->

## Context

ADR-0021 は Codex 射影から `model:` を落とし、子は親セッションを継承すると切った。理由は共有ハーネスがホストのカタログを縛らないこと（CLAUDE.md §0）、および `spawn_agent` が TOML の `model` を無視する面があること。

運用側は「カタログが動いたら harness も毎回更新する」を引き受け、カスタム agent ごとに公式どおり `model` / `model_reasoning_effort` を分けたい。マスター（orchestrator）と完成ゲートの `slice-reviewer` だけ最新、それ以外は廉価、という配分である。Cursor の fable 必須（ADR-0020）は Cursor にしか効かず、Codex 側に同等のレバーが無かった。

公式の `.codex/agents/*.toml` は `model` を持てる。ピンを 28 ファイルに散らすと更新が衝突する。`.claude/agents/*.md` に GPT slug を書くと Claude Code が解決できない。

## Decision

- ADR-0021 の射影先（skills → `.agents/skills/`、agents → `.codex/agents/<name>.toml`、rules は写さない）は変えない。**置き換えるのは「`model:` を落とす」一条だけ。**
- Codex のカタログ ID の SSOT は **`.claude/tools/codex-sync/models.json` 一ファイル**。生成器がこれを読んで TOML に `model` と `model_reasoning_effort` を書く。`.claude/agents/*.md` と skill 本文には slug を書かない（skill はマッピングのパスだけを知る）。
- 配分: `latest_agents`（いまは `slice-reviewer`）は `latest_model` + `latest_effort`。それ以外のカスタム agent は `lite_model` + `lite_effort`。orchestrator は親セッションなので TOML を持たない。人間が親を `latest_model` で始める。台本は develop skill §5。
- 現行ピン（2026-09-04）: latest = `gpt-5.6-sol` / high、lite = `gpt-5.6-luna` / medium。カタログが動いたら **この JSON を書き換え、`./init.sh codex` を再実行する**。それが追従手順である。
- `sandbox_mode` はまだ射影しない（tools: からの写像が損失的。read-only 規律は agent body）。
- TOML の `model` が実行面で無視される可能性は残る。そのときは親セッションのモデルが効くので、親を latest にしておくことがフォールバックになる。`spawn_agent` が `model` を出す面では、同じピンを引数でも渡す。

## Consequences

**得られるもの**

- Codex の公式カスタム agent 書式で、レビュワーとそれ以外をカタログ上の別モデルに分けられる。
- slug の更新箇所が 1 ファイルなので、「毎回 harness を更新する」運用と衝突しない。
- Claude Code / Cursor の agent markdown は `opus` / `inherit` のまま。GPT slug がそっちへ漏れない。

**代償と今後の制約**

- 共有ハーネスが Codex ホストのカタログを縛る。`gpt-5.6-luna` が無い面ではその agent の spawn が失敗しうる。引き受けた更新義務が履行されないと、全員が死んだ slug を指す。
- 判断ゾーンの producer（UC / REQ / DB など）は lite に落ちる。機械が反駁できない成果物の劣化は、完成ゲートの `slice-reviewer` が最新であることだけでは埋まらない。
- TOML ピンを実行が無視する面では、配分は親 inherit に落ち、lite 指定は効かない。
- orchestrator のモデルはファイルでは強制できない。親を latest にし忘れると、マスターもフォールバックも最新にならない。

## 却下した選択肢

- **ADR-0021 のまま `model` を落とす**: カタログ追従を引き受けるなら、公式の per-agent `model` を使わない理由が消える。退けた。
- **`.claude/agents/*.md` の `model:` に GPT slug を書く**: Claude Code が解決できず、Cursor 射影の `inherit` 正規化とも衝突する。退けた。
- **28 個の TOML を手でメンテする**: 生成物を手編集することになり、次の `init.sh codex` で消える。退けた。
- **判断ゾーン全体を latest にする**: 依頼はマスターとレビュワーだけ最新。コスト配分を広げるのは別判断。`latest_agents` 配列で後から足せる。
- **`sandbox_mode` も同時にピンする**: tools: からの写像が Read+Bash の oracle を誤って閉じる。この決定の範囲外。
