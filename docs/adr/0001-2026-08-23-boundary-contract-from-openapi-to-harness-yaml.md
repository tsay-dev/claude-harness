# ADR-0001: 機能の境界契約を OpenAPI から harness 独自 YAML へ移す

- **Date**: 2026-08-23
- **Status**: Accepted

## Context

各機能の境界契約は `docs/specs/F-xxx-<slug>/api-contract.yaml` に OpenAPI 3.1 で書く建て付けだった。これは web（自前 HTTP バックエンドを持つプロジェクト）を暗黙の前提にしており、native（SwiftUI / Expo）で次の破綻が出た。

1. **共有語彙が web セッション決め打ち。** `_shared/components.yaml` の `securitySchemes` が `type: apiKey / in: cookie / name: session` で配られていた。native は Bearer ＋ Keychain / SecureStore が通常で、初手から誤った語彙が seed される。
2. **サーバ往復のない機能で手詰まりになる。** develop skill §2 の start gate は `api-contract.yaml` が `fixed` であることを「サイズや理由による免除なし」で要求する。一方 contract-author は DB 設計が渡されなければ書き始めない。ローカル永続だけの機能（設定の保存、オフライン閲覧、カメラ撮影）はゲートに契約を要求されながら producer が書けずに止まる。
3. **native の境界が HTTP ではない。** deeplink / universal link、push 通知ペイロード、OS 権限ゲート、ローカル永続モデルは SSOT の GWT には現れるのに、「境界の形」を持つ成果物に居場所がない。結果として `spec.md` に溢れるか、無記載になる。
4. **他社 API を使う場合に契約の向きが逆転する。** Firebase / Supabase / 既存の他社 API では、契約は我々が決めるものではなく写し取るものであり、対応する DB 設計も存在しない。contract-author の「settle する専門家」という規定と噛み合わない。

検討して退けた選択肢は以下。

- **OpenAPI を維持し `paths:` に疑似パスを並べる**（`x-transport` で種別を示す）。変更量は最小で spec-lint・gate-hook・docs-migrate・19 ファイルの参照が無傷。しかし HTTP メソッドとステータスコードを意味なく借りることになり、ローカル永続の操作が `post: /settings/appearance` で `200` を返す、という嘘が契約に常駐する。契約は下流の全実装が唯一よりどころにする成果物であり、そこに嘘を置くのは代償が大きすぎる。
- **TypeSpec**。transport 非依存の IDL を SSOT にし OpenAPI / JSON Schema / Protobuf へ射影する仕組みで、今回の問題への直球。コンパイラが強い機械オラクルにもなる。退けた理由は、node ツールチェーン依存が SwiftUI プロジェクトに異物であること、契約ファイルが生成物になり MIS のペア構造（`spec.md` と契約が並ぶ）が崩れること。
- **Protobuf / gRPC IDL**。`rpc` は transport 非依存で概念的には近い。しかし `minLength` / `enum` / `format` などの制約表現が弱く、examples が IDL に入らない。契約から「制約と実値」が落ちる。
- **JSON Schema 単体**。完全に transport 中立だが、呼び出し口の同一性と誤り集合を表現できず、その上にミニ OpenAPI を再発明することになる。
- **AsyncAPI**。push 通知には合うが request / response に弱い。置き換えではなく 2 つ目の形式が増えるだけになる。

## Decision

契約を **harness 独自の YAML フォーマット**に置き換える。ファイル名は `api-contract.yaml` から **`contract.yaml`** に改める（OpenAPI でもなく API 限定でもなくなったため）。

フォーマットの芯は「操作 × 経路 × 向き × 所有」を直交に持つこと。

- `transport`: `http | sdk | local-store | deeplink | push | device` の閉じた enum。
- `direction`: `outbound`（このアプリが呼ぶ）/ `inbound`（このアプリが呼ばれる）。deeplink と push は inbound、HTTP とローカル永続は outbound で、向きが逆であることを構造に持たせる。
- `owned`: `true`（形を我々が決める）/ `false`（他者の境界を写し取る）。`false` のとき DB 対応の検査を免除し、写し取り元を `source:` に持つ。
- 権限は操作ではなく操作の前提条件として `requires:` に置く。request / response を持たないものを操作として並べない。
- `auth` は全 operation で明示必須（不要なら `none` と書く）。値は `_shared/components.yaml` の `authSchemes` 名への参照で、方式自体はプロジェクトの自由。harness は認証方式を決め打ちしない。
- エラーコードは `_shared/components.yaml` の `errorCodes` に閉じ、未定義コードは検査で弾く。
- 境界を本当に持たない機能は `operations: {}` ＋ `x-no-boundary` で**境界ゼロを宣言**する。「契約がない」ではなく「ゼロだと宣言した契約がある」にすることで、start gate に免除の穴を開けない。

既存ホストが持つ OpenAPI 形式の契約はハードカットする。spec-lint が `openapi:` を持つファイルを検出したら旧レイアウト検出と同じ作法で err にし、`/docs-migrate` に誘導する。変換は AI ではなく spec-lint のサブコマンドが機械的に行う（ADR-0002）。移行前のホストは旧 `v*` タグに留まれる。

## Consequences

**得られるもの**

- web と native が同じ 1 つの形式で境界を書ける。native 固有の境界（deeplink / push / 権限 / ローカル永続）が spec.md に溢れず、契約に居場所を持つ。
- 「決める契約」と「写し取る契約」が構造で区別され、他社 API を使う機能で contract-author が DB 不在を理由に止まらなくなる。
- 認証方式の決め打ちが消え、共有ハーネスがホストの選択を縛らなくなる（CLAUDE.md §0）。
- フォーマットを我々が所有するため、検査したい不変条件をそのまま構造にできる（`requires` があるのに対応する `errors` がない、`wire` が http 以外に書かれている、など）。

**代償と今後の制約**

- **OpenAPI エコシステムを失う。** redocly / spectral による構文検証も、クライアント / サーバのコード生成も使えなくなる。検証は自前チェッカーが全面的に肩代わりする（ADR-0002）。コード生成が必要になったプロジェクトは、この形式から OpenAPI を吐く emitter を自分で持つ必要がある。
- **LLM の既知フォーマットではない。** contract-author は事前学習で慣れた形式を書けなくなるため、テンプレートのガイダンスコメントと機械検査への依存度が上がる。テンプレートが痩せると品質が直接落ちる。
- **破壊的変更。** 既存ホストは `/docs-migrate` を通すまで spec-lint が通らない。`v*` タグの注釈に移行手順を書き、移行しないホストは旧タグに留まる運用になる。
- `transport` が閉じた enum であるため、将来の未知の境界（Widget、バックグラウンドタスク、Watch 連携など）が出たときは harness 側の enum 追加が必要になる。開いた文字列にすればホスト側で伸ばせたが、それはチェッカーが transport の妥当性を検証できなくなることと引き換えであり、機械検査を優先した。
