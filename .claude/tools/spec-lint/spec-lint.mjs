#!/usr/bin/env node
//
//  spec-lint — docs SSOT のフォーマット / ライフサイクル検証（harness 同梱ツール）
//
//  検証対象のレイアウト（1 機能 1 ディレクトリ）:
//    docs/PRD.md                             【任意】Why / スコープ / 横断業務原則
//    docs/design.md                          【任意】How の現在形
//    docs/specs/specs.md                     台帳（全機能一覧・工程列）
//    docs/specs/_shared/components.yaml      契約の共有語彙（$ref 先）
//    docs/specs/F-xxx-<slug>/spec.md         機能詳細（SSOT・GWT）
//    docs/specs/F-xxx-<slug>/contract.yaml      機能の境界契約（harness 独自 YAML）
//
//  書式の SSOT は .claude/templates/develop/ のテンプレート。本ツールは
//  spec.md の必須セクション・必須フロントマター・契約の必須 x- キーを
//  テンプレートから導出する（書式改定はテンプレートを直せば lint も追従する）。
//
//  契約フォーマットの判断は docs/adr/0001（OpenAPI をやめた理由）と
//  docs/adr/0002（パーサを自前実装し YAML を厳格サブセットに限る理由）。
//
//  使い方:
//    node spec-lint.mjs validate [--docs docs]      全 docs を検証（フォーマット＋不変条件）
//    node spec-lint.mjs gate --message <file>       commit メッセージの Feature: トレーラを検証
//    node spec-lint.mjs gate --feature F-001         指定機能が fixed か検証
//    node spec-lint.mjs convert [--write]           旧 OpenAPI 契約を新フォーマットへ機械変換
//
//  終了コード: 0=OK / 1=違反あり / 2=使い方エラー
//

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_DIR = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"templates",
	"develop",
);

const SENTINELS = ["F-000", "YYYY-MM-DD"];
const DIR_RE = /^F-\d+-[a-z0-9-]+$/;

//  --- 肥大の閾値（本ツールが唯一の SSOT。producer craft に数値を書き写さない）---
//  spec.md は 1 スライスで producer / oracle の 9 箇所が全文を読むため、分量は
//  そのまま全エージェントのコンテキスト＝コストになる。書き手（ssot-definer）は
//  数を数えず、validate の warn がゼロになるまで削ることで予算を守る。
//  spec の本体は「業務ルール」（規則）で、「受け入れ条件」はそれだけでは解釈が
//  割れる箇所に置く代表例。ケースの網羅は test-designer の職務なので、GWT の
//  予算は規則より小さい（規則 1 本 → テスト N 本が正常な比率）。
const MAX_SPEC_CHARS = 12000; //  spec.md 本文の文字数（行数では 1 行 1,000 字の肥大を見逃す）
const MAX_RULE_BULLETS = 30; //  業務ルールの本数（1 規則 1 文）
const MAX_RULE_CHARS = 150; //  規則 1 本の長さ（超えるのは複数規則の圧縮）
const MAX_GWT_BULLETS = 15; //  受け入れ条件の本数（規則を補う代表例のみ。テストケース一覧ではない）
const MAX_CROSS_REFS = 20; //  自機能以外の F-xxx 参照の総数（複製の密度）
const MAX_CONTRACT_LINES = 400; //  契約 YAML は 1 行 1 キーの ASCII なので行数で測る

//  --- 収集した違反 ---
const errors = [];
const warns = [];
const err = (file, msg) => errors.push({ file, msg });
const warn = (file, msg) => warns.push({ file, msg });

//  --- パーサ ---
function parseFrontmatter(text) {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== "---") return { data: {}, body: text, hasFm: false };
	const data = {};
	let i = 1;
	for (; i < lines.length; i++) {
		if (lines[i] === "---") {
			i++;
			break;
		}
		const m = lines[i].match(/^([^:]+):\s*(.*)$/);
		if (m) {
			//  行末の "# コメント" を除去
			const val = m[2].replace(/\s+#.*$/, "").trim();
			data[m[1].trim()] = val;
		}
	}
	return { data, body: lines.slice(i).join("\n"), hasFm: true };
}

function getSections(body) {
	const secs = [];
	let cur = null;
	for (const line of body.split(/\r?\n/)) {
		const m = line.match(/^##\s+(.*)$/);
		if (m) {
			cur = { title: m[1].trim(), lines: [] };
			secs.push(cur);
		} else if (cur) {
			cur.lines.push(line);
		}
	}
	return secs;
}

const sectionFilled = (sec) => sec.lines.some((l) => l.trim().length > 0);
const findSection = (body, test) => getSections(body).find((s) => test(s.title));

//  マークダウン表の1列目（＝名前列）を拾う。ヘッダ行・区切り行は位置で除外。
function tableFirstColumn(lines) {
	const names = [];
	let seenHeader = false;
	for (const line of lines) {
		const t = line.trim();
		if (!t.startsWith("|")) continue;
		const cells = t
			.split("|")
			.slice(1, -1)
			.map((c) => c.trim());
		const first = cells[0] || "";
		if (/^:?-{2,}:?$/.test(first)) continue; //  区切り行
		if (!seenHeader) {
			seenHeader = true; //  最初の非区切り行＝ヘッダ
			continue;
		}
		if (!first) continue;
		names.push(first);
	}
	return names;
}

//  入力名/リクエスト名の突き合わせ用に正規化（crow の i_ 接頭辞を吸収）
const normName = (n) =>
	n.replace(/`/g, "").trim().replace(/^i_/, "").toLowerCase();

//  --- テンプレートからの書式導出（fallback はテンプレート欠落時のみ）---
function deriveSpecFormat() {
	const file = join(TEMPLATE_DIR, "spec.md");
	const fallback = {
		fmKeys: ["機能ID", "機能名", "ステータス", "更新日"],
		sections: ["目的", "アクター・権限", "入力", "出力", "状態", "受け入れ条件", "業務ルール"],
	};
	if (!existsSync(file)) return fallback;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	const fmKeys = Object.keys(data);
	//  見出しの先頭語（空白・括弧の前まで）を必須セクションのキーとする
	const sections = getSections(body).map((s) => s.title.split(/[\s（(]/)[0]);
	if (fmKeys.length === 0 || sections.length === 0) return fallback;
	return { fmKeys, sections };
}

function deriveContractKeys() {
	const file = join(TEMPLATE_DIR, "contract.yaml");
	const fallback = ["x-feature-id", "x-status", "x-spec", "x-updated"];
	if (!existsSync(file)) return fallback;
	const keys = [];
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const m = line.match(/^(x-[\w-]+):/);
		if (m) keys.push(m[1]);
	}
	return keys.length > 0 ? keys : fallback;
}

//  --- 共通チェック ---
function checkSentinels(file, text, status) {
	if (status !== "fixed") return;
	for (const s of SENTINELS) {
		if (text.includes(s))
			err(file, `fixed なのにテンプレのプレースホルダが残っている: "${s}"`);
	}
	const angle = text.match(/<[^>\n]{1,40}>/g) || [];
	for (const a of angle) {
		//  <機能名> のような全角含みプレースホルダのみ（HTML タグ等は対象外）
		if (/[^\x00-\x7F]/.test(a)) {
			err(file, `fixed なのにプレースホルダが残っている: "${a}"`);
			break;
		}
	}
}

function checkStatus(file, s, label = "ステータス") {
	if (!s) {
		err(file, `${label} が無い`);
		return null;
	}
	if (s !== "draft" && s !== "fixed")
		err(file, `${label} は draft|fixed のいずれか。実際: "${s}"`);
	return s;
}

function checkRequiredFm(file, data, keys) {
	for (const k of keys) {
		if (!data[k] || data[k].length === 0) err(file, `フロントマター "${k}" が空/欠落`);
	}
}

function checkSections(file, body, required, status) {
	const secs = getSections(body);
	for (const key of required) {
		const found = secs.find((s) => s.title.startsWith(key));
		if (!found) {
			err(file, `必須セクション "${key}" が無い`);
		} else if (status === "fixed" && !sectionFilled(found)) {
			err(file, `fixed なのにセクション "${key}" が空`);
		}
	}
}

//  --- docs 衛生（負のリスト混入の検出。SSOT は各 producer craft）---
//  すべて warn（既存プロジェクトの validate を err で即死させない）。
function checkHygiene(file, body, kind, opts = {}) {
	const lines = body.split(/\r?\n/);

	//  1) 冒頭ナラティブ: 最初のセクションまでの blockquote 群（改訂差分の堆積痕）
	if (kind === "spec") {
		let preambleQuotes = 0;
		for (const line of lines) {
			if (/^##\s/.test(line)) break;
			if (line.trim().startsWith(">")) preambleQuotes++;
		}
		if (preambleQuotes > 3)
			warn(
				file,
				`冒頭に blockquote が ${preambleQuotes} 行（改訂経緯は commit message、理由・実測は ADR へ。本文は現在形に統合する）`,
			);
	}

	//  2) 本文中の日付括弧: 「（2026-07-26 改訂）」のような経緯の追記痕
	const dates = body.match(/[（(]\d{4}-\d{2}-\d{2}/g) || [];
	if (dates.length > 0)
		warn(file, `本文中に日付括弧の経緯記述が ${dates.length} 件（経緯は git が持つ。本文は現在形に統合する）`);

	//  3) 実装アンカー: コード側ファイルへのパス／行番号参照（コードが SSOT）
	const anchorRe =
		kind === "spec"
			? /[\w./-]+\.(php|js|ts|jsx|tsx|sql|mjs|cjs|py|rb|go|java)\b(:\d+(-\d+)?)?/g
			: /[\w./-]+\.(php|js|ts|jsx|tsx|sql|mjs|cjs|py|rb|go|java)\b:\d+(-\d+)?/g;
	const anchors = body.match(anchorRe) || [];
	if (anchors.length > 0)
		warn(file, `実装アンカーが ${anchors.length} 件（例: ${anchors[0]}）— コードが SSOT。docs に書かない`);

	if (kind === "spec") {
		//  4) framework 内部 API への言及（クラス::メソッド 形式）
		const scopeRefs = body.match(/\w+::\w+/g) || [];
		if (scopeRefs.length > 0)
			warn(
				file,
				`内部 API 参照が ${scopeRefs.length} 件（例: ${scopeRefs[0]}）— spec は観測可能な振る舞いの語彙で書く`,
			);

		//  5) 未決の堆積セクション（fixed spec に未決を溜めない）
		for (const s of getSections(body)) {
			if (/既知の課題|残存リスク|バックログ/.test(s.title))
				warn(file, `セクション「${s.title}」— 未解決論点・リスクは issue 管理へ排出する`);
		}
	}

	if (kind === "contract") {
		//  4c) 業務ルールの契約への書き戻し（MIS 逸脱の煙探知機）
		const dumpKeys =
			body.match(
				/^\s+x-(state-transition|evaluation-order|error-catalog|business-rule|internal-labels)\b/gm,
			) || [];
		if (dumpKeys.length > 0)
			warn(
				file,
				`業務ルール再掲らしき x-* が ${dumpKeys.length} 件（例: ${dumpKeys[0].trim()}）— 規則・判定順序は spec.md。契約は境界の形だけ`,
			);

		//  5c) description 肥大（info/operation の長文。短い response description は許容）
		const longDescs = countLongDescriptions(lines);
		if (longDescs > 0)
			warn(
				file,
				`長い description が ${longDescs} 件（8 行超または 200 字超）— 目的・規則・UI 説明は spec.md。契約は summary 1 行と短い注記のみ`,
			);
	}

	//  6) 肥大の煙探知機
	//
	//  行数では測らない。1 行 1,000 文字の spec が「358 行」で閾値をすり抜け、
	//  下流の全エージェント（spec.md は 1 スライスで 9 箇所が読む）のコンテキストを
	//  食い潰した実例があるため、spec は分量そのもの＝文字数で測る。
	//  契約 YAML は 1 行 1 キーの ASCII なので行数が実効的な尺度のまま。
	if (kind === "spec") {
		const chars = body.length;
		if (chars > MAX_SPEC_CHARS)
			warn(
				file,
				`本文が ${chars} 文字（${MAX_SPEC_CHARS} 文字超）— 1 関心事を超えた堆積の疑い。spec.md は下流の全 producer / oracle が全文を読むため、肥大はそのまま全エージェントのコンテキストになる（負のリスト該当を排出する）`,
			);

		//  6-1) 規則と代表例の本数。
		//       最上位の箇条書きだけを数える（ネストは 1 つの規則・観測の補足であって
		//       独立した項目ではない）。ネストへの逃避は文字数の閾値が受け止める。
		const topBullets = (sec) =>
			sec ? sec.lines.filter((l) => /^[-*]\s+\S/.test(l)).length : 0;

		const ruleSec = findSection(body, (t) => /業務ルール/.test(t));
		const rules = topBullets(ruleSec);
		if (rules > MAX_RULE_BULLETS)
			warn(
				file,
				`業務ルールが ${rules} 本（${MAX_RULE_BULLETS} 本超）— 1 機能の不変条件として過大。機能が大きすぎる疑い（分割を検討する）`,
			);

		//  本数の上限は、規則を段落で書けば簡単に迂回できる。1 規則 1 文を
		//  守らせるため 1 本あたりの長さも見る（長い規則は複数の規則の圧縮）。
		if (ruleSec) {
			const long = ruleSec.lines
				.filter((l) => /^[-*]\s+\S/.test(l))
				.map((l) => l.length)
				.filter((n) => n > MAX_RULE_CHARS);
			if (long.length > 0)
				warn(
					file,
					`業務ルールに ${MAX_RULE_CHARS} 文字超の規則が ${long.length} 本（最長 ${Math.max(...long)} 文字）— 1 規則 1 文になっていない。複数の規則が 1 本に圧縮されていると、どれが破れたのか判定できない（文型はテンプレート templates/develop/spec.md 参照）`,
				);
		}

		//  受け入れ条件は規則を補う代表例であって、テストケースの一覧ではない。
		//  本数の膨張は、規則の言い換え・値違いの列挙・欠陥ごとの 1 本追加の堆積。
		const gwt = topBullets(findSection(body, (t) => /受け入れ条件|GWT/.test(t)));
		if (gwt > MAX_GWT_BULLETS)
			warn(
				file,
				`受け入れ条件が ${gwt} 本（${MAX_GWT_BULLETS} 本超）— 受け入れ条件は業務ルールだけでは解釈が割れる箇所に置く代表例であり、テストケースの一覧ではない。規則の言い換え・値違いの列挙が混ざっていないか（ケースの網羅は test-designer の職務）`,
			);

		//  6-2) 他機能への参照密度: 「F-011 に準拠」と書いた上で振る舞いも書く、
		//       という複製が起きると 1 機能の spec に他機能の spec が写り込む。
		//       参照そのものは正しいので、密度だけを見る。
		const selfId = opts.selfId || "";
		//  ID の桁数は DIR_RE 同様に固定しない（F-001 / F-0001 どちらの採番でも効く）
		const refs = (body.match(/F-\d+/g) || []).filter((r) => r !== selfId);
		if (refs.length > MAX_CROSS_REFS) {
			const top = [...new Set(refs)].slice(0, 3).join(" / ");
			warn(
				file,
				`他機能への参照が ${refs.length} 件（${MAX_CROSS_REFS} 件超。例: ${top}）— 参照先の振る舞いを複製していないか。共有される振る舞いは所有機能の spec だけが持ち、ここは参照 1 行に留める`,
			);
		}
	} else if (lines.length > MAX_CONTRACT_LINES) {
		warn(
			file,
			`本文が ${lines.length} 行（${MAX_CONTRACT_LINES} 行超）— 1 関心事を超えた堆積の疑い（負のリスト該当を排出する）`,
		);
	}
}

//  YAML の description: ブロック／インラインが長い件数を数える（依存ゼロの行スキャン）
function countLongDescriptions(lines) {
	let count = 0;
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/^(\s*)description:\s*(.*)$/);
		if (!m) continue;
		const indent = m[1].length;
		const rest = m[2].replace(/\s+#.*$/, "").trim();
		if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
			let blockLines = 0;
			let blockChars = 0;
			for (let j = i + 1; j < lines.length; j++) {
				const line = lines[j];
				if (line.trim() === "") {
					blockLines++;
					continue;
				}
				const ind = line.match(/^(\s*)/)[1].length;
				if (ind <= indent) break;
				blockLines++;
				blockChars += line.trim().length;
			}
			if (blockLines > 8 || blockChars > 200) count++;
		} else if (rest.length > 200) {
			count++;
		}
	}
	return count;
}

//  --- spec.md の検証 ---
function validateFeatureSpec(file, text, fmt) {
	const { data, body } = parseFrontmatter(text);
	checkRequiredFm(file, data, fmt.fmKeys);
	const status = checkStatus(file, data["ステータス"]);
	checkSections(file, body, fmt.sections, status);
	checkSentinels(file, text, status);
	checkHygiene(file, body, "spec", { selfId: data["機能ID"] || "" });
	//  状態セクションにハッピーパス以外が含まれるか（fixed のみ・警告）
	const states = findSection(body, (t) => t.startsWith("状態"));
	const statesText = states ? states.lines.join("") : "";
	if (status === "fixed" && states) {
		for (const kw of ["error", "empty", "権限"]) {
			if (!statesText.includes(kw))
				warn(file, `状態に "${kw}" 系の記述が見当たらない（テンプレート templates/develop/spec.md 参照）`);
		}
	}
	const inputSec = findSection(body, (t) => t.startsWith("入力"));
	const inputs = inputSec ? tableFirstColumn(inputSec.lines) : [];
	//  入力表に型・必須・制約列があると契約との二重化（MIS 逸脱）
	if (inputSec) {
		for (const line of inputSec.lines) {
			const t = line.trim();
			if (!t.startsWith("|")) continue;
			if (/\|.*型.*\|/.test(t) || /必須/.test(t) || /制約/.test(t)) {
				warn(
					file,
					`入力表に型・必須・制約列がある — 型情報の正は contract.yaml。spec の入力は「名前｜業務上の意味」のみ（templates/develop/spec.md）`,
				);
				break;
			}
		}
	}
	return { id: data["機能ID"] || null, status, inputs, statesText };
}

//  --- 厳格サブセット YAML パーサ（判断の理由は docs/adr/0002）---
//
//  受理するのはマップ / シーケンス / フロー記法 / スカラ / コメントのみ。
//  アンカー・エイリアス（& / *）と複数行スカラ（| / >）は構文エラーにする。
//  共有は _shared/components.yaml を通す・長い散文は spec.md に置く、という
//  契約の分担を「未対応」ではなく「エラー」として入口で落とすためで、
//  サブセットを狭くしていること自体が検査になっている。
//
//  lenient: true は旧 OpenAPI 契約の読み取り（convert）専用。複数行スカラを
//  1 行に畳んで受理する。検証には使わない。

const BLOCK_INDICATORS = new Set(["|", ">", "|-", ">-", "|+", ">+", "|2", ">2"]);
const isBlockIndicator = (s) => BLOCK_INDICATORS.has(s) || /^[|>][-+]?\d*$/.test(s);
const isQuoted = (s) =>
	(s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
	(s.startsWith("'") && s.endsWith("'") && s.length > 1);
//  キーに {orderId} のようなテンプレート片が入りうる（フロー記法は parseNode が先に見る）
const MAP_ENTRY_RE = /^(?:"[^"]*"|'[^']*'|[^:#]+?)\s*:(\s|$)/;

//  行末コメントを落とす（引用符の中の # は残す）
function stripComment(line) {
	let out = "";
	let quote = null;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			out += c;
			if (c === "\\" && quote === '"') out += line[++i] ?? "";
			else if (c === quote) quote = null;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			out += c;
			continue;
		}
		if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) break;
		out += c;
	}
	return out;
}

function parseFlow(text, ctx, lineNo) {
	const st = { s: text, i: 0 };
	const skip = () => {
		while (st.i < st.s.length && /\s/.test(st.s[st.i])) st.i++;
	};
	const readQuoted = () => {
		const q = st.s[st.i++];
		let out = "";
		while (st.i < st.s.length && st.s[st.i] !== q) {
			if (st.s[st.i] === "\\" && q === '"') st.i++;
			out += st.s[st.i++];
		}
		st.i++;
		return out;
	};
	const readBare = (stops) => {
		let out = "";
		while (st.i < st.s.length && !stops.includes(st.s[st.i])) out += st.s[st.i++];
		return out.trim();
	};
	const readValue = () => {
		skip();
		const c = st.s[st.i];
		if (c === "{") {
			st.i++;
			const obj = {};
			skip();
			if (st.s[st.i] === "}") {
				st.i++;
				return obj;
			}
			for (;;) {
				skip();
				const key = st.s[st.i] === '"' || st.s[st.i] === "'" ? readQuoted() : readBare([":", ",", "}"]);
				skip();
				if (st.s[st.i] !== ":") {
					ctx.reject(lineNo, `フロー記法のマップに ":" が無い: "${text}"`);
					return obj;
				}
				st.i++;
				obj[key] = readValue();
				skip();
				if (st.s[st.i] === ",") {
					st.i++;
					continue;
				}
				if (st.s[st.i] === "}") {
					st.i++;
					return obj;
				}
				ctx.reject(lineNo, `フロー記法のマップが閉じていない: "${text}"`);
				return obj;
			}
		}
		if (c === "[") {
			st.i++;
			const arr = [];
			skip();
			if (st.s[st.i] === "]") {
				st.i++;
				return arr;
			}
			for (;;) {
				arr.push(readValue());
				skip();
				if (st.s[st.i] === ",") {
					st.i++;
					continue;
				}
				if (st.s[st.i] === "]") {
					st.i++;
					return arr;
				}
				ctx.reject(lineNo, `フロー記法のシーケンスが閉じていない: "${text}"`);
				return arr;
			}
		}
		if (c === '"' || c === "'") return readQuoted();
		return coerce(readBare([",", "}", "]"]), ctx, lineNo);
	};
	const v = readValue();
	skip();
	if (st.i < st.s.length) ctx.reject(lineNo, `フロー記法の後に余分な文字がある: "${st.s.slice(st.i)}"`);
	return v;
}

function coerce(s, ctx, lineNo) {
	if (s === "") return null;
	if (s.startsWith("&") || s.startsWith("*"))
		return ctx.reject(
			lineNo,
			`アンカー / エイリアス "${s.split(/\s/)[0]}" は使えない（共有は _shared/components.yaml の $ref を通す）`,
		);
	if (isQuoted(s)) return s.slice(1, -1);
	if (s === "true") return true;
	if (s === "false") return false;
	if (s === "null" || s === "~") return null;
	if (/^-?\d+$/.test(s)) return Number(s);
	if (/^-?\d*\.\d+$/.test(s)) return Number(s);
	return s;
}

function parseScalar(raw, ctx, lineNo) {
	const s = raw.trim();
	if (s.startsWith("{") || s.startsWith("[")) return parseFlow(s, ctx, lineNo);
	return coerce(s, ctx, lineNo);
}

//  値に行番号を持たせる（メッセージで位置を出すため。列挙には出さない）
function stamp(node, line, keyLines) {
	if (node && typeof node === "object") {
		Object.defineProperty(node, "__line", { value: line, enumerable: false });
		if (keyLines) Object.defineProperty(node, "__keyLines", { value: keyLines, enumerable: false });
	}
	return node;
}
const lineOf = (node, key) =>
	(node && node.__keyLines && node.__keyLines[key]) || (node && node.__line) || 0;

function parseStrictYaml(text, opts = {}) {
	const lenient = !!opts.lenient;
	const problems = [];
	const ctx = {
		lenient,
		reject: (line, msg) => {
			problems.push({ line, msg });
			return null;
		},
	};

	//  1) 行を正規化（コメント除去・空行除去）しつつ、タブを弾く
	const src = text.split(/\r?\n/);
	const rows = [];
	for (let i = 0; i < src.length; i++) {
		if (src[i].includes("\t")) ctx.reject(i + 1, "タブ文字は使えない（インデントは半角スペース）");
		const line = stripComment(src[i]).replace(/\s+$/, "");
		if (line.trim() === "") continue;
		if (line.trim() === "---" || line.trim() === "...") continue;
		rows.push({ no: i + 1, indent: line.match(/^ */)[0].length, text: line.trim() });
	}

	//  2) "- key: value" を "-" と "key: value" の 2 行に割って、以降を一様に扱う
	const flat = [];
	for (const r of rows) {
		if (r.text !== "-" && r.text.startsWith("- ")) {
			const innerOffset = r.text.length - r.text.slice(2).replace(/^ +/, "").length;
			flat.push({ no: r.no, indent: r.indent, text: "-" });
			flat.push({ no: r.no, indent: r.indent + innerOffset, text: r.text.slice(2).trim() });
		} else {
			flat.push(r);
		}
	}

	let pos = 0;
	const skipDeeper = (indent) => {
		while (pos < flat.length && flat[pos].indent > indent) pos++;
	};
	const consumeBlock = (indent) => {
		const parts = [];
		while (pos < flat.length && flat[pos].indent > indent) parts.push(flat[pos++].text);
		return parts.join(" ");
	};

	function parseNode(indent) {
		if (pos >= flat.length || flat[pos].indent < indent) return null;
		const row = flat[pos];
		if (row.text.startsWith("{") || row.text.startsWith("[")) {
			pos++;
			return parseFlow(row.text, ctx, row.no);
		}
		if (row.text === "-") return parseSeq(indent);
		if (!MAP_ENTRY_RE.test(row.text)) {
			pos++;
			return parseScalar(row.text, ctx, row.no);
		}
		return parseMap(indent);
	}

	function parseSeq(indent) {
		const arr = [];
		const startLine = flat[pos].no;
		while (pos < flat.length && flat[pos].indent === indent && flat[pos].text === "-") {
			pos++;
			if (pos < flat.length && flat[pos].indent > indent) arr.push(parseNode(flat[pos].indent));
			else arr.push(null);
		}
		return stamp(arr, startLine);
	}

	function parseMap(indent) {
		const obj = {};
		const keyLines = {};
		const startLine = flat[pos].no;
		while (pos < flat.length && flat[pos].indent >= indent) {
			const row = flat[pos];
			if (row.indent > indent) {
				//  違反行の配下は読み飛ばし、同じ深さに戻って走査を続ける（連鎖エラーを出さない）
				ctx.reject(row.no, `インデントが揃っていない（${row.indent} 桁）`);
				skipDeeper(indent);
				continue;
			}
			if (row.text === "-") break;
			const m = row.text.match(/^("[^"]*"|'[^']*'|[^:]+?)\s*:\s*(.*)$/);
			if (!m) {
				ctx.reject(row.no, `マップの "キー: 値" として読めない: "${row.text}"`);
				pos++;
				continue;
			}
			const key = isQuoted(m[1].trim()) ? m[1].trim().slice(1, -1) : m[1].trim();
			const rest = m[2].trim();
			pos++;
			let value;
			if (rest === "" || rest.startsWith("&") || rest.startsWith("*")) {
				if (rest !== "")
					ctx.reject(
						row.no,
						`アンカー / エイリアス "${rest.split(/\s/)[0]}" は使えない（共有は _shared/components.yaml の $ref を通す）`,
					);
				if (pos < flat.length && flat[pos].indent > indent) value = parseNode(flat[pos].indent);
				else if (pos < flat.length && flat[pos].indent === indent && flat[pos].text === "-")
					value = parseSeq(indent);
				else value = null;
			} else if (isBlockIndicator(rest)) {
				if (lenient) {
					value = consumeBlock(indent);
				} else {
					ctx.reject(row.no, `複数行スカラ "${rest}" は使えない（長い散文は spec.md に置く）`);
					skipDeeper(indent);
					value = null;
				}
			} else {
				value = parseScalar(rest, ctx, row.no);
			}
			if (key in obj) ctx.reject(row.no, `キー "${key}" が重複している`);
			obj[key] = value;
			keyLines[key] = row.no;
		}
		if (pos < flat.length && flat[pos].indent > indent) {
			ctx.reject(flat[pos].no, `インデントが揃っていない（${flat[pos].indent} 桁）`);
			skipDeeper(indent);
		}
		return stamp(obj, startLine, keyLines);
	}

	const root = flat.length === 0 ? {} : parseNode(flat[0].indent);
	if (pos < flat.length) ctx.reject(flat[pos].no, `トップレベルのインデントが揃っていない`);
	return { root: root || {}, problems };
}

//  --- 契約 contract.yaml の検証 ---

const TRANSPORTS = ["http", "sdk", "local-store", "deeplink", "push", "device"];
const DIRECTIONS = ["outbound", "inbound"];
const ENTRY_TRANSPORTS = ["deeplink", "push"];
const PERMISSION_CODE = "PERMISSION_DENIED";
const OP_NAME_RE = /^[a-z][A-Za-z0-9]*$/;

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function validateContract(file, text, dirId, xKeys, shared) {
	const at = (line) => (line ? `${file}:${line}` : file);
	const { root, problems } = parseStrictYaml(text);
	for (const p of problems) err(at(p.line), p.msg);

	//  旧 OpenAPI 契約の検出（ハードカット。docs/adr/0001）
	if ("openapi" in root || "paths" in root) {
		err(
			file,
			`旧フォーマット（OpenAPI）の契約を検出。/docs-migrate で新フォーマットへ移行する` +
				`（機械変換: node .claude/tools/spec-lint/spec-lint.mjs convert --write）`,
		);
		return { id: root["x-feature-id"] || dirId, status: null, errorCount: 0, legacy: true, text };
	}

	for (const k of xKeys) {
		const v = root[k];
		if (v === undefined || v === null || String(v).length === 0)
			err(at(lineOf(root, k)), `必須キー "${k}" が空/欠落`);
	}
	//  欠落は上の必須キー検査が既に出しているので、ここでは値の妥当性だけを見る
	const status = root["x-status"]
		? checkStatus(at(lineOf(root, "x-status")), root["x-status"], "x-status")
		: null;
	const id = root["x-feature-id"] || null;
	if (id && dirId && id !== dirId)
		err(at(lineOf(root, "x-feature-id")), `x-feature-id "${id}" がディレクトリ名の ID "${dirId}" と不一致`);

	if (root["x-spec"]) {
		const target = join(dirname(file), String(root["x-spec"]));
		if (!existsSync(target)) err(at(lineOf(root, "x-spec")), `x-spec が解決しない: ${root["x-spec"]}`);
	}

	const ops = root["operations"];
	if (ops === undefined) {
		err(file, `トップレベル "operations:" が無い（境界が無い機能は operations: {} と x-no-boundary で宣言する）`);
		return { id, status, errorCount: 0, text };
	}
	if (!isMap(ops)) {
		err(at(lineOf(root, "operations")), `"operations" はマップで書く`);
		return { id, status, errorCount: 0, text };
	}

	const names = Object.keys(ops);
	if (names.length === 0) {
		//  境界ゼロは「免除」ではなく「宣言」。理由の無い空は通さない
		const reason = root["x-no-boundary"];
		if (!reason || String(reason).trim().length === 0)
			err(
				file,
				`operations が空なのに x-no-boundary が無い（境界を持たない理由を 1 行で書く。書けないなら境界がある）`,
			);
	}

	let errorCount = 0;
	for (const name of names) {
		const op = ops[name];
		const opAt = at(lineOf(ops, name));
		const label = `operations.${name}`;
		if (!isMap(op)) {
			err(opAt, `${label} はマップで書く`);
			continue;
		}
		if (!OP_NAME_RE.test(name))
			err(opAt, `${label}: 操作名は lowerCamelCase で書く`);

		const fieldAt = (k) => at(lineOf(op, k) || lineOf(ops, name));
		const transport = op["transport"];
		const direction = op["direction"];
		const owned = op["owned"];

		if (!TRANSPORTS.includes(transport))
			err(fieldAt("transport"), `${label}: transport は ${TRANSPORTS.join(" | ")} のいずれか。実際: ${JSON.stringify(transport)}`);
		if (!DIRECTIONS.includes(direction))
			err(fieldAt("direction"), `${label}: direction は ${DIRECTIONS.join(" | ")} のいずれか。実際: ${JSON.stringify(direction)}`);
		if (typeof owned !== "boolean")
			err(fieldAt("owned"), `${label}: owned は true|false で明示する（形を我々が決めるのか写し取るのか）`);

		//  auth は省略を許さない。「書き忘れ」と「不要と判断した」を区別できなくなるため
		const auth = op["auth"];
		if (auth === undefined || auth === null || String(auth).length === 0)
			err(fieldAt("auth"), `${label}: auth が無い（不要なら none と明示する）`);
		else if (auth !== "none" && !(shared.authSchemes && auth in shared.authSchemes))
			err(
				fieldAt("auth"),
				`${label}: auth "${auth}" が _shared/components.yaml の authSchemes に無い`,
			);

		if (!op["summary"] || String(op["summary"]).trim().length === 0)
			err(fieldAt("summary"), `${label}: summary が無い（何をするかを 1 行）`);

		//  wire は http 専用。他の transport に HTTP 固有の語彙が漏れるのを止める
		const wire = op["wire"];
		if (transport === "http") {
			if (!isMap(wire)) err(fieldAt("wire"), `${label}: transport が http なら wire（method / path / success）が要る`);
			else {
				for (const k of ["method", "path", "success"])
					if (wire[k] === undefined || wire[k] === null)
						err(fieldAt("wire"), `${label}: wire.${k} が無い`);
			}
		} else if (wire !== undefined) {
			err(fieldAt("wire"), `${label}: transport が ${transport} なのに wire がある（wire は http 専用）`);
		}

		//  写し取りの契約は出所が要る
		if (owned === false && (!op["source"] || String(op["source"]).trim().length === 0))
			err(fieldAt("source"), `${label}: owned が false なら source（写し取り元の URL / SDK バージョン）が要る`);
		if (owned === true && op["source"] !== undefined)
			err(fieldAt("source"), `${label}: owned が true なのに source がある（自前の境界に写し取り元は無い）`);

		//  呼ばれる側は入口の識別子が要る
		if (ENTRY_TRANSPORTS.includes(transport)) {
			if (!op["entry"] || String(op["entry"]).trim().length === 0)
				err(fieldAt("entry"), `${label}: transport が ${transport} なら entry（URL パターン / ペイロード識別子）が要る`);
			if (direction !== "inbound")
				err(fieldAt("direction"), `${label}: transport が ${transport} なら direction は inbound`);
		} else if (op["entry"] !== undefined) {
			err(fieldAt("entry"), `${label}: entry は ${ENTRY_TRANSPORTS.join(" / ")} 専用`);
		}

		//  エラー
		const errs = op["errors"];
		const codes = [];
		if (errs !== undefined) {
			if (!Array.isArray(errs)) err(fieldAt("errors"), `${label}: errors はシーケンスで書く`);
			else
				for (const e of errs) {
					if (!isMap(e)) {
						err(fieldAt("errors"), `${label}: errors の各項目はマップで書く`);
						continue;
					}
					errorCount++;
					const code = e["code"];
					if (!code) err(fieldAt("errors"), `${label}: errors に code が無い`);
					else {
						codes.push(code);
						if (shared.errorCodes && !(code in shared.errorCodes))
							err(
								fieldAt("errors"),
								`${label}: エラーコード "${code}" が _shared/components.yaml の errorCodes に無い`,
							);
					}
					if (!e["when"] || String(e["when"]).trim().length === 0)
						err(fieldAt("errors"), `${label}: errors["${code}"] に when（発生条件 1 行）が無い`);
					if (transport !== "http" && e["wire"] !== undefined)
						err(fieldAt("errors"), `${label}: errors["${code}"] に wire があるが transport が http でない`);
				}
		}

		//  権限を要求するなら、拒否されたときの経路が契約に無ければならない
		const requires = op["requires"];
		if (requires !== undefined) {
			if (!Array.isArray(requires) || requires.some((r) => typeof r !== "string"))
				err(fieldAt("requires"), `${label}: requires は文字列のシーケンスで書く`);
			else if (!codes.includes(PERMISSION_CODE))
				err(
					fieldAt("requires"),
					`${label}: requires を宣言しているのに errors に ${PERMISSION_CODE} が無い（拒否されたときの経路が契約に無い）`,
				);
		}

		//  具体例（fixed のみ）。実装とテストがコピペできる粒度を要求する
		const ex = op["examples"];
		if (status === "fixed") {
			if (!isMap(ex) || Object.keys(ex).length === 0) {
				err(fieldAt("examples"), `${label}: fixed なのに examples が無い（正常 1 件＋異常 1 件以上の実値）`);
			} else {
				const cases = Object.entries(ex);
				const ok = cases.filter(([, c]) => isMap(c) && c["error"] === undefined);
				const ng = cases.filter(([, c]) => isMap(c) && c["error"] !== undefined);
				if (ok.length === 0) err(fieldAt("examples"), `${label}: examples に正常系が無い`);
				if (ng.length === 0) err(fieldAt("examples"), `${label}: examples に異常系（error: <code>）が無い`);
				for (const [caseName, c] of ng)
					if (!codes.includes(c["error"]))
						err(
							fieldAt("examples"),
							`${label}: examples.${caseName} の error "${c["error"]}" がこの操作の errors に無い`,
						);
				//  例のキーが request の properties と噛み合っているか
				const props = isMap(op["request"]) && isMap(op["request"]["properties"]) ? op["request"]["properties"] : null;
				const required = isMap(op["request"]) && Array.isArray(op["request"]["required"]) ? op["request"]["required"] : [];
				if (props)
					for (const [caseName, c] of cases) {
						if (!isMap(c) || !isMap(c["request"])) continue;
						for (const k of Object.keys(c["request"]))
							if (!(k in props))
								err(fieldAt("examples"), `${label}: examples.${caseName}.request の "${k}" が request.properties に無い`);
						for (const k of required)
							if (!(k in c["request"]) && c["error"] === undefined)
								err(fieldAt("examples"), `${label}: examples.${caseName}.request に必須の "${k}" が無い`);
					}
			}
		}
	}

	checkRefs(file, text, at);
	checkSentinels(file, text, status);
	checkHygiene(file, text, "contract");
	return { id, status, errorCount, text };
}

//  $ref の解決（相対ファイルの存在＋アンカー末尾キーの存在）
function checkRefs(file, text, at) {
	const lines = text.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(/\$ref:\s*["']?([^"'\s]+)["']?/);
		if (!m) continue;
		const [path, anchor] = m[1].split("#");
		let targetText = text;
		if (path) {
			const target = join(dirname(file), path);
			if (!existsSync(target)) {
				err(at(i + 1), `$ref のファイルが無い: ${path}`);
				continue;
			}
			targetText = readFileSync(target, "utf8");
		}
		const leaf = (anchor || "").split("/").filter(Boolean).pop();
		if (leaf && !new RegExp(`^\\s+${leaf}:`, "m").test(targetText))
			err(at(i + 1), `$ref のアンカーが見つからない: ${m[1]}`);
	}
}

//  --- 共有語彙 _shared/components.yaml ---
function loadShared(docsDir) {
	const file = join(docsDir, "specs", "_shared", "components.yaml");
	if (!existsSync(file)) {
		warn(file, `共有語彙 components.yaml が無い（テンプレート templates/develop/components.yaml 参照）`);
		return { file, authSchemes: {}, errorCodes: {} };
	}
	const text = readFileSync(file, "utf8");
	const { root, problems } = parseStrictYaml(text);
	for (const p of problems) err(`${file}:${p.line}`, p.msg);
	if ("components" in root && !("errorCodes" in root))
		err(
			file,
			`旧フォーマット（OpenAPI components）の共有語彙を検出。/docs-migrate で authSchemes / errorCodes へ移行する`,
		);
	const authSchemes = isMap(root["authSchemes"]) ? root["authSchemes"] : root["authSchemes"] === null ? {} : null;
	const errorCodes = isMap(root["errorCodes"]) ? root["errorCodes"] : null;
	if (authSchemes === null) err(file, `"authSchemes" が無い（使わないなら authSchemes: {} と書く）`);
	if (errorCodes === null) err(file, `"errorCodes" が無い（契約の errors[].code はここに閉じる）`);
	return { file, authSchemes: authSchemes || {}, errorCodes: errorCodes || {} };
}

//  --- PRD / design（任意ファイル・warn 中心）---
function validateRootDoc(file, kind) {
	if (!existsSync(file)) return;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	if (!data["ステータス"] || !data["更新日"])
		warn(file, `フロントマター（ステータス/更新日）が無い`);
	if (kind === "prd") {
		//  機能別の受け入れ条件は spec の関心事（境界の機械チェック）
		if (/Given|When|Then|受け入れ条件/.test(body))
			warn(file, `GWT/受け入れ条件らしき記述がある — 機能別の受け入れ条件は docs/specs/F-xxx/spec.md へ`);
	}
}

//  --- 台帳（specs.md）---
function parseLedgerTable(body) {
	const rows = [];
	for (const line of body.split(/\r?\n/)) {
		const t = line.trim();
		if (!t.startsWith("|")) continue;
		const cells = t
			.split("|")
			.slice(1, -1)
			.map((c) => c.trim());
		const idm = cells[0] && cells[0].match(/F-\d+/);
		if (!idm) continue; //  ヘッダ・区切り行を飛ばす
		let link = null;
		for (const c of cells) {
			const lm = c.match(/\]\(([^)]+)\)/);
			if (lm) {
				link = lm[1];
				break;
			}
		}
		rows.push({
			id: idm[0],
			name: cells[1] || "",
			status:
				cells.find((c) => c === "draft" || c === "fixed") ||
				cells[cells.length - 1],
			link,
		});
	}
	return rows;
}

//  --- validate コマンド ---
function loadModel(docsDir) {
	const specsRoot = join(docsDir, "specs");
	const ledgerFile = join(specsRoot, "specs.md");
	const fmt = deriveSpecFormat();
	const xKeys = deriveContractKeys();
	const shared = loadShared(docsDir);

	const specs = new Map(); //  id -> { file, dir, status, inputs, statesText }
	const contracts = new Map(); //  id -> { file, status, errorCount, text }
	let ledger = null;

	//  機能ディレクトリの走査（F-* のみ。specs.md / _shared は自然に対象外）
	const dirs = readdirSync(specsRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory() && d.name.startsWith("F-"))
		.map((d) => d.name)
		.sort();

	for (const dir of dirs) {
		const dirPath = join(specsRoot, dir);
		const dirId = (dir.match(/^F-\d+/) || [null])[0];
		if (!DIR_RE.test(dir))
			err(dirPath, `ディレクトリ名が F-xxx-<slug>（slug は小文字ケバブ）でない`);

		const specFile = join(dirPath, "spec.md");
		if (!existsSync(specFile)) {
			err(dirPath, `spec.md が無い（機能ディレクトリには必須）`);
			continue;
		}
		const res = validateFeatureSpec(specFile, readFileSync(specFile, "utf8"), fmt);
		if (res.id && dirId && res.id !== dirId)
			err(specFile, `機能ID "${res.id}" がディレクトリ名の ID "${dirId}" と不一致`);
		const id = res.id || dirId;
		if (id) {
			if (specs.has(id))
				err(specFile, `機能ID "${id}" が重複（${specs.get(id).file} と）`);
			else specs.set(id, { file: specFile, dir, ...res });
		}

		const contractFile = join(dirPath, "contract.yaml");
		const legacyFile = join(dirPath, "api-contract.yaml");
		if (existsSync(contractFile)) {
			const c = validateContract(contractFile, readFileSync(contractFile, "utf8"), dirId, xKeys, shared);
			if (c.id) contracts.set(c.id, { file: contractFile, ...c });
			if (existsSync(legacyFile))
				err(legacyFile, `contract.yaml と api-contract.yaml が両方ある（旧ファイルは git rm する）`);
		} else if (existsSync(legacyFile)) {
			err(
				legacyFile,
				`旧フォーマットの契約が残っている（node .claude/tools/spec-lint/spec-lint.mjs convert --write で変換し contract.yaml に置き換える）`,
			);
		}
	}

	//  台帳
	if (existsSync(ledgerFile)) {
		const { data, body } = parseFrontmatter(readFileSync(ledgerFile, "utf8"));
		checkRequiredFm(ledgerFile, data, ["ステータス", "更新日"]);
		checkStatus(ledgerFile, data["ステータス"]);
		ledger = parseLedgerTable(body);
		if (ledger.length === 0) warn(ledgerFile, "機能一覧テーブルに行が無い");
	} else {
		warn(ledgerFile, "台帳 specs.md が無い（テンプレート templates/develop/specs.md 参照）");
	}

	return { specs, contracts, ledger, specsRoot, ledgerFile, shared };
}

function crossChecks(model) {
	const { specs, contracts, ledger, specsRoot, ledgerFile } = model;

	//  台帳 ↔ spec.md（状態一致・リンク整合・列挙漏れ）
	if (ledger) {
		const listed = new Set();
		for (const row of ledger) {
			listed.add(row.id);
			const spec = specs.get(row.id);
			if (!spec) {
				err(ledgerFile, `台帳の "${row.id}" に対応する機能ディレクトリが docs/specs に無い`);
				continue;
			}
			if (row.link) {
				const target = join(specsRoot, row.link.replace(/^\.\//, ""));
				if (!existsSync(target))
					err(ledgerFile, `"${row.id}" の詳細リンクが解決しない: ${row.link}`);
			}
			if (row.status !== spec.status)
				err(
					ledgerFile,
					`"${row.id}" の状態が不一致: specs.md="${row.status}" / spec="${spec.status}"`,
				);
		}
		for (const [id, spec] of specs) {
			if (!listed.has(id)) err(spec.file, `spec "${id}" が台帳 specs.md に列挙されていない`);
		}
	}

	//  契約カバレッジ: spec が fixed（＝実装に進んでよい）なのに契約が無い機能を可視化
	for (const [id, spec] of specs) {
		if (spec.status === "fixed" && !contracts.has(id))
			warn(spec.file, `${id}: spec が fixed だが contract.yaml が無い`);
	}

	//  contract ↔ spec（親 draft に fixed 契約は不可・入出力の相互整合）
	for (const [id, c] of contracts) {
		const spec = specs.get(id);
		if (!spec) {
			err(c.file, `契約 "${id}" に対応する spec が無い`);
			continue;
		}
		if (c.status === "fixed" && spec.status === "draft")
			err(c.file, `親 spec が draft なのに契約が fixed（先に spec を fixed にする）: ${id}`);
		crossConsistency(id, spec, c);
	}
}

//  構造整合オラクル相当（ヒューリスティック・warn）:
//  機能詳細の入力名が契約本文に現れるか／異常状態に異常レスポンスが対応するか。
function crossConsistency(id, spec, c) {
	const contractText = (c.text || "").toLowerCase();
	for (const raw of spec.inputs) {
		const n = normName(raw);
		if (!n) continue;
		if (!contractText.includes(n))
			warn(c.file, `${id}: 機能詳細の入力 "${raw}" が契約に見当たらない`);
	}
	const hasAbnormalState = /error|権限|境界/.test(spec.statesText);
	if (hasAbnormalState && c.errorCount === 0)
		warn(c.file, `${id}: 機能詳細に異常状態があるが契約に errors が 1 件も無い`);
}

function cmdValidate(docsDir) {
	if (!existsSync(join(docsDir, "specs"))) {
		if (existsSync(join(docsDir, "spec"))) {
			console.error(
				`spec-lint: 旧レイアウト（${docsDir}/spec + ${docsDir}/contracts）を検出。` +
					`新レイアウト（${docsDir}/specs/F-xxx-<slug>/）へ移行するか、移行までは旧タグの harness を使う`,
			);
			return 1;
		}
		console.log(`spec-lint: ${docsDir}/specs が無いため検証をスキップ`);
		return 0;
	}
	validateRootDoc(join(docsDir, "PRD.md"), "prd");
	validateRootDoc(join(docsDir, "design.md"), "design");
	const model = loadModel(docsDir);
	crossChecks(model);
	report();
	return errors.length > 0 ? 1 : 0;
}

//  --- gate コマンド（draft なのに実装、を防ぐ） ---
function featureDir(docsDir, id) {
	const specsRoot = join(docsDir, "specs");
	if (!existsSync(specsRoot)) return null;
	const hit = readdirSync(specsRoot, { withFileTypes: true }).find(
		(d) => d.isDirectory() && (d.name === id || d.name.startsWith(id + "-")),
	);
	return hit ? join(specsRoot, hit.name) : null;
}

function gateFeature(docsDir, id) {
	const dir = featureDir(docsDir, id);
	if (!dir || !existsSync(join(dir, "spec.md"))) {
		err("gate", `${id}: 対応する spec が無い（docs/specs/${id}-<slug>/spec.md を作る）`);
		return;
	}
	const spec = parseFrontmatter(readFileSync(join(dir, "spec.md"), "utf8")).data;
	if (spec["ステータス"] !== "fixed")
		err("gate", `${id}: spec が fixed でない（draft のまま実装しない）`);
	//  契約は「存在し、かつ fixed」を要求する（契約なしのまま実装が進む事故を断つ）
	const contractFile = join(dir, "contract.yaml");
	if (!existsSync(contractFile)) {
		const legacy = join(dir, "api-contract.yaml");
		if (existsSync(legacy))
			err("gate", `${id}: 契約が旧フォーマットのまま（spec-lint convert --write で contract.yaml へ移行する）`);
		else err("gate", `${id}: 契約が無い（${basename(dir)}/contract.yaml を作り fixed にする）`);
		return;
	}
	const { root } = parseStrictYaml(readFileSync(contractFile, "utf8"));
	if (root["x-status"] !== "fixed")
		err("gate", `${id}: 契約が fixed でない（draft のまま実装しない）`);
}

function cmdGate(docsDir, opts) {
	let ids = [];
	if (opts.feature) {
		ids = [opts.feature];
	} else if (opts.message) {
		if (!existsSync(opts.message)) {
			console.error(`spec-lint gate: メッセージファイルが無い: ${opts.message}`);
			return 2;
		}
		const msg = readFileSync(opts.message, "utf8");
		ids = [...msg.matchAll(/^Feature:\s*(F-\d+)/gim)].map((m) => m[1]);
		if (ids.length === 0) {
			//  トレーラ未使用はオプトイン。素通り（未強制）。
			return 0;
		}
	} else {
		console.error("spec-lint gate: --message <file> か --feature F-xxx が要る");
		return 2;
	}
	for (const id of ids) gateFeature(docsDir, id);
	report();
	return errors.length > 0 ? 1 : 0;
}

//  --- convert コマンド（旧 OpenAPI 契約 → 新フォーマットの機械変換）---
//
//  AI に読ませて書き直させるのではなく機械的に写す。写せないもの
//  （owned の判別・description の行き先）は推測せず、要確認として列挙する。

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
const STATUS_TO_CODE = { 400: "INVALID_INPUT", 401: "FORBIDDEN", 403: "FORBIDDEN", 404: "NOT_FOUND" };

//  厳格サブセットの範囲で YAML を書き出す
function emitYaml(value, indent = 0) {
	const pad = " ".repeat(indent);
	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		return value
			.map((v) => {
				if (v !== null && typeof v === "object") {
					const inner = emitYaml(v, indent + 2);
					return `${pad}- ${inner.slice(indent + 2)}`;
				}
				return `${pad}- ${emitScalar(v)}`;
			})
			.join("\n");
	}
	if (value !== null && typeof value === "object") {
		const keys = Object.keys(value);
		if (keys.length === 0) return "{}";
		return keys
			.map((k) => {
				const v = value[k];
				if (v !== null && typeof v === "object" && (Array.isArray(v) ? v.length : Object.keys(v).length))
					return `${pad}${k}:\n${emitYaml(v, indent + 2)}`;
				if (v !== null && typeof v === "object") return `${pad}${k}: ${Array.isArray(v) ? "[]" : "{}"}`;
				return `${pad}${k}: ${emitScalar(v)}`;
			})
			.join("\n");
	}
	return `${pad}${emitScalar(value)}`;
}

function emitScalar(v) {
	if (v === null || v === undefined) return "null";
	if (typeof v === "boolean" || typeof v === "number") return String(v);
	const s = String(v);
	if (s === "") return '""';
	if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(s) || /:\s/.test(s) || /\s#/.test(s) || /^\s|\s$/.test(s))
		return `"${s.replace(/"/g, '\\"')}"`;
	return s;
}

//  parameters（path / query）と requestBody を 1 つの request にまとめる
function buildRequest(op, notes, label) {
	const props = {};
	const required = [];
	for (const p of op["parameters"] || []) {
		if (!isMap(p) || !p["name"]) continue;
		props[p["name"]] = p["schema"] || { type: "string" };
		if (p["required"] === true) required.push(p["name"]);
	}
	const body = isMap(op["requestBody"]) ? firstJsonSchema(op["requestBody"]["content"]) : null;
	if (body && isMap(body["properties"])) {
		Object.assign(props, body["properties"]);
		for (const r of body["required"] || []) required.push(r);
	} else if (body) {
		notes.push(`${label}: requestBody のスキーマが object でないため request をそのまま写した（要確認）`);
		return body;
	}
	if (Object.keys(props).length === 0) return undefined;
	const out = { type: "object" };
	if (required.length) out.required = [...new Set(required)];
	out.properties = props;
	return out;
}

function firstJsonSchema(content) {
	if (!isMap(content)) return null;
	const json = content["application/json"];
	if (isMap(json) && json["schema"]) return json["schema"];
	for (const k of Object.keys(content))
		if (isMap(content[k]) && content[k]["schema"]) return content[k]["schema"];
	return null;
}

function firstExampleValue(container) {
	if (!isMap(container)) return null;
	const ex = container["examples"];
	if (!isMap(ex)) return null;
	for (const k of Object.keys(ex)) if (isMap(ex[k]) && "value" in ex[k]) return ex[k]["value"];
	return null;
}

function convertContractDoc(root, notes, featureLabel) {
	const out = {};
	for (const k of ["x-feature-id", "x-status", "x-spec", "x-updated"])
		if (root[k] !== undefined) out[k] = root[k];

	const rootSecurity = root["security"];
	const operations = {};
	const paths = isMap(root["paths"]) ? root["paths"] : {};
	for (const path of Object.keys(paths)) {
		const item = paths[path];
		if (!isMap(item)) continue;
		for (const method of HTTP_METHODS) {
			const op = item[method];
			if (!isMap(op)) continue;
			const name =
				op["operationId"] ||
				`${method}${path.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))}`;
			const label = `${featureLabel} ${name}`;

			//  auth: security が [] なら none、名前があればその名前、未指定はルートを継ぐ
			const sec = op["security"] !== undefined ? op["security"] : rootSecurity;
			let auth = "none";
			if (Array.isArray(sec) && sec.length > 0 && isMap(sec[0])) auth = Object.keys(sec[0])[0] || "none";
			else if (sec === undefined) notes.push(`${label}: security の指定が無かったため auth: none とした（要確認）`);

			const responses = isMap(op["responses"]) ? op["responses"] : {};
			const successKey = Object.keys(responses).find((k) => /^2\d\d$/.test(String(k)));
			const converted = {
				transport: "http",
				direction: "outbound",
				owned: true,
				auth,
				summary: op["summary"] || "<何をするか 1 行>",
				wire: { method: method.toUpperCase(), path, success: successKey ? Number(successKey) : 200 },
			};
			if (!op["summary"]) notes.push(`${label}: summary が無いためプレースホルダを置いた`);

			const request = buildRequest(op, notes, label);
			if (request) converted.request = request;
			const response = successKey ? firstJsonSchema(responses[successKey]?.["content"]) : null;
			if (response) converted.response = response;

			//  異常系: examples の code を最優先、無ければステータスから引く
			const errors = [];
			const failureExamples = [];
			for (const statusKey of Object.keys(responses)) {
				if (!/^[45]\d\d$/.test(String(statusKey))) continue;
				const res = responses[statusKey];
				const sample = firstExampleValue(isMap(res) ? firstJsonContent(res["content"]) : null);
				let code = isMap(sample) && sample["code"] ? sample["code"] : STATUS_TO_CODE[Number(statusKey)];
				if (!code) {
					code = "INVALID_INPUT";
					notes.push(`${label}: ${statusKey} のエラーコードを判別できず INVALID_INPUT とした（要確認）`);
				}
				errors.push({
					code,
					when: (isMap(res) && res["description"]) || "<発生条件を 1 行>",
					wire: { status: Number(statusKey) },
				});
				if (isMap(sample)) failureExamples.push({ code, sample });
			}
			if (errors.length) converted.errors = errors;

			//  具体例
			const examples = {};
			const reqExample = firstExampleValue(isMap(op["requestBody"]) ? firstJsonContent(op["requestBody"]["content"]) : null);
			const resExample = successKey ? firstExampleValue(firstJsonContent(responses[successKey]?.["content"])) : null;
			if (reqExample !== null || resExample !== null) {
				examples.ok = {};
				if (reqExample !== null) examples.ok.request = reqExample;
				if (resExample !== null) examples.ok.response = resExample;
			}
			failureExamples.forEach((fx, i) => {
				examples[`ng${i + 1}`] = { error: fx.code };
			});
			if (Object.keys(examples).length) converted.examples = examples;
			if (root["x-status"] === "fixed" && !Object.keys(examples).some((k) => k.startsWith("ng")))
				notes.push(`${label}: 異常系の example が無い（fixed には正常 1 件＋異常 1 件が要る）`);

			if (op["description"]) notes.push(`${label}: operation.description を落とした（意味と規則は spec.md）`);
			operations[name] = converted;
		}
	}
	out.operations = operations;
	if (Object.keys(operations).length === 0)
		notes.push(`${featureLabel}: 操作が 1 つも無い（境界ゼロなら x-no-boundary に理由を書く）`);
	notes.push(`${featureLabel}: owned は全件 true で置いた（他社 API を叩く操作は false + source に直す）`);
	return out;
}

function firstJsonContent(content) {
	if (!isMap(content)) return null;
	return content["application/json"] || content[Object.keys(content)[0]] || null;
}

function convertSharedDoc(root, notes) {
	const comp = isMap(root["components"]) ? root["components"] : {};
	const out = { authSchemes: {}, errorCodes: {}, schemas: {} };
	for (const [name, def] of Object.entries(comp["securitySchemes"] || {})) {
		if (!isMap(def)) continue;
		if (def["type"] === "apiKey" && def["in"] === "cookie") out.authSchemes[name] = { kind: "cookie", name: def["name"] || name };
		else if (def["type"] === "apiKey") out.authSchemes[name] = { kind: "header", name: def["name"] || name };
		else if (def["type"] === "http") out.authSchemes[name] = { kind: "token", scheme: def["scheme"] === "bearer" ? "Bearer" : def["scheme"] || "Bearer" };
		else {
			out.authSchemes[name] = { kind: "token", scheme: "Bearer" };
			notes.push(`_shared: 認証スキーム "${name}"（type: ${def["type"]}）を token として写した（要確認）`);
		}
	}
	const schemas = isMap(comp["schemas"]) ? comp["schemas"] : {};
	const codeEnum = isMap(schemas["ErrorCode"]) && Array.isArray(schemas["ErrorCode"]["enum"]) ? schemas["ErrorCode"]["enum"] : [];
	for (const c of codeEnum) out.errorCodes[c] = "<このコードの意味を 1 行>";
	if (codeEnum.length > 0)
		notes.push(`_shared: errorCodes の意味（値）はプレースホルダのまま。1 行ずつ埋める`);
	if (codeEnum.length === 0) notes.push(`_shared: ErrorCode の enum が見つからず errorCodes を空にした（契約の code を集めて埋める）`);
	for (const [name, def] of Object.entries(schemas)) {
		if (name === "ErrorCode" || name === "Error") continue;
		out.schemas[name] = def;
	}
	notes.push(`_shared: Error / ErrorCode スキーマは新フォーマットの errorCodes に統合したため落とした`);
	return out;
}

function cmdConvert(docsDir, opts) {
	const specsRoot = join(docsDir, "specs");
	if (!existsSync(specsRoot)) {
		console.error(`spec-lint convert: ${specsRoot} が無い`);
		return 2;
	}
	const notes = [];
	const planned = [];

	const sharedFile = join(specsRoot, "_shared", "components.yaml");
	if (existsSync(sharedFile)) {
		const { root, problems } = parseStrictYaml(readFileSync(sharedFile, "utf8"), { lenient: true });
		for (const p of problems) console.warn(`  warn  ${sharedFile}:${p.line}: ${p.msg}`);
		if ("components" in root) {
			const header = [
				"# docs/specs/_shared/components.yaml — 契約の共有語彙（$ref 先）",
				"# 2 機能以上で使うものだけを置く（認証スキーム・エラーコード・共有 DTO）",
				"# 書き込むのは orchestrator のみ。producer は追記せず、追加したい語彙を報告する",
				"",
			].join("\n");
			planned.push({ file: sharedFile, text: `${header}\n${emitYaml(convertSharedDoc(root, notes))}\n` });
		} else {
			notes.push(`_shared: 既に新フォーマット（components が無い）のため変換しない`);
		}
	}

	for (const dir of readdirSync(specsRoot, { withFileTypes: true })
		.filter((d) => d.isDirectory() && d.name.startsWith("F-"))
		.map((d) => d.name)
		.sort()) {
		const legacy = join(specsRoot, dir, "api-contract.yaml");
		if (!existsSync(legacy)) continue;
		const { root, problems } = parseStrictYaml(readFileSync(legacy, "utf8"), { lenient: true });
		for (const p of problems) console.warn(`  warn  ${legacy}:${p.line}: ${p.msg}`);
		const header = [
			"# 機能の境界契約（1 機能 1 ファイル）",
			"# 同じディレクトリの spec.md と対で 1 機能の MIS（境界の形だけを持つ。振る舞いと規則は spec）",
			"# 判定は node .claude/tools/spec-lint/spec-lint.mjs validate（形式の理由は docs/adr/0001, 0002）",
			"",
		].join("\n");
		planned.push({
			file: join(specsRoot, dir, "contract.yaml"),
			from: legacy,
			text: `${header}\n${emitYaml(convertContractDoc(root, notes, dir))}\n`,
		});
	}

	if (planned.length === 0) {
		console.log("spec-lint convert: 変換対象が無い（旧フォーマットの契約は見つからなかった）");
		return 0;
	}

	for (const p of planned) {
		if (opts.write) {
			writeFileSync(p.file, p.text);
			console.log(`  書いた  ${p.file}${p.from ? `（元: ${p.from}）` : ""}`);
		} else {
			console.log(`  書く予定  ${p.file}${p.from ? `（元: ${p.from}）` : ""}`);
		}
	}
	console.log("");
	console.log("要確認（機械では埋められなかったもの）:");
	for (const n of notes) console.log(`  - ${n}`);
	console.log("");
	if (opts.write) {
		console.log("旧ファイルはこのコマンドでは消さない。差分を確認してから git rm する:");
		for (const p of planned) if (p.from) console.log(`  git rm ${p.from}`);
	} else {
		console.log("実際に書くには --write を付ける。");
	}
	return 0;
}

//  --- 出力 ---
function report() {
	for (const w of warns) console.warn(`  warn  ${w.file}: ${w.msg}`);
	for (const e of errors) console.error(`  ERROR ${e.file}: ${e.msg}`);
	if (errors.length === 0) console.log(`spec-lint: OK（warn ${warns.length}）`);
	else console.error(`spec-lint: ${errors.length} 件の違反`);
}

//  --- 引数 ---
function parseArgs(argv) {
	const opts = { docs: "docs" };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--docs") opts.docs = argv[++i];
		else if (argv[i] === "--write") opts.write = true;
		else if (argv[i] === "--message") opts.message = argv[++i];
		else if (argv[i] === "--feature") opts.feature = argv[++i];
	}
	return opts;
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const opts = parseArgs(rest);
	if (cmd === "validate" || cmd === undefined) process.exit(cmdValidate(opts.docs));
	if (cmd === "gate") process.exit(cmdGate(opts.docs, opts));
	if (cmd === "convert") process.exit(cmdConvert(opts.docs, opts));
	console.error(
		"usage: spec-lint.mjs validate|gate|convert [--docs docs] [--message f] [--feature F-001] [--write]",
	);
	process.exit(2);
}

main();
