# claude-harness

AI（特に Claude）の**ベースライン・コンテキストをゼロに保ちながら**、AI 自身が必要なルールだけを必要な瞬間にロードするための、**オンデマンド型ルーティング（Prompt as Code）** 共通プロンプトリポジトリです。

---

## 🎯 思想：なぜ「全部盛り」をやめるのか

多くのプロジェクトでは `CLAUDE.md` に規約・スタック・業務ルールを全部書き込みます。しかしこれは以下の問題を生みます。

- **コンテキスト汚染**: フロントの作業中に翻訳ルールまで読まされ、判断がぶれる。
- **保守不能**: 1 ファイルが肥大化し、どこに何があるか誰も分からなくなる。
- **トークンの浪費**: 使わないルールを毎回ロードする。

そこで本リポジトリは、ルールを **「シーン → プラットフォーム → framework → 関心」** という階層に分解し（全 platform に効く関心事だけシーン直下に置き）、AI に **「今必要な葉ノードだけ」** をロードさせます。**常駐する目次（カタログ）すら持ちません。**

## 🧭 統治ルール（この構造の唯一の原則）

> **ある階層の `.md` ＝ その抽象度のルール／サブフォルダ ＝ さらに具体化した特殊化。深いほど具体的。**
> **ツリーの軸は「種類(kind)」であって「プロジェクト」ではない。**

- 上の階層ほど抽象（全開発に効く思想）、下るほど具体（framework 固有の規約）。
- プロジェクト固有の逸脱は**この共有リポジトリに置かない**。各プロジェクトの `CLAUDE.md` に書く（共有リポジトリは常に汎用）。
- **常駐ゼロ**: 目次ファイル（旧 `index.md`）は置かない。`CLAUDE.md` ルーターも `settings.json` の自動注入も使わない。ベースラインに載るルールは **0**。
- **各葉は `paths:` フロントマターで自己申告する**。対象ファイルを触った瞬間だけ、Claude Code ネイティブの `.claude/rules/` 機構が該当葉を注入する（遅延ロード）。
- **手続き（進め方）は skill が入口**。orchestrator の判断核・実行台本は develop skill 自体が内包する（rules に置かない）。producer / committer / adr-writer の craft は各 agent body が持つ。

## 🗺️ オンデマンド・ルーティング（常駐ゼロ）

発見経路は次の 3 つだけ。**いずれも「必要になった瞬間」にしか発火しない。**

```text
① paths ゲート … 各葉の frontmatter `paths:` にマッチするファイルを触ると、その葉だけ注入
   例) crow3_* 配下を触る          → web/crow/{common,frontend,backend}/*.md が載る
       next.config / app/**/page.tsx 等 → web/next/{common,frontend,backend}/*.md が載る
       *.tsx / *.ts を触る          → native/expo/{common,frontend}/*.md が載る
       *.swift を触る               → native/swiftui/{common,frontend}/*.md が載る

② skill エントリ … 手続きは skill として description 自動起動 or /name 明示起動
   例) 「開発したい」/develop → develop skill に orchestrator の核・実行台本が丸ごと載る

③ producer の craft … 成果物の書式は、それを生成するサブエージェント本文が SSOT
   例) UC / REQ の書き方 → agents/develop/usecase-definer.md / requirement-definer.md（spawn 時のみロード）
       契約の書式             → agents/develop/contract-author.md（同上）
```

> ルーティングは **Claude Code ネイティブの `.claude/rules/` 機構**が担う（CLAUDE.md ルーター不要・`settings.json` は空）。
> 目次は常駐しない。葉は `paths` にマッチした時だけ、orchestrator の核・台本は /develop 起動時に skill 本文で、それぞれロードされる。

| 要素 | 例 | 役割 | ロード契機 |
| --- | --- | --- | --- |
| 📦 ケース（葉） | `.../<framework>/*.md`（全 platform に効くものは `<scene>/*.md`） | 実ルール（規約・思想） | `paths` にマッチしたファイルを触った時 |
| 🧬 producer craft | `agents/develop/requirement-definer.md` の負のリスト | 成果物の書き方（craft）の SSOT。書式そのものは `templates/` | 当該サブエージェント spawn 時のみ |
| 🛠️ スキル | `.claude/skills/<name>/SKILL.md` | 手続きの入口（develop は orchestrator の判断核・実行台本を内包） | `description` で自動／`/name` で明示 |
| 🤖 エージェント | `.claude/agents/develop/<name>.md` | 専門サブエージェントの人格 | orchestrator が Task 起動する時 |

> **原則:** どのノードも「存在」を常駐で宣言しない。AI は skill を起動するか、対象ファイルを触って初めて葉を開く。

## 📂 ディレクトリ構成

```text
claude-harness/
 ├── README.md               # このファイル
 ├── init.sh                 # 導入スクリプト（このリポジトリを .claude/ として配置）
 │
 └── .claude/
      ├── settings.json                    # 空（{}）。自動注入もルーターも持たない＝常駐ゼロ
      │
      ├── rules/                           # 📦 葉のみ。目次(index.md)は持たない
      │    ├── develop/                    #   🎬 シーン: システム開発（旧 engineering）※判断核・台本は develop skill 内
      │    │    ├── comments.md            #     💬 scene 共通則: コード内コメント（全 platform に効く）
      │    │    ├── docs.md                #     📚 scene 共通則: SDD/SSOT 規約（R-ID 付き。docs/** を触ると載る）
      │    │    ├── web/                   #     🖥️ プラットフォーム: Web（builder 規約）
      │    │    │    ├── crow/             #       📦 framework: crow（PHP独自FW）
      │    │    │    │    ├── common/      #         🔗 全レイヤ共通
      │    │    │    │    │    ├── coding.md #          コーディング規約（共通スタイル）
      │    │    │    │    │    └── testing.md #         テストの共通則
      │    │    │    │    ├── frontend/    #         🎨 表面（HTML/CSS/JS）
      │    │    │    │    │    ├── coding.md #          共通への上乗せ
      │    │    │    │    │    ├── viewpart.md #        ビューパーツの構造規約
      │    │    │    │    │    ├── viewpart-dataflow.md # 状態と単一方向フロー
      │    │    │    │    │    ├── viewpart-components.md # 粒度と再利用（ui/parts/feature）
      │    │    │    │    │    └── testing.md #         テスト設計（外部ランナー）
      │    │    │    │    └── backend/     #         ⚙️ サーバ側（PHP）
      │    │    │    │         ├── coding.md #          共通への上乗せ
      │    │    │    │         ├── testing.md #         テスト設計（PHPUnit）
      │    │    │    │         └── db.md    #          DB 設計の書式・住所（db_design.txt）
      │    │    │    └── next/             #       📦 framework: Next.js（App Router）
      │    │    │         ├── common/      #         🔗 全レイヤ共通
      │    │    │         │    ├── coding.md #          TS の共通則・export・秘密
      │    │    │         │    └── testing.md #         ランナー契約・スイート分離・UC-nnn / @covers
      │    │    │         ├── frontend/    #         🎨 RSC / Client 境界
      │    │    │         │    ├── coding.md #          Server 既定・page は配線
      │    │    │         │    ├── dataflow.md #        一方向データフロー・状態の置き場
      │    │    │         │    ├── components.md #      粒度と UI/ロジック実装体の分担
      │    │    │         │    ├── routing.md #         App Router の住所と URL 前提
      │    │    │         │    └── testing.md #         props 状態の UI 試験・スナップショット禁止
      │    │    │         └── backend/     #         ⚙️ サーバ側責務分離
      │    │    │              ├── coding.md #          4 役割・Actions / 縁の検証
      │    │    │              └── testing.md #         ドメイン優先・境界モック・縁は薄く
      │    │    ├── native/                #     📱 プラットフォーム: モバイルネイティブ
      │    │    │    ├── expo/             #       📦 framework: Expo（expo-router / React Native）
      │    │    │    │    ├── common/      #         🔗 全レイヤ共通
      │    │    │    │    │    ├── coding.md #          TS の共通則・秘密と依存の境界
      │    │    │    │    │    └── testing.md #         ランナー契約（jest-expo）・決定性
      │    │    │    │    └── frontend/    #         🎨 アプリ本体（RN アプリ＝frontend レイヤ）
      │    │    │    │         ├── coding.md #          RN は Web ではない（表面の差分）
      │    │    │    │         ├── routing.md #         expo-router の住所と遷移
      │    │    │    │         ├── dataflow.md #        サーバ状態/クライアント状態・単一方向
      │    │    │    │         ├── components.md #      粒度と UI/ロジック実装体の分担
      │    │    │    │         └── （frontend/testing.md は当面置かない）
      │    │    │    └── swiftui/          #       📦 framework: SwiftUI（ネイティブ iOS）
      │    │    │         ├── common/      #         🔗 全レイヤ共通
      │    │    │         │    ├── coding.md #          Feature-first・MainActor・秘密と依存
      │    │    │         │    └── testing.md #         ランナー契約・UseCase 主戦場・スイート分離
      │    │    │         └── frontend/    #         🎨 アプリ本体（SwiftUI アプリ＝frontend レイヤ）
      │    │    │              ├── coding.md #          View 表面（body・リスト・Preview・縁）
      │    │    │              ├── routing.md #         Feature Router（NavigationStack）
      │    │    │              ├── dataflow.md #        CA・Observation・UseCase/Repository
      │    │    │              ├── components.md #      粒度と UI/ロジック実装体の分担
      │    │    │              └── （frontend/testing.md は当面置かない）
      │    │
      │    └── translate-manga-ko-ja/       #   🈯 翻訳の型（overview/register/consistency/master-format/script-format）
      │
      ├── agents/                           # 🤖 サブエージェント（key 別に集約）
      │    ├── develop/                      #   開発（/develop・/develop-light・/attack の orchestrator が Task 起動）
      │    │    ├── domain-definer.md              # Phase1 vision / glossary / actors / GOAL / NFR（人間ゲート）
      │    │    ├── usecase-definer.md             # Phase1 UC.md＝主シナリオ＋状態×イベント表（UC ごと並行・人間ゲート）
      │    │    ├── requirement-definer.md         # Phase1 REQ（EARS 1 文）＋BR 括り出し（人間ゲート）
      │    │    ├── db-designer.md, contract-author.md  # Phase3 構造（DB＝人間ゲート／契約＝機械）
      │    │    ├── structure-oracle.md            # 構造整合の独立判定（本線 /develop）
      │    │    ├── test-designer.md               # REQ の分割クラス宣言＋BE Red テスト（@covers REQ#class。FE は当面起票しない）
      │    │    ├── frontend-ui-implementer.md     # Phase4a-1 見た目（ビュー層・媒体は platform 依存）
      │    │    ├── frontend-logic-implementer.md  # Phase4a-2 frontend 処理・純粋関数
      │    │    ├── backend-logic-implementer.md   # Phase4b backend 処理・純粋関数
      │    │    ├── slice-reviewer.md              # Phase4 末尾の敵対検証（実行攻撃なし。完成ゲート）
      │    │    ├── slice-attacker.md, system-attacker.md # 攻撃（/attack 専用・develop ループ外）
      │    │    ├── skeleton-runner.md             # 高リスク時のみ E2E 貫通（使い捨て）
      │    │    ├── committer.md                    # commit / PR の実行専任（git 規約を body に内包）
      │    │    └── adr-writer.md                   # アーキテクチャ決定記録(ADR)を書く producer（書式は templates/develop/ADR.md）
      │    └── translate-manga-ko-ja/        #   翻訳（/translate-manga-ko-ja の orchestrator が Task 起動）
      │         ├── maker.md                       # 翻訳の1脳（Stage1–4：対訳シート＋master差分提案）
      │         └── judge.md                       # 独立レビュー（Stage5：ブレ・口調矛盾・⚠漏れを反証）
      │
      ├── skills/                           # 🛠️ 共通スキル（description で自動起動 / /name で明示起動）
      │    │  ※ skill は必ず skills/<name>/SKILL.md の1階層に置く（Claude Code はこの階層しか探索しない）
      │    ├── develop/SKILL.md                    # 🎼 開発の指揮者（orchestrator）。核・台本を内包。入口 /develop
      │    ├── develop-light/SKILL.md              # 🎼 小CRUD向けの薄い orchestrator。agents/rules は develop 共用。入口 /develop-light（人間明示のみ）
      │    ├── attack/SKILL.md                     # 🔴 レッドチーム攻撃の指揮者。agents は develop 共用。入口 /attack（人間明示のみ・完成条件外）
      │    ├── translate-manga-ko-ja/SKILL.md      # 🈯 翻訳の指揮者（orchestrator）。maker/judge を起動。入口 /translate-manga-ko-ja
      │    ├── grilling/SKILL.md                   # 計画・設計を詰めるインタビュー
      │    └── docs-migrate/SKILL.md               # 🔧 既存プロジェクトの SDD 準拠化（Phase 0–7: 棚卸し→骨格→語彙→UC→REQ/BR→契約/ADR→検証接続→返済）。入口 /docs-migrate
      │                                            #   （準拠の定義は持たない＝spec-lint / trace-check とテンプレートを正として回すだけ）
      │
      ├── templates/                        # 📄 docs 成果物のテンプレート（書式の SSOT）
      │    ├── develop/                            # vision / glossary / actors / GOAL / UC / REQ / BR / NFR / ADR / contract(境界契約) / components / traceconfig
      │    │                                        #   producer が雛形に使い、spec-lint が必須項目を導出する（書式改定は1箇所）
      │    └── docs-migrate/                       # INVENTORY（/docs-migrate Phase 0 の棚卸し表）
      │
      └── tools/                            # 🔧 実行アセット（バリデータ・生成器）
           ├── spec-lint/                         # docs SSOT の書式・ライフサイクル検証（producer が直接叩く）
           ├── trace-check/                       # トレーサビリティ検査 C1–C12（被覆・@covers/@implements・配置・baseline ラチェット・--next 採番・--index）
           ├── gate-hook/                          # develop skill §2 実装着手ゲートの機械強制（PreToolUse フック・任意有効化）
           └── cursor-sync/                        # .claude の3木(rules/skills/agents) → Cursor の .cursor/ へ射影
```

> 💡 **harness が同梱する機械チェックは「検証ツール」まで**（`tools/spec-lint`＝docs SSOT の書式・ライフサイクル検証、`tools/trace-check`＝docs ↔ コードのトレーサビリティ検査、`tools/gate-hook`＝develop skill §2 の書き込み時停止線）。spec-lint / trace-check は producer がタスク中に直接叩き、スライス完了時とCI でも回す（マージ条件＝テスト緑＋trace-check 新規違反ゼロ）。
> **フック / CI への配線・ブランチ保護といった「設置」は各プロジェクトの責務**（gate-hook もスクリプト＋手順の同梱までで、settings への配線＝有効化は取り込み先の任意。かつて `enforcer` エージェント＋`conventions/enforcement/` が担った常設の強制は撤去済み）。durable な知識は agent body / rules に畳み、実行アセットは `.claude/tools/` に置く。

## 🧱 手続きの3木（skills / agents / rules を同じキーで揃える）

orchestrator を伴う手続き（`develop`・`translate-manga-ko-ja` など）は、**同じキー名で3つの木に分かれて存在する**。人間も AI も、キーを1つ知れば「入口・実行者・型」が一目で辿れる。これが本リポジトリの手続きの標準形である。

| 木 | 役割（何の SSOT か） | develop | translate-manga-ko-ja |
| --- | --- | --- | --- |
| `skills/<key>/SKILL.md` | 入口＝orchestrator の判断核・実行台本（**どう回すか**） | `skills/develop/` | `skills/translate-manga-ko-ja/` |
| `agents/<key>/*.md` | orchestrator が Task 起動する専門サブエージェントの人格（**craft** の SSOT） | `agents/develop/`（domain-definer・usecase-definer・requirement-definer・committer …） | `agents/translate-manga-ko-ja/`（maker・judge） |
| `rules/<key>/**` | paths ゲートで遅延ロードされる型・規約の葉（**規約** の SSOT） | `rules/develop/docs.md`（scene 共通）＋`rules/develop/web/crow/` | `rules/translate-manga-ko-ja/` |

- **skill は複製しない。** 型は rules、craft は agent body が SSOT。skill は「どう回すか」だけを持ち、両者の中身をコピペしない。
- **作る主体 ≠ 判定する主体。** どちらの手続きも producer（develop=implementer 群 / 翻訳=maker）と独立オラクル（develop=oracle/attacker 群 / 翻訳=judge）を**別 agent・別コンテキスト**に分ける。
- **キー名は3木で一致させる。** 新しい手続きを足すときも、この3木を同名で生やす（skills/agents/rules すべて同じ `<key>`）。
- **例外 — orchestrator 変種**: 台本だけ薄い別入口が要るとき（例: `skills/develop-light/`、`skills/attack/`）は、**agents / rules を親キー（`develop`）と共用してよい**。フル3木を複製しない。`develop-light` は成果物形は本線と同型で、検証の厚みだけ落とす（人間明示の `/develop-light` のみ。AI 自己選択禁止）。`attack` は develop の完成条件外の任意攻撃（人間明示の `/attack` のみ）。

## 📐 docs の構成（SDD / SSOT）

harness が生成・検証する docs は **1 ID 1 ファイル**、**縦（GOAL → UC → REQ）は木でファイルシステムに一致**、**横断（BR / NFR / ADR / glossary）は中央**、**索引はコミットしない**、という形をとる（sdd-kit の構成。採用理由は `docs/adr/ADR-0003`）。

```text
docs/
 ├── 00-vision.md  01-glossary.md  02-actors.md  goals-backlog.md   # 単票（課題・KPI / 語彙 / アクター / 未着手ゴール）
 ├── goals/
 │    └── GOAL-01-<slug>/GOAL.md                                    # ゴール（アクターの言葉で 1 文）
 │         └── UC-012-<slug>/                                       # ← 縦スライスの単位。`ls` がスコープ
 │              ├── UC.md          # 主シナリオ・状態×イベント表（空セル禁止。セル → REQ）・例外4分類・phase: 工程
 │              ├── REQ-045.md …   # EARS 1 文 + 検証方針（分割クラス #name ＝ テストの下限と上限）
 │              └── contract.yaml  # 境界契約（HTTP / SDK / local-store / deeplink / push / device）
 ├── rules/BR-003.md …             # 複数 UC が参照する業務規則（存在と意図。値は R-102 で機械可読側へ）
 ├── nfr/NFR-001.md …              # 閾値＋測定方法
 ├── adr/ADR-0001-<slug>.md …      # 決定記録（却下案つき。書き換えず supersede）
 ├── verification/GLOBAL.md        # 全体で検証しない範囲
 └── _shared/components.yaml       # 契約の共有語彙（authSchemes / errorCodes / schemas）
traceconfig.json                   # trace-check の設定（ホスト直下）
```

- **人間ゲートの成果物**（vision / glossary / actors / GOAL / UC / REQ / BR / NFR）は `draft → active`（承認）`→ withdrawn`、**機械ループの成果物**（contract）は `draft → fixed`。工程は各 `UC.md` の `phase:` が持ち、台帳ファイルは持たない（`trace-check --index` が生成）。
- **テストは `@covers REQ-045#class`、実装は `@implements REQ-045 / BR-003 / UC-012`** で上流を指す。`trace-check` が「宣言した全クラスにテストがあるか（C10）」「方針にないテストが無いか（C11）」「孤児参照・死んだ規則・配置ずれ・採番衝突が無いか」を機械判定し、既存プロジェクトは baseline ラチェットで漸進導入する。
- 規約の正文（R-101 単一親制約 … R-1206）は `rules/develop/docs.md` が持ち、`docs/**` を触る producer にだけ paths ゲートで届く。書式はテンプレート、craft は各 agent body（三者を複製しない）。


## 🚀 使い方

### 1. 導入

取り込みたいプロジェクト**だけ**で実行します（実行しないプロジェクトは一切関与しない＝opt-in）。

```bash
# 既定は submodule 配置（チーム・共有リポジトリ向け）
./init.sh /path/to/your-project

# 方式を選ぶ場合
./init.sh /path/to/your-project --mode symlink   # 個人・同一マシン向け
./init.sh /path/to/your-project --mode copy      # スナップショット（更新は伝播しない）
```

`init.sh` は以下を行います（詳細はスクリプト参照）。

- `.claude/`（rules・agents・skills・tools・空の settings.json）を対象プロジェクトへ配置（既定 submodule。他に symlink / copy）
- submodule の場合、harness の**リリースタグ（`v*`）の最新に固定**する（`--tag` で特定版も可）
- ルーター用の CLAUDE.md は設置しない（routing はネイティブ `.claude/rules` ＋ skill が担う。プロジェクト固有の事実が要るなら各プロジェクトが自分で CLAUDE.md を用意する）

> **前提（submodule 運用）**: harness を共有リモートへ push し、リリースを**タグで切る**こと（例: `git tag v0.1.0 && git push --tags`）。update はこのタグ単位で版を進める。

### 1-2. 導入後に harness の更新（SSOT）を取り込む

harness 側でルールを更新し**新しいリリースタグを切ったら**、取り込み済みプロジェクトで反映します。

```bash
# submodule（既定）: 最新リリースへ固定してコミットでピン留め（プロジェクト内で実行）
cd /path/to/your-project
/path/to/claude-harness/init.sh update          # 最新の v* タグへ
/path/to/claude-harness/init.sh update --tag v0.1.0   # 特定版へ（巻き戻しも可）

# submodule 配置に付属する init.sh を使ってもよい（clone 済みなら）
./.claude-harness/init.sh update

# symlink: このリポジトリを pull するだけで全プロジェクトに即反映（プロジェクト側の操作は不要）
# copy   : 再度 ./init.sh ... --force で上書き
```

- `update` は **submodule 配置専用**。gitlink を最新リリースへ進め、`chore: set claude-harness to <tag>` として自動コミット（`--no-commit` でコミット省略）。
- チーム運用では、A を clone した人は `git submodule update --init` で `.claude` の実体を取得する。版を進める bump は**一本化**する（各自が勝手に進めない）。

### 2. 動作イメージ

ユーザーが「crow で作った画面のバグを直して」と依頼した場合：

1. AI は `/develop` を起動（明示、または skill の `description` で自動）。メインエージェントが **orchestrator** になる。
2. orchestrator の判断核・実行台本は develop skill 本文に載っており（別ファイル Read 不要）、対象は **web/crow** と判断。`crow3_*` 配下を触ると `web/crow/` の葉（`common/coding.md` 等）が `paths` ゲートで載る。
3. orchestrator が `.claude/agents/develop/` の専門サブエージェントを順に Task 起動し、修正を進める（人間ゲートは orchestrator が担当、commit は `committer` に委譲）。
4. **native や routines のルールは一切載らない**（常駐ゼロ。触っていない葉は 0 バイトもロードされない）。

> 実プロジェクトでは、そのプロジェクトの `CLAUDE.md`（任意）に「これは web/crow」と書いておけば、AI は判定を省いて最短で葉に到達します。

### 3. 取り込み先プロジェクトが宣言すること

harness は**汎用ルールと検証ツールだけ**を持ち、案件固有の事実は持ちません。次はそのプロジェクトの `CLAUDE.md` に書きます（いずれも任意ですが、無いと AI が推測するか、そのぶん報告で差し戻ります）。

| 宣言 | 何に効くか |
| --- | --- |
| **platform / framework**（例: これは `native/expo`） | orchestrator が規約葉の解決を省略できる（develop skill §6-A） |
| **検証コマンド**（型検査 / lint / テストの実行コマンド） | 実装体が返す直前にこれを全部通す。**宣言が無ければ `package.json` の scripts 等から特定を試み、通せなかったものを報告に載せる**（捏造はしない） |
| **住所の取り決め**（コンポーネントの置き場、切り出したモジュールの置き場など） | 規約葉が「harness では固定しない」としている項目。test-designer と実装体で解釈が割れると赤緑ループが噛み合わない |
| **`traceconfig.json`**（ホスト直下） | trace-check の走査対象（`source` / `tests` / `layering` / `contract`）と ID の桁数。orchestrator が初回にテンプレートから seed し、以後はホストが保守する（`.trace-baseline.json` は既存違反の台帳で、単調減少させる） |

> **機械チェックの「設置」は各プロジェクトの責務**という方針は一貫しています（§ 上の 💡 参照）。harness 側は「何を通すべきか」を agent body と規約葉に持ち、**何をどう叩くかはプロジェクトが宣言する**という分担です。

## 🖱️ Cursor で併用する

同じ SSOT（`.claude/`）を **Cursor でもそのまま効かせられる**。Cursor 2.4 で subagents / skills が入り、`.claude` の3木すべてに対応する読み口ができた。そこで **`.claude` を SSOT のまま、その純粋な射影として `.cursor` を機械生成する**（`.claude/tools/cursor-sync/`）。二重管理はしない。**develop の芯である「別コンテキストの独立オラクル分離」も、Cursor の独立コンテキスト subagent でそのまま保たれる。**

```bash
# 導入時にまとめて生成
./init.sh install /path/to/your-project --cursor

# 既に導入済み／harness を update した後に再生成
./init.sh cursor /path/to/your-project      # 対象省略でカレント repo
```

**対応表（3木すべて写る）**

| Claude 機構 | Cursor 2.4 での対応 | 射影 |
| --- | --- | --- |
| `rules/**/*.md` の `paths:` ゲート | `.cursor/rules/**/*.mdc` の `globs:`（Auto Attached） | `paths:`→`globs:`+`alwaysApply:false`。常駐ゼロ維持（触るまで載らない） |
| `skills/<name>/SKILL.md`（`/name`・description 自動） | `.cursor/skills/<name>/SKILL.md`（同じく `/name`・自動発見） | 複製（形式互換） |
| `agents/<name>.md`（独立コンテキスト subagent） | `.cursor/agents/<name>.md`（独立コンテキスト・自動/`/name`/並列） | 複製＋`model:`を`inherit`へ正規化 |

> **なぜ agents も射影するのか（Cursor は `.claude/agents` も直接読むのに）:** 各 agent は Claude Code 向けに `model: opus`／`inherit` を持つが、Cursor は `opus` を解決できない恐れがある。そこで `.cursor/agents/`（名前衝突時に `.claude/agents/` より優先）へ `model: inherit` に正規化した版を置いて上書きする。Cursor での実モデルは **orchestrator が Task 起動のたびタスクに合わせて選ぶ**（判断ゾーンは上位・決定論ゾーンは軽量寄り／`inherit`。slug のベタ書きはしない。台本は develop skill §5）。`tools:` は Cursor が解釈しないが害が無いので残す（read-only オラクル／reviewer／攻撃の規律は各 agent body の指示で担保される）。

- ディレクトリ構造は保持する（Cursor はネストした `.cursor/rules` / `.cursor/agents` を再帰探索する）。skills は `.cursor/skills` のみ読む（`.claude/skills` は読まない）ため射影が必須。
- 生成物には `GENERATED by ... — do not edit` を刻む。**編集は `.claude/` 側（SSOT）で行い、`init.sh cursor` で再生成する**。生成器はこのマーカ付きファイルだけを入れ替えるので、手書きの `.cursor/**` は保護される。
- `.cursor/**` は生成スナップショットなので、`.claude` を submodule/symlink で更新しても自動追従しない。**harness を update したら `init.sh cursor` を再実行する**こと。
- **要 Cursor 実機確認**: 配線は済んでいるが、subagent の委譲挙動・Task 起動時の model 選択・SKILL 本文の delegation 指示が Cursor でどう解釈されるかは、実際の Cursor 2.4+ で一度通して確認すること。

## ➕ 拡張のしかた

新しいルールを足すときは「葉を生やして `paths` を付ける」だけです。目次への追記は要りません。

1. 適切な階層にケース Markdown を追加（例: `web/crow/backend/coding.md`、新 framework なら `web/laravel/coding.md`。全 platform に等しく効く関心事だけ scene 直下 `develop/*.md`）。
2. その葉の frontmatter に `paths:`（発火するファイルの glob）を書く。手続きが要るなら skill を足す。
3. 完了。**常駐する目次が無いので、他ファイルの書き換えは不要。**

> **プロジェクト固有のルールはここに足さない。** 共有リポジトリは汎用ルールのみ。案件ごとの逸脱は各プロジェクトの `CLAUDE.md` に書く。

## 🧩 設計ルール（コントリビュート時の約束）

- **階層＝抽象度**: 上ほど抽象、下ほど具体。深さで具体度を表す。
- **軸は種類(kind)、プロジェクトではない**: プロジェクト別ディレクトリを作らない。
- **1 ケース = 1 関心事**: ファイルは小さく、単一責務に保つ（coding / testing …）。
- **常駐ゼロを崩さない**: 目次ファイルを復活させない。発見は `paths` ゲートと skill 直リンクだけで賄う。
- **葉には必ず `paths:`**: 発火条件を自己申告させる。手続きの入口が要るなら skill にする。
- **参照は相対パスで**: 移設・submodule 化に強くする。
```
