---
id: ADR-0021
title: Codex 向けに skills を .agents/skills へ、agents を .codex/agents/*.toml へ射影する
status: accepted
date: 2026-09-04
---

# ADR-0021 Codex 向けに skills を .agents/skills へ、agents を .codex/agents/*.toml へ射影する

<!-- File name: docs/adr/ADR-0021-codex-skills-agents-projection.md (the prefix must equal id). One ADR, one decision. Never rewrite an accepted ADR — add a supersedes: (R-802). Write the content in Japanese. -->

## Context

Cursor 併用は 3木を `.cursor/` へ写し（cursor-sync）、Grok Build は agent だけを `.grok/agents/` へ flatten する（ADR-0008）。OpenAI Codex（`codex` CLI / IDE）は探索の形がどちらとも違う。

- **skills** はリポジトリの `.agents/skills/<name>/SKILL.md` を読む。`.claude/skills/` は見ない。
- **agents** は `.codex/agents/*.toml`（直下）で、必須キーは `name` / `description` / `developer_instructions`。手続きキーでネストした `agents/develop/foo.md` は乗らない。Markdown frontmatter も読まない。
- **rules** に `paths:` ゲート相当は無い。葉を AGENTS.md や常駐ファイルへ写すと常駐ゼロを壊す。
- **AGENTS.md** はセッション開始時に常駐ロードされる。ルーター用の巨大ファイルをホストへ設置すると、Claude Code 側で禁じた CLAUDE.md ルーターと同じ失敗になる。
- `spawn_agent` のスキーマはモデル世代で揺れる（`agent_type` がある面と、`task_name` / `message` / `fork_turns` だけの面）。GPT slug を harness に書くとホストのカタログを縛る（CLAUDE.md §0）。

このリポジトリに置かれていた手書きの `AGENTS.md`（SSOT を `.Codex/` に置き換えた CLAUDE.md の複製）と `.agents/skills/`（パスを `.Codex/` に書き換えた skill 複製）は、実体の無い木を指し、知識を二重化していた。

## Decision

- `.claude/` を SSOT のまま、**skills と agents だけ**を Codex ネイティブの場所へ機械射影する（`codex-sync` / `./init.sh codex`）。
- **skills** は `.agents/skills/<name>/SKILL.md` へ複製する。本文の `.claude/` パスは書き換えない（tools / rules / templates / agent markdown の住所は SSOT 側）。`disable-model-invocation: true` の skill は `agents/openai.yaml` に `allow_implicit_invocation: false` を足す。
- **agents** は frontmatter `name:` で flatten し `.codex/agents/<name>.toml` へ出す。`model:` と `tools:` は落とす。子は親を継承する。slug はベタ書きしない。read-only の規律は agent body。
- **rules は写さない。** 遅延ロードは develop skill §6 がパスで渡す既存の経路に任せる。
- **ホストへルーター用 AGENTS.md は置かない。** 案件固有の事実（platform / 検証コマンド）はホストが自分の `AGENTS.md` に書く（Claude Code / Cursor のホスト `CLAUDE.md` と同じ分担）。このリポジトリ自身の `AGENTS.md` は CLAUDE.md への入口だけを持ち、本文を複製しない。
- 生成物に `GENERATED` マーカを刻む。編集は `.claude/` 側だけ。手書きの同名 `.toml` は上書きしない。
- orchestrator の起動台本は develop skill §5。`spawn_agent` に `agent_type`（または同等のセレクタ）があれば `name:` を渡す。`task_name` / `message` だけの面では `name` を `task_name` にし、スキーマが許すなら `fork_turns: none` を付ける（フル履歴 fork は親ロールを継承してカスタム人格が落ちる）。

## Consequences

**得られるもの**

- Codex が `/develop` 等の skill を発見でき、`domain-definer` 等をカスタム agent として載せられる。
- Cursor / Grok と同じ「SSOT は `.claude/`、生成物は触らない」運用を、写す範囲だけ変えて再利用できる。
- 常駐ゼロは rules を写さないことで保つ。AGENTS.md をルーターにしない。

**代償と今後の制約**

- Codex には paths ゲートが無い。rules の自動注入は起きず、orchestrator がパスで渡す・producer が Read する。Grok（ADR-0008）と同じ落ち方。
- `spawn_agent` がカスタム agent を名指しできない面では、`task_name` と message への読み替えに依存し、機械では強制できない。要 Codex 実機確認。
- 判断ゾーンのモデルを Task 起動のたびに選べない（TOML から `model:` を落としている）。品質は親セッションのモデルに従う。`slice-reviewer` の fable 必須（ADR-0020）は Cursor にしか効かない。
- `.agents/` と `.codex/agents/` は生成スナップショットなので、`.claude` を submodule/symlink で更新しても自動追従しない。harness を update したら `init.sh codex` を再実行する。

## 却下した選択肢

- **`.claude/` をやめて `.Codex/` を SSOT にする（手書き AGENTS.md がやっていたこと）**: Cursor / Grok / Claude Code の配線を壊し、存在しない木を skill が指す。退けた。
- **CLAUDE.md を AGENTS.md に全文複製する**: 作業ガイドが二重化し、常駐トークンを増やす。入口ファイルが CLAUDE.md を Read する。退けた。
- **3木すべてを `.codex/` や `.agents/` へ複製する**: rules の全文常駐は常駐ゼロを壊す。退けた。
- **agent を Markdown のまま `.codex/agents/` に置く**: Codex は TOML の 3 キーを要求する。形式を無視したコピーは乗らない。退けた。
- **ネストを崩して `.claude/agents/*.md` に flatten する**: Claude Code / Cursor の3木を壊し、SSOT をランタイム都合で歪める。ADR-0008 と同じ理由で退けた。
- **`model:` に GPT slug を書く**: ホストのカタログと予算を共有ハーネスが縛る（§0）。退けた。
- **install がホストに AGENTS.md を置く**: ルーター復活。案件固有の事実はホストの責任。退けた。
