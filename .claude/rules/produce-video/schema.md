---
paths:
  - "**/videos/**"
---

# 📦 成果物のスキーマと閉じた語彙

> `videos/<format>/<id>/` 配下の各ファイルの厳格な形を定める。
> なぜ層で切るかは [overview.md](overview.md)。ショートの数値方針は [short/direction.md](short/direction.md)。

## 🔒 閉じた語彙（列挙外の値はエラー）

自由記述にすると同じ意味の語が回ごとにブレ、機械検査もレンダラも乗らない。**下記以外を書いてはならない。**
表現したいニュアンスが列挙になければ、**最も近い値を選び**、意図は `note` に書く（`note` は人間が読む欄で、機械は解釈しない）。

| キー | 取りうる値 |
| --- | --- |
| `role`（シーンの役割） | `hook` / `setup` / `body` / `turn` / `cta` |
| `layout` | `full-bleed` / `split` / `caption-over` / `title-card` / `side-by-side` |
| `transition_in` / `transition_out` | `cut` / `fade` / `slide` / `zoom` / `whip` |
| `sfx` | `none` / `whoosh` / `pop` / `ding` / `impact` / `swell` |
| `bgm.mood` | `upbeat` / `calm` / `tense` / `warm` / `neutral` |

## `brief.yaml`（L0 入力・人間が書く）

```yaml
title: <仮題>
format: short
duration_sec: 60
audience: <誰に向けるか>
goal: <視聴者に何を持ち帰らせるか（1文）>
points:                 # 台本に載せてよい事実。ここに無いことは書けない
  - <要点>
sources: []             # optional。出典
```

## `script.md`（L0 台本・script-writer が書く）

**表形式で書く。** 1行＝1シーンであり、この行数がそのまま `scenes.json` のコマ数になる（1対1）。
散文で書くと行とコマの対応が機械的に取れず、部分再実行も検算も成立しない。

```markdown
---
video_id: <id>
format: short
duration_sec: 60
speech_rate: 6.5        # channel/voice.md 由来。文字/秒
---

# <仮題>

| scene_id | role | duration_sec | char_budget | narration | facts |
| --- | --- | --- | --- | --- | --- |
| SC-01 | hook | 5 | 32 | ナレーション原稿 | F-01 |
| SC-02 | setup | 8 | 52 | ... | |
```

`facts` 列は **`research.md` を使ったときだけ**必要になる（調査工程を回さないなら省略してよい）。
事実を述べているシーンが空欄なら、それは出典の無い断定である。書式は [research-format.md](research-format.md)。

- `scene_id` は `SC-01` から連番。欠番・重複を作らない。
- `char_budget` = `round(duration_sec * speech_rate)`。**`duration_sec` の合計は frontmatter の `duration_sec` に一致させる。**
  これは検算で拾う性質ではなく、**書く時点で満たす制約**である（[short/direction.md](short/direction.md) の尺予算）。
- `narration` は `char_budget` に収める。**許容幅の数値は機械検査 C5 が唯一の権威**であり、ここでは持たない
  （[`tools/produce-video/README.md`](../../tools/produce-video/README.md)）。2箇所に数値を書くと必ずずれ、その隙間に落ちた超過を誰も検出できなくなる。
- `narration` は**読み上げたい通りの表記**で書く（下記）。

### ナレーションの表記（TTS 非依存で読みを固定する）

サービス非依存の平文で出すので、SSML やルビで読みを指定できない。**表記そのもので読みを決める。**

- 数字は読み上げどおりに：`3割` → `さんわり`、`2024年` → `にせんにじゅうよねん`、`1/3` → `さんぶんのいち`
- 英字・略語はカナに：`AI` → `エーアイ`、`API` → `エーピーアイ`
- 読みが割れる漢字はひらく：`人気(にんき/ひとけ)` → `にんき`、`市場(しじょう/いちば)` → `しじょう`
- 記号は使わない：`〜` `※` `()` は読まれ方が不定なので、語に置き換えるか落とす

## `assets/SC-nn.json`（L1 素材・asset-generator が書く／1シーン1ファイル）

```json
{
  "scene_id": "SC-01",
  "role": "hook",
  "duration_sec": 5,
  "narration": "読み上げどおりの表記の日本語",
  "caption": "画面に出す1メッセージ",
  "telop": "3語以内",
  "image": {
    "subject": "what is depicted",
    "composition": "framing / camera angle",
    "lighting": "light quality",
    "style": "art style, from channel/style.md",
    "aspect": "9:16",
    "negative": "what must not appear"
  },
  "sfx": "whoosh",
  "layout": "full-bleed",
  "transition_in": "cut",
  "transition_out": "fade",
  "note": ""
}
```

- `narration` は `script.md` の当該行と**一致させる**（台本が正。ここで書き換えない）。
- `image.*` は**英語**で書く。どの画像生成サービスにも貼れる中立な構造化記述にするため、
  特定サービスの重み付け記法（`::`、`--ar`、`(word:1.2)` など）は**使わない**。`aspect` は文字列で持つ。
- `image.style` と `image.negative` は **`channel/style.md` のコードブロックを1文字も変えずにコピーする**。
  言い換えるな・足すな・削るな。並列に走る producer が各自で英訳・アレンジすると画風が割れ、
  本人には自分の1シーンしか見えないので誰も気づかない（機械検査 C14 / C16 がこの一致を見る）。
- `transition_out` は**次のシーンの `transition_in` と一致させる**。境界の演出は2シーンが共有する1つの事象であり、
  片側だけ変えると繋ぎ目が破綻する（機械検査 C15）。

## `assets/THUMB.json`（L1 サムネ・publisher が書く）

時間軸を持たないので `duration_sec` / `transition_*` / `sfx` を持たない。

```json
{
  "scene_id": "THUMB",
  "telop": "3語以内",
  "image": { "subject": "...", "composition": "...", "lighting": "...", "style": "...", "aspect": "9:16", "negative": "..." },
  "layout": "title-card",
  "note": ""
}
```

## `scenes.json` / `timeline.json`（L2・L3 導出物）

**手で書かない。`tools/produce-video build` が `script.md` と `assets/*.json` から決定的に生成する。**
`start_sec` は尺の累積和、`assets` は素材IDの解決結果であり、人間や LLM が計算する価値がない。

```json
{
  "video_id": "<id>", "format": "short",
  "resolution": "1080x1920", "fps": 30, "aspect": "9:16",
  "scenes": [
    { "scene_id": "SC-01", "role": "hook", "start_sec": 0, "duration_sec": 5,
      "assets": ["SC-01.narration", "SC-01.caption", "SC-01.telop", "SC-01.image", "SC-01.sfx"],
      "layout": "full-bleed", "transition_in": "cut", "transition_out": "fade" }
  ],
  "thumbnail": { "assets": ["THUMB.telop", "THUMB.image"], "layout": "title-card" }
}
```

```json
{
  "video_id": "<id>", "total_duration_sec": 60,
  "resolution": "1080x1920", "fps": 30, "aspect": "9:16",
  "scene_order": ["SC-01", "SC-02"],
  "bgm": { "mood": "upbeat", "start_sec": 0, "duration_sec": 60, "duck_under_narration": true }
}
```

## `publish.md`（L4・publisher が書く）

```markdown
---
video_id: <id>
---

## タイトル案
1. <案1>
2. <案2>
3. <案3>

## 説明文
<本文>

## タグ
`tag1` `tag2` `tag3`

## チャプター
- 00:00 <見出し>
```

## `channel-draft.md`（`channel/` が無いときのブートストラップ草案）

`channel/` が存在しないときだけ書く。**`channel/` 本体は作らない**（承認して配置するのは人間）。
`review.md` とは別ファイルにする——`review.md` は judge が後段で書く場所であり、
同じファイルに出すと**承認前の草案が反証レビューに上書きされる**。

```markdown
## channel/identity.md（草案）
<提案する内容>

## channel/voice.md（草案）
<提案する内容>

## channel/style.md（草案）
<提案する内容。image.style / image.negative は正規文字列のコードブロックで出す>

## channel/history.md（草案）
<提案する内容>

## ⚠ 人間に確認したいこと
- <推測で埋めた箇所と、その根拠の無さ>
```

## `review.md`（judge が書く）

指摘は**根拠と場所を必ず持たせる**。曖昧な感想は人間の確認コストを増やすだけで価値がない。

```markdown
## 差し戻し（objective・機械的に正誤が決まる）
- [ ] SC-03 `caption` — channel/identity.md の禁止表現「絶対」を使用

## ⚠ 人間判断（解釈が割れる）
- SC-05 と SC-07 が同じ比喩を使っている。どちらを残すか

## channel/ への差分提案
- voice.md: 語尾「〜んですよ」が全編で多用されている。口調表に追記するか要検討
```
