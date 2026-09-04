---
name: produce-video
description: 企画から動画の制作定義一式（台本・素材プロンプト・コマ定義・タイムライン・公開パッケージ・多言語素材）を生成する。このスキルを起動したメインエージェントは中立の orchestrator として振る舞い、自分では書かず・判定せず、.claude/agents/produce-video の researcher / fact-checker / script-writer / asset-generator / publisher / localizer / judge を起動する。事実が中身のテーマでは出典付きで調べ、集めた本人でない検証者が出典を開き直す。多言語（brief.yaml の languages:）ではマスターのタイムラインを固定し、言語ごとの訳を独立レビュアーが突き合わせる。画像・音声・動画の実体は生成せず、出力はプロンプトと定義まで（channel/ は読み取りのみ・更新は差分提案）。「ショート動画を作りたい」「動画の台本を書いて」「YouTube ショート／TikTok／Reels の企画を形にしたい」「解説動画の構成を作って」「サムネとタイトルを考えて」「動画を多言語で出したい」「翻訳ナレーションを作って」ときは必ずこのスキルを使う。動画・台本・シーン・ナレーション・テロップ・サムネ・タイムライン・多言語化のいずれかが話題に出たら、明示的に「スキルを使って」と言われなくても起動を検討する。
---

# 🎬 produce-video — 動画制作定義の指揮者（orchestrator）

> **このスキルを起動した時点で、あなた（メインエージェント）は中立の orchestrator である。**
> あなたは書かない・判定しない。**専門サブエージェント（`.claude/agents/produce-video/`）を Task ツール（Grok Build では `task` / `spawn_subagent`、Codex では `spawn_agent`。識別子は `produce-video-script-writer` / `produce-video-asset-generator` / `produce-video-publisher` / `produce-video-localizer` / `produce-video-localization-judge` / `produce-video-judge`）で起動し、成果物を突き合わせて引き渡す指揮者**に徹する。
> 型（なぜ・何を・書式）の SSOT は rules（`.claude/rules/produce-video/`）。**どの葉に何が書いてあるかは本 SKILL の関心ではない**——葉を読むのは、それを渡された agent である。
> 各 agent の craft（構成・言い回し・画作り）は agent body が SSOT。本 SKILL は**どう回すか**だけを持ち、rules も agent body も複製しない（**参照は rules → skill の一方通行**）。

## 🔒 このスキルが踏み越えない線

- **画像生成・TTS・レンダリングを実行しない。** 出すのは**プロンプトと定義だけ**。
  実体化は [`render-media`](../render-media/SKILL.md) の仕事で、**別のスキルである**——
  企画は純粋関数にできるが生成はできない（外部サービス・課金・非決定性）。
  混ぜると企画側まで再現しなくなる。
- **調べるのは researcher 1体だけ。** 台本より下流の工程は誰も調べない。事実は `research.md` か
  `brief.yaml` の `points:` にあるものだけで、埋まらない箇所は `⚠要確認` で人間へ返す。
  調査を回さない回もある（事実が中身でないテーマ）。
- **`channel/` を書き換えない。** 更新は `review.md` の差分提案として出し、承認・反映は人間。
- **オーケストレータは生成しない。** 台本も素材も公開情報もサブエージェントが書く。あなたはスクリプトを叩き、分岐する。

## 起動時に確定させる入力

- **チャンネルのルート**（`channel/` を持つディレクトリ）と**対象動画**（`videos/<format>/<id>/`）
- **`brief.yaml`**（テーマ・尺・ターゲット・`points:`）。無ければ**1度だけ**ユーザーに聞いて作る（🙋 人間ゲート）
- `channel/` が無ければ**ブートストラップ**：`videos/<format>/<id>/channel-draft.md` に `channel/` の草案を提案として出し、
  **承認されるまで先へ進まない**。推測のまま走ると、以降の全ての回がその推測を踏襲する。
  草案は `review.md` に書かない（そこは judge が後段で書く場所で、草案が上書きされる）

## 🧑‍⚖️ エージェント分離（作る主体 ≠ 判定する主体）

`asset-generator` はシーン単位で並列に走り、互いを見ない。**口調・用語・言い回しのブレは構造として必ず起きる**。
書いた本人には見えないので、素材を1つも書いていない `judge` が横断して撃つ。

| 役割 | 実体 | 担当 |
| --- | --- | --- |
| **orchestrator（中立）** | このスキルを起動したあなた（インライン） | 入力確定・起動・スクリプト実行・分岐・引き渡し。**自分では書かない・判定しない** |
| **researcher** | [`agents/produce-video/researcher.md`](../../agents/produce-video/researcher.md) | 出典付きの事実収集。**外部を調べる唯一の主体** |
| **fact-checker** | [`agents/produce-video/fact-checker.md`](../../agents/produce-video/fact-checker.md) | 出典を開き直す反証。**事実を集めていない別コンテキスト必須** |
| **comedian** | [`agents/produce-video/comedian.md`](../../agents/produce-video/comedian.md) | 構成案を3つ。**面白さを作る唯一の主体**。選ぶのは人間 |
| **script-writer** | [`agents/produce-video/script-writer.md`](../../agents/produce-video/script-writer.md) | L0 台本＋尺予算の配分 |
| **asset-generator** | [`agents/produce-video/asset-generator.md`](../../agents/produce-video/asset-generator.md) | L1 素材。**シーン単位で並列**、1体1ファイル |
| **publisher** | [`agents/produce-video/publisher.md`](../../agents/produce-video/publisher.md) | L4 公開パッケージ＋サムネ定義 |
| **judge** | [`agents/produce-video/judge.md`](../../agents/produce-video/judge.md) | L1 横断の反証。**素材を書いていない別コンテキスト必須** |
| **localizer** | [`agents/produce-video/localizer.md`](../../agents/produce-video/localizer.md) | 多言語素材（`i18n/<lang>.json`）。**1言語1体**で並列、言語内は1脳で訳し切る |
| **localization-judge** | [`agents/produce-video/localization-judge.md`](../../agents/produce-video/localization-judge.md) | 訳の反証（誤訳・確度の変質・用語ブレ）。**翻訳を書いていない別コンテキスト必須** |

L2/L3 は**エージェントではなくスクリプト**が作る（`tools/produce-video`）。累積秒・合計尺・1対1の対応は**LLM に計算させない**。

## ⚠ 起動前に必ず確認すること（ホストが submodule で harness を使っている場合）

**エージェントが読む agent body と rules は、ホストの `.claude` が指す版である。**
harness 側を直して push しても、**ホストの submodule を更新しなければエージェントには届かない**。

これは実際に2回起きた。規則を足して「今回はこれで直る」と説明したまま、
古い版を読んだエージェントを走らせている。エージェントは正直に
「その節は見当たりません」と報告したが、こちらが気づくまで気づかなかった。

**Task を起動する前に、渡す規則が実際にホストから見えるかを確認する:**

```bash
git -C <host> submodule status                 # どの版を指しているか
grep -c "<足したはずの見出し>" <host>/.claude/agents/produce-video/<agent>.md
```

見えなければ、先に更新する:

```bash
git -C <host>/.claude-harness fetch --tags && git -C <host>/.claude-harness checkout <tag>
```

**「直したつもり」で走らせた実行は、結果を信用できない。** 何が効いて何が効かなかったかが分からなくなる。

## 実行台本（orchestrator の回し方）

段階＝ファイル成果物。**成果物が在れば済み、無ければ未了**であり、途中から再実行できる。進捗台帳は持たない。

1. **入力確定（インライン）。** チャンネルのルート・対象動画・`brief.yaml` を固める。不明点は1度だけ人間へ（🙋）。

2. **調査（動画の中身が事実であるときだけ）。** `research.md` が既に在るなら飛ばす。
   1. **researcher を Task 起動。** テーマと `brief.yaml` のパスを渡し、出典付きの `research.md` を返させる。
      **`brief.yaml` を渡すのは、調査を打ち切ってよい必要量が尺から導かれるためである**
      （導き方は researcher が受け取る rules が持つ）。渡さないと止め時が回ごとにブレる。
   2. **fact-checker を Task 起動（別コンテキスト必須）。** 渡すのは `research.md` / `brief.yaml` /
      `channel/identity.md` の**パスだけ**。出典を開き直した結果 `research-review.md` が返る。
   **落とされた事実・格下げされた確度は、この後の全工程で効く。** 台本の前に検証を置くのは、
   落ちた事実の上に台本を建てさせないためである。

3. **構成（事実から形を決める）。** `angle.md` が `status: chosen` で既に在るなら飛ばす。
   1. **comedian を Task 起動。** `research.md` / `research-review.md` / `brief.yaml` / `channel/` を渡し、
      構造的に違う構成案を3つ出させる（題材が弱ければ「この回はやめる」も）。
   2. **🙋 人間ゲート①（選ぶ）。** 3案を提示し、**選ぶ・混ぜる・却下して出し直させる**。
      承認は `angle.md` の `status: chosen` と `chosen:` で表される。**書き込むのは人間である。**
   **ここが面白さを決める唯一の地点である。** 飛ばすと、動画は調べた出典を順番に並べたものになる。

4. **script-writer を Task 起動。** `brief.yaml` / `channel/identity.md` / `channel/voice.md` と、
   在れば `research.md` / `research-review.md` / `angle.md` のパスを渡す。
   `script.md` が返る。**`script.md` が既に在るなら、この段は飛ばす**（人間が持ち込んだ台本をそのまま使う）。

5. **🙋 人間ゲート②（確かめる）。** `script.md` と `⚠要確認` を提示し、**承認を待つ**。
   設計はゲート①で決まっているので、ここは**選ばれた形どおりに書けているかの確認**であり、速い。
   調査を回したなら `research.md` と `research-review.md` も**同じゲートで一緒に見せる**
   （事実の採否と台本の可否は、切り離して判断できない）。
   researcher が**目標本数に届かないまま返してきたなら、それもここで明示する**。
   足りないことを理由に調査を回し直さない——**再調査は人間が決める**（勝手に回すと、
   本数を満たすために確度が緩む方向へ引っ張られる）。
   台本は全素材の唯一の源泉であり、ここが外れていると L1〜L4 が丸ごと無駄になる。**このゲートを飛ばさない。**

6. **asset-generator ×N ＋ publisher を同時に Task 起動（並列）。**
   - `asset-generator` は**素材ファイルが無いシーンの数だけ**起動する。**既に在るシーンは起動しない**
     （人間が手で直した内容を巻き戻さないため）。作り直したいシーンは、人間がそのファイルを消してから再実行する。
   - `assets/<scene_id>.redo.md` が在れば、その中身を**そのシーンの担当に渡す**（捨てられた理由）。
     渡し終えたら消す。理由を渡さないと作り直しは当てずっぽうの引き直しになり、直すべき側を取り違える。
   - `publisher` は `script.md` にしか依存しないので、素材生成と**同時に**回す。
   - 各体には**自分の担当分だけ**を渡す（`asset-generator` には担当 `scene_id` を1つ）。

7. **judge を Task 起動（別コンテキスト必須）。** 渡すのは `brief.yaml` / `script.md` / `assets/` / `channel/` の**パスだけ**
   （producer の思考過程は渡さない）。`review.md` が返る。
   `brief.yaml` を渡すのは、**台本の主張が企画の `points:` から導けるか**を突き合わせられる主体が judge だけだからである。

8. **分岐。**
   - **差し戻し（objective）** … 該当 `scene_id` の素材ファイルを消し、**そのシーンだけ** `asset-generator` を再起動する。
     **差し戻しは1巡まで。** 2巡目も割れるなら `⚠` として人間へ回す（判断が割れるものは何度回しても収束しない）。
   - **⚠ 人間判断** … `review.md` に残したまま人間へ委ねる。**黙って1つに丸めない。**

9. **組み立てと検算（スクリプト）。**
   ```bash
   python3 .claude/tools/produce-video/produce-video.py build  <videos/<format>/<id>>
   python3 .claude/tools/produce-video/produce-video.py check  <videos/<format>/<id>>
   ```
   `build` は ERROR がある間は何も書かない。ERROR が出たら、**その `scene_id` の担当だけ**を再起動して直す。
   検査コードの意味は [`tools/produce-video/README.md`](../../tools/produce-video/README.md)。

10. **多言語化（`brief.yaml` に `languages:` があるときだけ）。** 台本と素材が確定してから回す
    （caption / telop は素材側にあり、差し戻しで動く間に訳すと訳が原文からずれる）。
    1. **前提を確かめる（インライン）。** `channel/voice.md` に**各言語の実測話速**があるか。
       無い言語は**そこで止めて人間へ返す**（🙋 先に `calibrate --lang` で測る。推測の話速で訳すと全シーンの予算が虚構になる）。
    2. **localizer を言語の数だけ Task 起動（並列）。** 各体には**担当言語を1つ**と、
       `script.md` / `assets/` / `publish.md` / `channel/voice.md` / `channel/identity.md` /（在れば）`research.md` `research-review.md` のパスを渡す。
       **既に `i18n/<lang>.json` が在る言語は起動しない**（作り直したい言語は、人間がそのファイルを消してから）。
       `i18n/<lang>.redo.md` が在れば、その中身をその言語の担当に渡し、渡し終えたら消す。
    3. **localization-judge を言語の数だけ Task 起動（別コンテキスト必須）。** 渡すのは原文と `i18n/<lang>.json` の**パスだけ**。
       `i18n/<lang>.review.md` が返る。
    4. **分岐。** objective な誤り（誤訳・確度の変質・禁止表現）は該当言語のファイルを消して localizer を再起動する。
       **差し戻しは1巡まで。** 解釈が割れるものは `⚠` のまま人間へ。

11. **引き渡し。** 成果物一覧と、人間の仕事（下記）を明示する。

## 出力（すべて `videos/<format>/<id>/`）

| ファイル | 内容 | 作る主体 |
| --- | --- | --- |
| `research.md` | 出典付きの事実（調査を回したときだけ） | researcher |
| `research-review.md` | 出典を開き直した検証結果（同上） | fact-checker |
| `angle.md` | 構成案3つと、人間が選んだ案 | comedian → 🙋 人間が選ぶ |
| `script.md` | L0 台本（シーンID＋尺予算） | script-writer |
| `assets/SC-nn.json` | L1 素材（1シーン1ファイル） | asset-generator |
| `assets/THUMB.json` | L1 サムネ定義（時間軸なし） | publisher |
| `scenes.json` | L2 コマ定義 | **スクリプト** |
| `timeline.json` | L3 タイムライン | **スクリプト** |
| `publish.md` | L4 タイトル案3・説明文・タグ・チャプター | publisher |
| `review.md` | 反証レビュー＋`channel/` への差分提案 | judge |
| `i18n/<lang>.json` | 多言語素材（`languages:` があるときだけ。1言語1ファイル） | localizer |
| `i18n/<lang>.review.md` | 訳の反証レビュー（同上） | localization-judge |
| `channel-draft.md` | `channel/` が無いときだけ出るブートストラップ草案 | orchestrator（🙋 承認待ちで停止） |

## 引き渡し（何が済み・何が人間の仕事か）

- ✅ 済: 台本と尺配分・全シーンの素材プロンプト・コマ定義とタイムライン・公開パッケージ・**独立サブエージェント（judge）による**横断レビュー・（多言語の回は）言語別素材と**独立レビュアーによる**訳の反証
- ⏳ 人間: `⚠` の判断、**タイトル3案からの選択**（言語ごと）、`review.md` の `channel/` 差分提案の承認・反映、（多言語の回は）`i18n/<lang>.review.md` の確認
- ▶️ 次: 実体化は [`render-media`](../render-media/SKILL.md)。このスキルの出力をそのまま入力に取る
- **AI 出力は必ず人間チェックを通す前提。** skill は実体を作らず、`channel/` を書き換えない。

## ✅ 着手前チェックリスト

- [ ] チャンネルのルートと対象動画を確定したか（`channel/` が無いならブートストラップ提案で止まったか）
- [ ] 事実が中身のテーマなら、調査を回し、**集めた本人でない fact-checker** に出典を開き直させたか
- [ ] **構成を人間に選ばせたか**（`angle.md` が `status: chosen` か）。ここを飛ばすと出典の一覧になる
- [ ] 選ばれた案の「捨てる事実」が、台本に紛れ込んでいないか
- [ ] researcher に `brief.yaml` を渡したか（渡さないと打ち切りの必要量を計算できない）／届かなかったなら人間へ出したか
- [ ] fact-checker が落とした事実・下げた確度が、台本に反映されているか（勢いのために戻していないか）
- [ ] **台本の人間ゲートを通したか**（承認前に素材生成へ進んでいないか）
- [ ] 既に在る素材ファイルのシーンを再起動していないか（人間の手直しを巻き戻していないか）
- [ ] 横断レビューを**素材を書いていない別サブエージェント（judge）**で回したか（自己レビューにしていないか）
- [ ] `produce-video check` が ERROR ゼロで通ったか
- [ ] 多言語の回なら、**各言語の実測話速が `channel/voice.md` に在ることを確かめてから** localizer を起動したか
- [ ] 訳の反証を**翻訳を書いていない別サブエージェント（localization-judge）**で回したか
- [ ] 解釈が割れるものを黙って1つに丸めず、`⚠` のまま人間へ回したか
