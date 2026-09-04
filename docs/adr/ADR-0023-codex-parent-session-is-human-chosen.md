---
id: ADR-0023
title: Codex の親セッションモデルは人間が選び、latest ピンは slice-reviewer だけに効く
status: accepted
date: 2026-09-04
---

# ADR-0023 Codex の親セッションモデルは人間が選び、latest ピンは slice-reviewer だけに効く

<!-- File name: docs/adr/ADR-0023-codex-parent-session-is-human-chosen.md (the prefix must equal id). One ADR, one decision. Never rewrite an accepted ADR — add a new one with supersedes: (R-802). Write the content in Japanese. -->

## Context

ADR-0022 はカスタム agent のカタログ ID を `models.json` にピンし、`latest_agents`（`slice-reviewer`）を `latest_model` に、それ以外を lite に分けた。あわせて「親セッション（orchestrator）も `latest_model` で始める」と切った。理由は TOML の `model` が無視される面で、レビュワーが親を継承するフォールバックだった。

運用はマスター（親）のモデルをユーザがセッション起動時に選ぶ。ハーネスが親を `latest_model` に固定すると、ユーザの指定と衝突する。latest の現行値は GPT-6 Astra（`gpt-6-astra`）。ADR-0022 の「JSON を書き換えて追従する」手順で slug は動かす。親を latest に縛る一条だけが、この運用と合わない。

## Decision

- **親セッションのモデルは人間が選ぶ。** skill は orchestrator に `latest_model` での起動を要求しない。
- **`latest_model` が効くのは `latest_agents` だけ**（いまは `slice-reviewer` の TOML `model`）。カタログ ID の SSOT は引き続き `models.json`（ADR-0022）。現行 latest は `gpt-6-astra`。
- ADR-0022 の射影・lite 配分・「カタログが動いたら JSON を更新する」は変えない。置き換えるのは「親も latest で始める」一条だけ。
- TOML ピンが無視される面では、レビュワーも親モデルになる。そのときは spawn の `model` 引数（出る面）か、人間が親を Astra にするかで拾う。黙って lite に落とさない、という完成ゲートの意図は ADR-0020 と同じだが、Codex ではファイルピンが限界である。

## Consequences

**得られるもの**

- マスターのモデル選択がユーザの手元に残る。レビュワーだけ Astra に寄せられる。
- slug 更新は `models.json` の `latest_model` 一行のまま。

**代償と今後の制約**

- 親が安く、かつ TOML `model` が無視される面では、`slice-reviewer` も安くなる。完成ゲートの品質は実行面に依存する。
- Astra がホストのカタログに無いと reviewer の spawn が失敗しうる（ADR-0022 と同じ更新義務）。

## 却下した選択肢

- **親も `latest_model` 必須のまま（ADR-0022）**: ユーザ指定と衝突する。退けた。
- **レビュワーも親 inherit に戻す**: 完成ゲートをセッション選択に全面依存させる。退けた。
- **`latest_agents` に orchestrator を足す**: 親は TOML を持たない。書けない。
