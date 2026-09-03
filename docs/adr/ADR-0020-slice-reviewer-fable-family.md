---
id: ADR-0020
title: slice-reviewer は Cursor 起動時に fable 系統を必須とする
status: accepted
date: 2026-09-03
---

# ADR-0020 slice-reviewer は Cursor 起動時に fable 系統を必須とする

## Context

`slice-reviewer` は Phase4 の完成ゲートである。定義の完了はテスト緑ではなく、独立した敵対検証の欠陥リストが空であることに置かれている。機械では反駁できない判定（SSOT 逸脱、分割クラスが入力空間を尽くすか、assertion が文の意味を見ているか）が本体であり、推論の劣化が次の二通りで下流を壊す。

- **偽の欠陥**: 無い不整合を不整合だと報告する。実装体がそれを直そうとして、動いていた実装を壊す。回路遮断（同一欠陥が 3 ラウンド残る）は「直したように見える偽陽性」を止めない。
- **偽の空リスト**: 欠陥を見逃して完成と宣言する。完成条件そのものが偽緑になる。

判断ゾーン全体は既に「劣化すると正しく間違った実装になる」と切って `opus` / 上位モデルを要求していた。しかし Cursor 射影は agent の `model:` を `inherit` に正規化するため、実モデルは orchestrator が Task 起動のたびに選ぶ。そこが「判断品質が最も落ちない候補」という弱い指示だと、親が Grok などのとき inherit や廉価モデルで reviewer が走り、上記の二通りが起きる。完成ゲートだけは、その緩さを残してはならない。

## Decision

- **Cursor**: `slice-reviewer` を起動するとき、inherit を禁じ、コスト節約のための廉価モデルも禁じる。その起動で Task の `model` 引数が提示する候補から、ランタイムが **fable** と呼ぶ系統（最強の推論 / thinking 候補）を選ぶ。同系統が複数あるときは最新を取る。その系統が候補に無いときは黙って落とさず、揃っていたモデルを人間に示して止まる（人間が代替を名指ししたときだけ従う）。
- **Claude Code**: agent frontmatter の `model: opus` は変えない。Cursor 固有の系統名を Claude Code の frontmatter に書くと、未解決の恐れがある。完成ゲートの強制は Cursor の起動時選択に置く。
- **slug はベタ書きしない**: `claude-fable-5-thinking-high` のようなバージョン付きカタログ ID は harness に置かない。`fable` は起動時の系統名であり、候補はその起動の Task 引数から取る。台本は develop skill §5。
- **Grok Build**: spawn API に per-launch model が無い制約は ADR-0008 のまま。この決定は Cursor の起動時選択にしか効かない。

## Consequences

- 完成ゲートの推論品質が、親セッションの既定やコスト最適化に引きずられなくなる。偽陽性 → 誤修正の連鎖と、空リストの偽緑を、少なくとも Cursor では構造として止められる。
- fable 系統が候補に無いランタイムでは `slice-reviewer` が止まって人間判断になる。完成が遅れる代償を、偽緑より先に取る。
- 判断ゾーンの他エージェント（`structure-oracle` など）は従来の「上位を選ぶ」のまま。同じ偽陽性の連鎖はそこにもあるが、完成条件そのものを偽緑にするのは `slice-reviewer` だけである。
- Grok Build では効かない。親モデルの品質に依存する（ADR-0008）。
- 系統名 `fable` はカタログの呼び方が変われば台本の更新が要る。バージョン ID をピン止めするよりは遅いが、ゼロではない。

## 却下した選択肢

- **agent frontmatter を `model: fable` にする**: Claude Code が解決できない恐れがある。Cursor 射影は `inherit` に正規化するため、frontmatter を変えても Cursor の実モデルは変わらない。起動時選択を動かさない限り目的を外す。
- **`claude-fable-5-thinking-high` を skill にベタ書きする**: ホストのカタログと予算を拘束し、世代が変わった瞬間に腐る。§0 と「slug をピン止めしない」に反する。
- **cursor-sync が slice-reviewer だけ `fable` を残す**: Cursor の agent frontmatter は起動時の `model` 引数ではない。射影に系統名を残しても orchestrator が inherit で起動すれば効かない。選択の SSOT は skill §5 である。
- **判断ゾーン全体を fable 必須にする**: 定義・契約・テスト設計まで同じコストを払う。偽陽性が完成条件を偽緑にする地点は `slice-reviewer` に限られる。コスト対効果の切りはそこ。
- **現状の「最も劣化しない候補を選ぶ」に任せる**: inherit や廉価モデルへの落下を止められない。今回直す対象そのものである。
