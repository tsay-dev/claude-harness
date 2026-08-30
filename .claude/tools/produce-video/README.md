# tools/produce-video — produce-video の機械オラクル

`produce-video` skill の L2/L3 を**決定的に組み立て**、成果物を**機械検査**する。
LLM に累積秒・合計尺・1対1の対応を計算させないためのもの。書式の SSOT は
[`rules/produce-video/schema.md`](../../rules/produce-video/schema.md)（閉じた語彙もそこが正）。

## 使い方

```bash
# script.md + assets/*.json → scenes.json / timeline.json
python3 .claude/tools/produce-video/produce-video.py build <channel>/videos/short/<id>

# 成果物を検査（ERROR があれば exit 1）
python3 .claude/tools/produce-video/produce-video.py check <channel>/videos/short/<id>

# 機械が読む形で
python3 .claude/tools/produce-video/produce-video.py check <path> --json

# 使う TTS で話速を実測する（channel/voice.md に入れる数値を決める）
python3 .claude/tools/produce-video/produce-video.py calibrate <path> --audio <音声を置いたディレクトリ>
python3 .claude/tools/produce-video/produce-video.py calibrate <path> --measure SC-01=5.4 SC-05=8.2

# 自分の担当分だけ（producer の自己検査）
python3 .claude/tools/produce-video/produce-video.py check <path> --stage script   # C1-C5
python3 .claude/tools/produce-video/produce-video.py check <path> --stage assets   # + C6-C9,C11,C12
python3 .claude/tools/produce-video/produce-video.py check <path> --stage thumb    # + C10
```

`--stage` があるのは、**まだ存在しない下流の成果物を「無い」と怒られずに自己検査するため**である。
台本を書いた直後に `--stage all` を叩けば素材が無いのは当然で、その ERROR は producer には直せない。

producer（各 agent）は**自分の成果物を出した直後に自分で `check` を叩く**。
オーケストレータの往復を待たずに直せるものは自分で直す。

`build` は ERROR がある間は何も書かない。壊れた入力から導出物を作ると、
どこが原因かが導出物側に散らばって追えなくなるため。

## 検査コード

## `calibrate` — 話速を推測で置かない

尺予算の全計算は `channel/voice.md` の**話速（文字/秒）1つ**に乗っている。
ここを推測のまま回すと、「60秒」のつもりの動画が実測で何秒になるか誰も知らないまま進む。

`<音声ディレクトリ>/SC-01.mp3` のようにシーンIDで音声を置けば ffprobe が秒数を読み、
台本のナレーション文字数と突き合わせて実測話速を出す。ffprobe が無い環境では `--measure` で手渡しできる。

**台本1本ぶんを全部測る。** 少数の標本ではばらつきの推定が当てにならない——
同じ声・同じモデルで、4件だと変動係数 11.2%（WARN）、9件だと 8.4%（閾値内）になった実例がある。
6件未満のときは変動係数の判定を出さない。

**尺の保証は動画全体に対するもので、1コマごとではない。** 実測ではシーン単位で RMS 0.5 秒
（最大 0.9 秒）ずれるが、過不足が打ち消し合うので合計は精度が高い（指定 60 秒に対し実測 60.3 秒）。
コマ単位の絵の切り替えを秒単位で詰めたいなら、そこは実音声を見て詰める。

句読点による間を別項にした2変数モデル（`読字数/話速 + 句読点数×間`）も試したが、
RMS 誤差は 0.49→0.47 秒でほぼ改善しない。**1変数モデルのままでよい**（スキーマを複雑にする価値がない）。

**話速は「TTS × 声 × モデル」ごとの性質**であって、チャンネルの性質ではない。どれか替えたら測り直す。
実測では、同じ声・同じ文でもモデルを替えるだけで尺が 24% 変わった。

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
| C17 | 台本が参照する `F-nnn` が `research.md` に実在するか。未参照の事実は WARN |
| C18 | カメラの角度が1種類に偏っていないか（WARN。**味気なさの検出**） |

**面白さは機械に作れないが、「同じものの繰り返し」は撃てる。** C18 はそれで、
実運用で judge が「9コマ中8コマが同じ構図」と手で数えた指摘を機械に降ろしたものである。
良いものを作れとは言えないが、同じ撮り方を9回続けるなとは言える。

最初は `composition` の語の重複で測ろうとしたが、**それでは拾えない**——
言い回しは各シーンで違うので、全部が俯瞰でも語の一致度は 0.35 程度にしかならない。
実際に効くのは**画の撮り方**であり、カメラアングルは実質的に閉じた語彙なので、そこを直接数える。

C14〜C16 は **1シーンだけ見ていては原理的に判定できない**もので、以前は judge が毎回手で見つけていた。
横断で機械的に決まるものを機械へ降ろし、judge の文脈は機械に見えないもの（比喩の重複・色の意味・根拠のない主張）に使わせる。

ERROR は必ず直す。WARN は判断が割れるので、`judge` と人間に委ねる。
