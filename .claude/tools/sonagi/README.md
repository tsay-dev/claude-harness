# tools/sonagi — sonagi の機械オラクル

`sonagi` skill の L2/L3 を**決定的に組み立て**、成果物を**機械検査**する。
LLM に累積秒・合計尺・1対1の対応を計算させないためのもの。書式の SSOT は
[`rules/sonagi/schema.md`](../../rules/sonagi/schema.md)（閉じた語彙もそこが正）。

## 使い方

```bash
# script.md + assets/*.json → scenes.json / timeline.json
python3 .claude/tools/sonagi/sonagi.py build <channel>/videos/short/<id>

# 成果物を検査（ERROR があれば exit 1）
python3 .claude/tools/sonagi/sonagi.py check <channel>/videos/short/<id>

# 機械が読む形で
python3 .claude/tools/sonagi/sonagi.py check <path> --json

# 自分の担当分だけ（producer の自己検査）
python3 .claude/tools/sonagi/sonagi.py check <path> --stage script   # C1-C5
python3 .claude/tools/sonagi/sonagi.py check <path> --stage assets   # + C6-C9,C11,C12
python3 .claude/tools/sonagi/sonagi.py check <path> --stage thumb    # + C10
```

`--stage` があるのは、**まだ存在しない下流の成果物を「無い」と怒られずに自己検査するため**である。
台本を書いた直後に `--stage all` を叩けば素材が無いのは当然で、その ERROR は producer には直せない。

producer（各 agent）は**自分の成果物を出した直後に自分で `check` を叩く**。
オーケストレータの往復を待たずに直せるものは自分で直す。

`build` は ERROR がある間は何も書かない。壊れた入力から導出物を作ると、
どこが原因かが導出物側に散らばって追えなくなるため。

## 検査コード

| コード | 何を見るか |
| --- | --- |
| C1 | `script.md` の存在と frontmatter の必須キー |
| C2 | `scene_id` の連番・重複・欠番、表の形 |
| C3 | **尺の合計 == 宣言尺**（構造で守るべき制約の検算） |
| C4 | `char_budget == round(尺 × 話速)` |
| C5 | ナレーション長が文字予算に収まるか。**許容幅（±10%）はここが唯一の権威**で、rules も agent も数値を持たない |
| C6 | 台本の全シーンに素材ファイルがあるか／孤児の素材が残っていないか |
| C7 | 素材の必須キーと**閉じた語彙**（role / layout / transition / sfx） |
| C8 | 素材の `narration` が台本と一致（台本が正） |
| C9 | 素材の `duration_sec` が台本と一致 |
| C10 | `THUMB.json` の存在・語彙・時間軸を持たないこと |
| C11 | 画像プロンプトが英語かつ**サービス非依存**（`--ar` / `::` / 重み記法を弾く） |
| C12 | テロップ長（WARN）、caption が narration の写し（部分一致でも）、telop と caption の二重表示（WARN） |
| C13 | 生成済み `scenes.json` / `timeline.json` の整合（コマ数・順序・累積和・合計尺） |
| C14 | 全素材の `image.style` / `image.negative` が**同一文字列**か（並列生成が生む画風の割れ） |
| C15 | シーン境界の `transition_out` ⇄ 次の `transition_in` の一致 |
| C16 | `channel/style.md` が `image.<key>` として**宣言した**正規文字列に全素材が一致するか（宣言しないキーは自由） |

C14〜C16 は **1シーンだけ見ていては原理的に判定できない**もので、以前は judge が毎回手で見つけていた。
横断で機械的に決まるものを機械へ降ろし、judge の文脈は機械に見えないもの（比喩の重複・色の意味・根拠のない主張）に使わせる。

ERROR は必ず直す。WARN は判断が割れるので、`judge` と人間に委ねる。
