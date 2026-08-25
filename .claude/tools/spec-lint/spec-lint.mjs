#!/usr/bin/env node
//
//  spec-lint — docs SSOT のフォーマット / ライフサイクル検証（harness 同梱ツール）
//
//  検証対象のレイアウト（rules/develop/docs.md §10）:
//    docs/00-vision.md  01-glossary.md  02-actors.md            単票（VISION / GLOSSARY / ACTORS）
//    docs/goals-backlog.md                                       【任意】未着手ゴール
//    docs/design.md                                              【任意】How の現在形
//    docs/goals/GOAL-nn-<slug>/GOAL.md                           ゴール（1 ID 1 ファイル）
//    docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/UC.md               ユースケース（＝縦スライスの単位）
//    docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/REQ-nnn.md          要件（EARS 1 文 + 検証方針）
//    docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/contract.yaml       UC の境界契約（harness 独自 YAML）
//    docs/rules/BR-nnn.md  docs/nfr/NFR-nnn.md  docs/adr/ADR-nnnn-<slug>.md   横断（中央）
//    docs/verification/GLOBAL.md                                 【任意】全体の検証除外
//    docs/_shared/components.yaml                                契約の共有語彙（$ref 先）
//
//  書式の SSOT は .claude/templates/develop/ のテンプレート。必須フロントマター・必須セクション・
//  契約の必須 x- キーはテンプレートから導出する（書式改定はテンプレートを直せば lint も追従する。
//  テンプレートで「# optional」と注記されたキーだけ任意）。閉じた語彙（status / phase / pattern /
//  transport / direction）は実行コードでしか強制できないため本ツールが持つ。
//  トレーサビリティ（被覆・参照・配置の整合 C1–C13）は tools/trace-check の仕事で、ここでは見ない。
//
//  契約フォーマットの判断は docs/adr/ADR-0001（OpenAPI をやめた理由）と
//  docs/adr/ADR-0002（パーサを自前実装し YAML を厳格サブセットに限る理由）。
//
//  使い方:
//    node spec-lint.mjs validate [--docs docs]      全 docs を検証（フォーマット＋ライフサイクル不変条件）
//        [--ignore-legacy-layout]                   旧レイアウト（docs/specs/）が残っていても新レイアウト側の検査を続ける（移行中）
//        [--update-baseline] [--strict] [--baseline .spec-baseline.json]
//                                                   trace-check と同じ baseline ラチェット。既知の違反を台帳化し、以降は新規違反だけ落とす
//    node spec-lint.mjs gate --message <file>       commit メッセージの UC: トレーラの UC が実装可能か検証（baseline は見ない）
//    node spec-lint.mjs gate --uc UC-012            指定 UC が実装可能（UC / REQ が active・契約 fixed）か検証
//    node spec-lint.mjs convert <openapi.yaml> [--uc UC-012] [--direction outbound|inbound] [--out contract.yaml]
//                                                   旧 OpenAPI 3.x 契約を harness 契約へ機械変換する（形を保つだけ。判断は注記で返す）
//
//  終了コード: 0=OK / 1=違反あり / 2=使い方エラー
//

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "develop");

//  テンプレートのプレースホルダ。draft を抜けた成果物に残っていたら違反
const SENTINELS = ["GOAL-00", "UC-000", "REQ-000", "BR-000", "NFR-000", "ADR-0000", "ACT-00", "KPI-00", "YYYY-MM-DD"];
const GOAL_DIR_RE = /^GOAL-\d+-[a-z0-9-]+$/;
const UC_DIR_RE = /^UC-\d+-[a-z0-9-]+$/;
const ADR_FILE_RE = /^ADR-\d+-[a-z0-9-]+\.md$/;

//  --- 閉じた語彙（実行コードでしか強制できないため本ツールが正）---
const NODE_STATUS = ["draft", "active", "withdrawn"]; //  GOAL / UC / REQ / BR / NFR。active ＝ 人間が承認した
const SINGLETON_STATUS = ["draft", "frozen", "living"]; //  vision / glossary / actors / backlog / GLOBAL
const ADR_STATUS = ["proposed", "accepted", "superseded"];
const CONTRACT_STATUS = ["draft", "fixed"]; //  fixed ＝ 構造オラクル不整合ゼロで orchestrator が凍結した
const PHASES = ["定義", "構造", "実装", "検証", "完了"]; //  UC.md の phase:（工程台帳。orchestrator だけが進める）
const EARS_PATTERNS = ["Ubiquitous", "Event-driven", "State-driven", "Unwanted behaviour", "Optional"];
const POLICY = "検証方針"; //  REQ の検証方針セクション（所有者は test-designer。中身の判定は trace-check C2/C10）
const isSettled = (s) => !!s && s !== "draft" && s !== "proposed";

//  --- 肥大の閾値（本ツールが唯一の SSOT。producer craft に数値を書き写さない）---
//  UC.md と REQ は 1 スライスで producer / oracle の全員が別コンテキストで全文を読むため、
//  分量はそのまま全エージェントのコンテキスト＝コストになる（R-1005: 1 ファイルおおむね 100 行）。
const MAX_UC_CHARS = 8000; //  UC.md 本文の文字数（行数では 1 行 1,000 字の肥大を見逃す）
const MAX_REQ_CHARS = 2500; //  REQ 本文（EARS 1 文 + 検証方針）
const MAX_BR_CHARS = 2500; //  BR 本文（存在と意図だけ。値は R-102 で機械可読側へ）
const MAX_EARS_CHARS = 200; //  EARS 文 1 本の長さ（超えるのは複数要件の圧縮 / R-401）
const MAX_UC_CROSS_REFS = 10; //  UC.md 内の他 UC 参照数（複製の密度）
const MAX_CONTRACT_LINES = 400; //  契約 YAML は 1 行 1 キーの ASCII なので行数で測る

//  --- 収集した違反 ---
const errors = [];
const warns = [];
const err = (file, msg) => errors.push({ file, msg });
const warn = (file, msg) => warns.push({ file, msg });

//  --- パーサ ---
function parseFrontmatter(text) {
	const lines = text.split(/\r?\n/);
	if (lines[0] !== "---") return { data: {}, body: text, hasFm: false, raw: [] };
	const data = {};
	const raw = [];
	let i = 1;
	for (; i < lines.length; i++) {
		if (lines[i] === "---") {
			i++;
			break;
		}
		raw.push(lines[i]);
		const m = lines[i].match(/^([^:#]+):\s*(.*)$/);
		if (m) data[m[1].trim()] = m[2].replace(/\s+#.*$/, "").trim(); //  行末の "# コメント" を除去
	}
	return { data, body: lines.slice(i).join("\n"), hasFm: true, raw };
}

function getSections(body) {
	const secs = [];
	let cur = null;
	for (const line of body.split(/\r?\n/)) {
		const m = line.match(/^##\s+(.*)$/);
		if (m) {
			cur = { title: m[1].trim(), lines: [] };
			secs.push(cur);
		} else if (cur) cur.lines.push(line);
	}
	return secs;
}

//  HTML コメント（テンプレートのガイダンス）を除いた実質の有無
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
//  コード（``` ブロックと `...` スパン）を除く。中の <...> や日付は雛形の穴でも経緯でもない
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
//  YAML の行末コメントを除く（契約のガイダンスコメントを検査対象にしない）
const stripYamlComments = (s) => s.split(/\r?\n/).map(stripComment).join("\n");
const sectionFilled = (sec) => stripComments(sec.lines.join("\n")).split("\n").some((l) => l.trim().length > 0);
const findSection = (body, test) => getSections(body).find((s) => test(s.title));
const sectionKey = (title) => title.split(/[\s（(]/)[0];

//  マークダウン表の行をセル配列で返す（区切り行は除外。ヘッダは先頭要素）
function tableRows(lines) {
	const rows = [];
	for (const line of lines) {
		const t = line.trim();
		if (!t.startsWith("|")) continue;
		const cells = t.split("|").slice(1, -1).map((c) => c.trim());
		if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
		rows.push(cells);
	}
	return rows;
}

//  文頭の blockquote 段落（連続する > 行のかたまり）を数える
function blockquoteParagraphs(text) {
	const paras = [];
	let cur = null;
	for (const line of text.split(/\r?\n/)) {
		if (line.trim().startsWith(">")) {
			if (!cur) paras.push((cur = []));
			cur.push(line.replace(/^\s*>\s?/, ""));
		} else cur = null;
	}
	return paras.map((p) => p.join(" ").trim());
}

//  --- テンプレートからの書式導出（fallback はテンプレート欠落時のみ）---
//  必須キー ＝ フロントマターのキー。行末コメントに optional とあれば任意。
//  必須セクション ＝ ## 見出しの先頭語（空白・括弧の前まで）。
function deriveDocFormat(name, fallback) {
	const file = join(TEMPLATE_DIR, name);
	if (!existsSync(file)) return fallback;
	const { raw, body } = parseFrontmatter(readFileSync(file, "utf8"));
	const required = [];
	const optional = [];
	for (const line of raw) {
		const m = line.match(/^([^:#]+):\s*(.*)$/);
		if (!m) continue;
		(/#.*\boptional\b/.test(m[2]) ? optional : required).push(m[1].trim());
	}
	const sections = getSections(body).map((s) => sectionKey(s.title));
	if (required.length === 0) return fallback;
	return { required, optional, sections };
}

function deriveContractKeys() {
	const file = join(TEMPLATE_DIR, "contract.yaml");
	const fallback = ["x-uc", "x-status", "x-spec", "x-updated"];
	if (!existsSync(file)) return fallback;
	const keys = [];
	for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
		const m = line.match(/^(x-[\w-]+):/);
		if (m) keys.push(m[1]);
	}
	return keys.length > 0 ? keys : fallback;
}

const FORMATS = {
	vision: deriveDocFormat("00-vision.md", { required: ["id", "status"], optional: [], sections: ["解決する課題", "対象ユーザー", "成功の定義", "やらないこと"] }),
	glossary: deriveDocFormat("01-glossary.md", { required: ["id", "status"], optional: [], sections: [] }),
	actors: deriveDocFormat("02-actors.md", { required: ["id", "status"], optional: [], sections: ["アクター一覧"] }),
	backlog: deriveDocFormat("goals-backlog.md", { required: ["id", "status"], optional: [], sections: [] }),
	global: deriveDocFormat("verification-GLOBAL.md", { required: ["id", "status"], optional: [], sections: ["検証しない範囲"] }),
	goal: deriveDocFormat("GOAL.md", { required: ["id", "actor", "origin", "status"], optional: [], sections: [] }),
	uc: deriveDocFormat("UC.md", { required: ["id", "title", "actor", "goal", "status", "phase"], optional: [], sections: ["概要", "事前条件", "主シナリオ", "状態", "例外系の走査", "事後条件"] }),
	req: deriveDocFormat("REQ.md", { required: ["id", "pattern", "uc", "status"], optional: ["br"], sections: [POLICY] }),
	br: deriveDocFormat("BR.md", { required: ["id", "title", "enforced_at", "status"], optional: [], sections: [] }),
	nfr: deriveDocFormat("NFR.md", { required: ["id", "category", "status"], optional: [], sections: [] }),
	adr: deriveDocFormat("ADR.md", { required: ["id", "title", "status", "date"], optional: ["supersedes"], sections: ["Context", "Decision", "Consequences", "却下した選択肢"] }),
};

//  --- 共通チェック ---

//  テンプレート由来の <...> プレースホルダの全集合（テンプレートの HTML コメント内は除く）。
//  これに一致する文字列は無条件に「雛形の穴」。それ以外の <非ASCII> は下の密着判定で絞る
const TEMPLATE_PLACEHOLDERS = (() => {
	const set = new Set();
	if (!existsSync(TEMPLATE_DIR)) return set;
	for (const name of readdirSync(TEMPLATE_DIR)) {
		if (!/\.(md|yaml)$/.test(name)) continue;
		const text = stripComments(readFileSync(join(TEMPLATE_DIR, name), "utf8"));
		for (const a of text.match(/<[^>\n]{1,60}>/g) || []) if (/[^\x00-\x7F]/.test(a)) set.add(a);
	}
	return set;
})();

function checkSentinels(file, text, status) {
	if (!isSettled(status)) return;
	//  HTML コメント・コード・YAML コメントの中は見ない（ガイダンスの転記や `<code>` の記法は穴ではない）
	const plain = stripCode(stripComments(/\.ya?ml$/.test(file) ? stripYamlComments(text) : text));
	for (const s of SENTINELS) {
		if (new RegExp(`\\b${s}\\b`).test(plain)) err(file, `${status} なのにテンプレのプレースホルダが残っている: "${s}"`);
	}
	for (const m of plain.matchAll(/<[^>\n]{1,60}>/g)) {
		const a = m[0];
		if (!/[^\x00-\x7F]/.test(a)) continue; //  HTML タグ等の ASCII は対象外
		//  テンプレートにある文字列はそのまま穴。それ以外は、直後が単語に密着していないものだけ
		//  （`<言語>.lproj` のようなメタ変数の用法は穴ではない）
		const after = plain[m.index + a.length] || "";
		if (TEMPLATE_PLACEHOLDERS.has(a) || !/[A-Za-z0-9_.\/-]/.test(after)) {
			err(file, `${status} なのにプレースホルダが残っている: "${a}"`);
			break;
		}
	}
}

function checkStatus(file, s, vocab, label = "status") {
	if (!s) {
		err(file, `${label} が無い`);
		return null;
	}
	if (!vocab.includes(s)) err(file, `${label} は ${vocab.join("|")} のいずれか。実際: "${s}"`);
	return s;
}

function checkRequiredFm(file, data, keys) {
	for (const k of keys) if (!data[k] || data[k].length === 0) err(file, `フロントマター "${k}" が空/欠落`);
}

//  必須セクションの存在と、draft を抜けた文書での空セクション
function checkSections(file, body, required, status, opts = {}) {
	const secs = getSections(body);
	for (const key of required) {
		const found = secs.find((s) => sectionKey(s.title) === key || s.title.startsWith(key));
		if (!found) err(file, `必須セクション "${key}" が無い`);
		else if (isSettled(status) && !(opts.skipEmpty || []).includes(key) && !sectionFilled(found))
			err(file, `${status} なのにセクション "${key}" が空`);
	}
}

//  --- docs 衛生（負のリスト混入の検出。SSOT は各 producer craft）---
//  すべて warn（既存プロジェクトの validate を err で即死させない）。
function checkHygiene(file, body, kind, opts = {}) {
	const lines = body.split(/\r?\n/);
	const plain = stripComments(body);
	//  REQ の検証方針は「参照先」「値の SSOT は <path>」を書く正規の場所なので、アンカー系の検査は要件文の側だけに掛ける
	const policyIdx = kind === "req" ? plain.indexOf(`## ${POLICY}`) : -1;
	const head = policyIdx >= 0 ? plain.slice(0, policyIdx) : plain;

	//  1) 本文中の日付括弧: 「（2026-07-26 改訂）」のような経緯の追記痕。
	//     日付の直後に助詞が続く「（2026-02-29 は不正）」は検証値の記述なので対象外。コード内も見ない
	const dates = stripCode(plain).match(/[（(]\d{4}-\d{2}-\d{2}(?!\s*[はがをもとのに])/g) || [];
	if (dates.length > 0) warn(file, `本文中に日付括弧の経緯記述が ${dates.length} 件（経緯は git が持つ。本文は現在形に統合する）`);

	if (kind === "uc" || kind === "req") {
		//  2) 実装アンカー: コード側ファイルへのパス／行番号参照（コードが SSOT。BR は「値の SSOT は <path>」を書くため対象外）
		const anchors = head.match(/[\w./-]+\.(php|js|ts|jsx|tsx|sql|mjs|cjs|py|rb|go|java|swift|kt)\b(:\d+(-\d+)?)?/g) || [];
		if (anchors.length > 0) warn(file, `実装アンカーが ${anchors.length} 件（例: ${anchors[0]}）— コードが SSOT。docs に書かない`);

		//  3) framework 内部 API への言及（クラス::メソッド 形式）
		const internal = head.match(/\w+::\w+/g) || [];
		if (internal.length > 0) warn(file, `内部 API 参照が ${internal.length} 件（例: ${internal[0]}）— 観測可能な振る舞いの語彙で書く`);

		//  4) 未決の堆積セクション
		for (const s of getSections(body))
			if (/既知の課題|残存リスク|バックログ/.test(s.title)) warn(file, `セクション「${s.title}」— 未解決論点・リスクは issue 管理へ排出する`);
	}

	//  5) 肥大の煙探知機（行数でなく文字数）
	if (kind === "uc" && plain.length > MAX_UC_CHARS)
		warn(file, `本文が ${plain.length} 文字（${MAX_UC_CHARS} 文字超）— 1 UC を超えた堆積の疑い。全 producer / oracle が全文を読む（R-503 の粒度・R-1005 を見直す）`);
	if (kind === "req" && plain.length > MAX_REQ_CHARS)
		warn(file, `本文が ${plain.length} 文字（${MAX_REQ_CHARS} 文字超）— 検証方針にケースの前提・操作・期待値を書いていないか（R-601 / R-604）`);
	if (kind === "br" && plain.length > MAX_BR_CHARS)
		warn(file, `本文が ${plain.length} 文字（${MAX_BR_CHARS} 文字超）— 値・列挙は機械可読側へ（R-102）。ここは存在と意図だけ`);

	//  6) UC の他 UC 参照密度（参照先の振る舞いを複製していないか）
	if (kind === "uc") {
		const selfId = opts.selfId || "";
		const refs = (plain.match(/\bUC-\d+\b/g) || []).filter((r) => r !== selfId);
		if (refs.length > MAX_UC_CROSS_REFS)
			warn(file, `他 UC への参照が ${refs.length} 件（${MAX_UC_CROSS_REFS} 件超）— 参照先の振る舞いを複製していないか。共通の規則は BR へ括り出す（R-105）`);
	}

	if (kind === "contract") {
		//  業務ルールの契約への書き戻し（MIS 逸脱の煙探知機）
		const dumpKeys = body.match(/^\s+x-(state-transition|evaluation-order|error-catalog|business-rule|internal-labels)\b/gm) || [];
		if (dumpKeys.length > 0)
			warn(file, `業務ルール再掲らしき x-* が ${dumpKeys.length} 件（例: ${dumpKeys[0].trim()}）— 規則・判定順序は UC / REQ / BR。契約は境界の形だけ`);
		const longDescs = countLongDescriptions(lines);
		if (longDescs > 0) warn(file, `長い description が ${longDescs} 件（8 行超または 200 字超）— 目的・規則・UI 説明は UC / REQ。契約は summary 1 行と短い注記のみ`);
		if (lines.length > MAX_CONTRACT_LINES) warn(file, `本文が ${lines.length} 行（${MAX_CONTRACT_LINES} 行超）— 1 UC を超えた堆積の疑い（負のリスト該当を排出する）`);
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
		} else if (rest.length > 200) count++;
	}
	return count;
}

//  --- 各文書の検証 ---

//  単票（vision / glossary / actors / backlog / GLOBAL）
function validateSingleton(file, kind, expectedId, required) {
	if (!existsSync(file)) {
		if (required) warn(file, `${basename(file)} が無い（テンプレート templates/develop/${basename(file) === "GLOBAL.md" ? "verification-GLOBAL.md" : basename(file)} 参照）`);
		return null;
	}
	const fmt = FORMATS[kind];
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	checkRequiredFm(file, data, fmt.required);
	if (data.id && data.id !== expectedId) err(file, `id は ${expectedId}。実際: "${data.id}"`);
	const status = checkStatus(file, data.status, SINGLETON_STATUS);
	checkSections(file, body, fmt.sections, status);
	checkSentinels(file, body, status);
	checkHygiene(file, body, "singleton");
	return { status };
}

function validateGoal(file, dirId) {
	const fmt = FORMATS.goal;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	checkRequiredFm(file, data, fmt.required);
	const status = checkStatus(file, data.status, NODE_STATUS);
	if (data.id && dirId && data.id !== dirId) err(file, `id "${data.id}" がディレクトリ名の ID "${dirId}" と不一致`);
	if (isSettled(status) && blockquoteParagraphs(body).length === 0) err(file, `${status} なのにゴール文（> で始まる 1 文）が無い`);
	checkSentinels(file, body, status);
	return { id: data.id || dirId, status };
}

function validateUC(file, dirId) {
	const fmt = FORMATS.uc;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	checkRequiredFm(file, data, fmt.required);
	const status = checkStatus(file, data.status, NODE_STATUS);
	if (data.phase && !PHASES.includes(data.phase)) err(file, `phase は ${PHASES.join("|")} のいずれか。実際: "${data.phase}"`);
	if (data.id && dirId && data.id !== dirId) err(file, `id "${data.id}" がディレクトリ名の ID "${dirId}" と不一致`);
	checkSections(file, body, fmt.sections, status);
	checkSentinels(file, body, status);
	checkHygiene(file, body, "uc", { selfId: data.id || "" });

	//  状態 × イベント表: 全セルを埋める（R-501。空セル＝仕様の穴）
	const stateSec = findSection(body, (t) => t.startsWith("状態"));
	const stateRows = stateSec ? tableRows(stateSec.lines) : [];
	if (isSettled(status) && stateSec) {
		if (stateRows.length < 2) err(file, `${status} なのに状態 × イベント表にデータ行が無い（R-501）`);
		stateRows.slice(1).forEach((cells, i) => {
			const empty = cells.slice(1).some((c) => c === "");
			if (empty) err(file, `状態 × イベント表の ${i + 1} 行目（${cells[0]}）に空セルがある — 不可なら「不可: 理由」を書く（R-501: 空セル＝仕様の穴）`);
		});
	}
	//  例外系の走査: 4 分類の行が揃っているか（R-502）
	const excSec = findSection(body, (t) => t.startsWith("例外系"));
	const excRows = excSec ? tableRows(excSec.lines).slice(1) : [];
	if (isSettled(status) && excSec) {
		for (const axis of ["権限", "不変条件違反", "並行性", "外部依存"])
			if (!excRows.some((r) => r[0] === axis)) err(file, `例外系の走査に「${axis}」の行が無い（R-502: 4 分類を全て走査する）`);
	}
	//  「なし（対象外）」「なし: ADR-0033」のように理由付きの「なし」も導出なしと読む（先頭一致）
	const hasExceptionDerivation = excRows.some((r) => r.slice(1).some((c) => c && !/^(なし|—|-)/.test(c)));
	return { id: data.id || dirId, status, phase: data.phase || null, goal: data.goal || null, hasExceptionDerivation };
}

function validateReq(file, ucDirId) {
	const fmt = FORMATS.req;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	const stem = basename(file, ".md");
	checkRequiredFm(file, data, fmt.required);
	const status = checkStatus(file, data.status, NODE_STATUS);
	if (data.id && data.id !== stem) err(file, `id "${data.id}" がファイル名 "${stem}" と不一致（R-1001）`);
	if (data.pattern && !EARS_PATTERNS.includes(data.pattern)) err(file, `pattern は ${EARS_PATTERNS.join(" | ")} のいずれか。実際: "${data.pattern}"（R-402）`);
	if (data.uc && ucDirId && data.uc !== ucDirId) err(file, `uc "${data.uc}" が配置ディレクトリの UC "${ucDirId}" と不一致（R-1007）`);
	if (data.br && !/^BR-\d+(\s*,\s*BR-\d+)*$/.test(data.br)) err(file, `br は BR-nnn（複数はカンマ区切り）。実際: "${data.br}"`);

	//  EARS 文: 検証方針の前に blockquote 段落がちょうど 1 つ（R-401: 1 要件 1 文）
	const policyIdx = body.indexOf(`## ${POLICY}`);
	const head = policyIdx >= 0 ? body.slice(0, policyIdx) : body;
	const paras = blockquoteParagraphs(stripComments(head));
	if (paras.length === 0) err(file, `要件文（> で始まる EARS 1 文）が無い（R-401）`);
	else if (paras.length > 1) err(file, `要件文の blockquote が ${paras.length} 段落ある — 1 要件 1 文。別の要件は別の REQ へ（R-401）`);
	else if (paras[0].length > MAX_EARS_CHARS) warn(file, `要件文が ${paras[0].length} 文字（${MAX_EARS_CHARS} 文字超）— 複数の要件の圧縮ではないか（R-401）`);

	//  検証方針の中身は test-designer が後から埋める（trace-check C2 / C10 が判定）。ここでは見出しの存在だけ
	checkSections(file, body, fmt.sections, status, { skipEmpty: [POLICY] });
	checkSentinels(file, head, status);
	checkHygiene(file, body, "req");
	return { id: data.id || stem, status, uc: data.uc || null };
}

function validateBR(file) {
	const fmt = FORMATS.br;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	const stem = basename(file, ".md");
	checkRequiredFm(file, data, fmt.required);
	const status = checkStatus(file, data.status, NODE_STATUS);
	if (data.id && data.id !== stem) err(file, `id "${data.id}" がファイル名 "${stem}" と不一致（R-1001）`);
	checkSections(file, body, fmt.sections, status);
	checkSentinels(file, body, status);
	checkHygiene(file, body, "br");
	if (isSettled(status) && !/\*\*意図\*\*/.test(body)) warn(file, `「**意図**」が無い — 規則は存在と意図を書く（KPI / GOAL との接続）`);
	return { id: data.id || stem, status };
}

function validateNFR(file) {
	const fmt = FORMATS.nfr;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	const stem = basename(file, ".md");
	checkRequiredFm(file, data, fmt.required);
	const status = checkStatus(file, data.status, NODE_STATUS);
	if (data.id && data.id !== stem) err(file, `id "${data.id}" がファイル名 "${stem}" と不一致（R-1001）`);
	checkSections(file, body, fmt.sections, status);
	checkSentinels(file, body, status);
	if (isSettled(status) && blockquoteParagraphs(stripComments(body)).length === 0) err(file, `${status} なのに要件文（> で始まる 1 文）が無い`);
	if (isSettled(status) && !/測定/.test(stripComments(body))) warn(file, `測定方法の記述が見当たらない — 測定できない NFR は書かない（R-104）`);
	return { id: data.id || stem, status };
}

function validateADR(file) {
	const fmt = FORMATS.adr;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	const name = basename(file);
	checkRequiredFm(file, data, fmt.required);
	const status = checkStatus(file, data.status, ADR_STATUS);
	if (!ADR_FILE_RE.test(name)) err(file, `ファイル名は ADR-nnnn-<slug>.md（slug は小文字ケバブ）`);
	const prefix = (name.match(/^ADR-\d+/) || [null])[0];
	if (data.id && prefix && data.id !== prefix) err(file, `id "${data.id}" がファイル名の ID "${prefix}" と不一致`);
	if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) err(file, `date は YYYY-MM-DD。実際: "${data.date}"`);
	if (data.supersedes && !/^ADR-\d+$/.test(data.supersedes)) err(file, `supersedes は ADR-nnnn。実際: "${data.supersedes}"`);
	checkSections(file, body, fmt.sections, status);
	checkSentinels(file, body, status);
	return { id: data.id || prefix, status, supersedes: data.supersedes || null };
}

//  --- 厳格サブセット YAML パーサ（判断の理由は docs/adr/0002）---
//
//  受理するのはマップ / シーケンス / フロー記法 / スカラ / コメントのみ。
//  アンカー・エイリアス（& / *）と複数行スカラ（| / >）は構文エラーにする。
//  共有は _shared/components.yaml を通す・長い散文は UC.md / REQ に置く、という
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
					ctx.reject(row.no, `複数行スカラ "${rest}" は使えない（長い散文は UC.md / REQ に置く）`);
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

//  --- 契約 contract.yaml の検証（UC ディレクトリ直下。x-uc がディレクトリの ID と一致すること）---

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
			`旧フォーマット（OpenAPI）の契約を検出。/docs-migrate で harness 形式（docs/adr/ADR-0001）へ移行する`,
		);
		return { id: root["x-uc"] || dirId, status: null, errorCount: 0, legacy: true, text };
	}

	for (const k of xKeys) {
		const v = root[k];
		if (v === undefined || v === null || String(v).length === 0)
			err(at(lineOf(root, k)), `必須キー "${k}" が空/欠落`);
	}
	//  欠落は上の必須キー検査が既に出しているので、ここでは値の妥当性だけを見る
	const status = root["x-status"]
		? checkStatus(at(lineOf(root, "x-status")), root["x-status"], CONTRACT_STATUS, "x-status")
		: null;
	const id = root["x-uc"] || null;
	if (id && dirId && id !== dirId)
		err(at(lineOf(root, "x-uc")), `x-uc "${id}" がディレクトリ名の ID "${dirId}" と不一致`);

	if (root["x-spec"]) {
		const target = join(dirname(file), String(root["x-spec"]));
		if (!existsSync(target)) err(at(lineOf(root, "x-spec")), `x-spec が解決しない: ${root["x-spec"]}`);
	}

	const ops = root["operations"];
	if (ops === undefined) {
		err(file, `トップレベル "operations:" が無い（境界が無い UC は operations: {} と x-no-boundary で宣言する）`);
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

		//  エラー。errors: [] は「失敗経路を持たない」の宣言（省略とは区別する。auth の none と同じ流儀）
		const errs = op["errors"];
		const codes = [];
		const noFailures = Array.isArray(errs) && errs.length === 0;
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
				err(fieldAt("examples"), `${label}: fixed なのに examples が無い（正常 1 件${noFailures ? "" : "＋異常 1 件以上"}の実値）`);
			} else {
				const cases = Object.entries(ex);
				const ok = cases.filter(([, c]) => isMap(c) && c["error"] === undefined);
				const ng = cases.filter(([, c]) => isMap(c) && c["error"] !== undefined);
				if (ok.length === 0) err(fieldAt("examples"), `${label}: examples に正常系が無い`);
				if (ng.length === 0 && !noFailures) err(fieldAt("examples"), `${label}: examples に異常系（error: <code>）が無い（失敗経路が本当に無いなら errors: [] と宣言する）`);
				for (const [caseName, c] of ng)
					if (!codes.includes(c["error"]))
						err(
							fieldAt("examples"),
							`${label}: examples.${caseName} の error "${c["error"]}" がこの操作の errors に無い`,
						);
				//  例のキーが request の properties と噛み合っているか。
				//  異常系（error: を持つ例）は「望まれない入力」なので、禁じたキーを含む反例を許す（未知キー・必須欠落とも検査しない）
				const props = isMap(op["request"]) && isMap(op["request"]["properties"]) ? op["request"]["properties"] : null;
				const required = isMap(op["request"]) && Array.isArray(op["request"]["required"]) ? op["request"]["required"] : [];
				if (props)
					for (const [caseName, c] of cases) {
						if (!isMap(c) || !isMap(c["request"]) || c["error"] !== undefined) continue;
						for (const k of Object.keys(c["request"]))
							if (!(k in props))
								err(fieldAt("examples"), `${label}: examples.${caseName}.request の "${k}" が request.properties に無い`);
						for (const k of required)
							if (!(k in c["request"]))
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

//  --- 共有語彙 docs/_shared/components.yaml ---
function loadShared(docsDir) {
	const file = join(docsDir, "_shared", "components.yaml");
	if (!existsSync(file)) {
		warn(file, `共有語彙 components.yaml が無い（テンプレート templates/develop/components.yaml 参照）`);
		return { file, authSchemes: {}, errorCodes: {} };
	}
	const text = readFileSync(file, "utf8");
	const { root, problems } = parseStrictYaml(text);
	for (const p of problems) err(`${file}:${p.line}`, p.msg);
	if ("components" in root && !("errorCodes" in root))
		err(file, `旧フォーマット（OpenAPI components）の共有語彙を検出。/docs-migrate で authSchemes / errorCodes へ移行する`);
	const authSchemes = isMap(root["authSchemes"]) ? root["authSchemes"] : root["authSchemes"] === null ? {} : null;
	const errorCodes = isMap(root["errorCodes"]) ? root["errorCodes"] : null;
	if (authSchemes === null) err(file, `"authSchemes" が無い（使わないなら authSchemes: {} と書く）`);
	if (errorCodes === null) err(file, `"errorCodes" が無い（契約の errors[].code はここに閉じる）`);
	return { file, authSchemes: authSchemes || {}, errorCodes: errorCodes || {} };
}

//  --- design.md（任意ファイル・warn 中心）---
function validateDesign(file) {
	if (!existsSync(file)) return;
	const { data, body } = parseFrontmatter(readFileSync(file, "utf8"));
	if (!data["ステータス"] || !data["更新日"]) warn(file, `フロントマター（ステータス/更新日）が無い`);
	if (/Given|When|Then|受け入れ条件/.test(body)) warn(file, `GWT/受け入れ条件らしき記述がある — 振る舞いは docs/goals/**/REQ-nnn.md へ`);
}

//  --- validate コマンド ---
const listDirs = (dir) =>
	existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
const listFiles = (dir, re) =>
	existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && re.test(d.name)).map((d) => join(dir, d.name)).sort() : [];

function loadModel(docsDir) {
	const goalsRoot = join(docsDir, "goals");
	const xKeys = deriveContractKeys();
	const shared = loadShared(docsDir);
	const goals = new Map(); //  id -> { file, status }
	const ucs = new Map(); //  id -> { file, dir, status, phase, goal, hasExceptionDerivation, reqs: [] }
	const contracts = new Map(); //  id -> { file, status, errorCount, text }

	for (const gname of listDirs(goalsRoot)) {
		if (gname.startsWith("_") || gname.startsWith(".")) continue;
		const gdir = join(goalsRoot, gname);
		const gid = (gname.match(/^GOAL-\d+/) || [null])[0];
		if (!GOAL_DIR_RE.test(gname)) err(gdir, `ディレクトリ名が GOAL-nn-<slug>（slug は小文字ケバブ）でない`);
		const gfile = join(gdir, "GOAL.md");
		if (!existsSync(gfile)) err(gdir, `GOAL.md が無い（ゴールディレクトリには必須 / R-1006）`);
		else {
			const g = validateGoal(gfile, gid);
			if (g.id) {
				if (goals.has(g.id)) err(gfile, `GOAL "${g.id}" が重複（${goals.get(g.id).file} と）`);
				else goals.set(g.id, { file: gfile, ...g });
			}
		}
		for (const f of listFiles(gdir, /^(UC|REQ)-\d+.*\.md$/)) err(f, `UC / REQ はゴール直下ではなく UC ディレクトリ配下に置く（R-1006）`);

		for (const uname of listDirs(gdir)) {
			const udir = join(gdir, uname);
			const uid = (uname.match(/^UC-\d+/) || [null])[0];
			if (!UC_DIR_RE.test(uname)) err(udir, `ディレクトリ名が UC-nnn-<slug>（slug は小文字ケバブ）でない`);
			const ufile = join(udir, "UC.md");
			if (!existsSync(ufile)) {
				err(udir, `UC.md が無い（UC ディレクトリには必須 / R-1006）`);
				continue;
			}
			const u = validateUC(ufile, uid);
			if (u.goal && gid && u.goal !== gid) err(ufile, `goal "${u.goal}" が配置ディレクトリの GOAL "${gid}" と不一致（R-1007）`);
			const id = u.id || uid;
			const entry = { file: ufile, dir: udir, ...u, reqs: [] };
			if (id) {
				if (ucs.has(id)) err(ufile, `UC "${id}" が重複（${ucs.get(id).file} と）`);
				else ucs.set(id, entry);
			}
			for (const f of listFiles(udir, /^REQ-\d+\.md$/)) entry.reqs.push(validateReq(f, id));
			for (const f of listFiles(udir, /\.md$/)) if (!/^(UC|REQ-\d+)\.md$/.test(basename(f))) warn(f, `UC ディレクトリに UC.md / REQ-nnn.md 以外の md がある（1 ID 1 ファイル / R-1001）`);

			const contractFile = join(udir, "contract.yaml");
			if (existsSync(contractFile)) {
				const c = validateContract(contractFile, readFileSync(contractFile, "utf8"), uid, xKeys, shared);
				if (c.id) contracts.set(c.id, { file: contractFile, ...c });
			}
			if (existsSync(join(udir, "api-contract.yaml"))) err(join(udir, "api-contract.yaml"), `旧フォーマットの契約が残っている（/docs-migrate）`);
		}
	}

	//  横の ID 空間（中央）
	for (const f of listFiles(join(docsDir, "rules"), /\.md$/)) validateBR(f);
	for (const f of listFiles(join(docsDir, "nfr"), /\.md$/)) validateNFR(f);
	const adrs = listFiles(join(docsDir, "adr"), /\.md$/).map(validateADR);
	const adrIds = new Set(adrs.map((a) => a.id));
	for (const a of adrs) if (a.supersedes && !adrIds.has(a.supersedes)) err(join(docsDir, "adr"), `${a.id} の supersedes "${a.supersedes}" が存在しない`);

	//  単票
	validateSingleton(join(docsDir, "00-vision.md"), "vision", "VISION", true);
	validateSingleton(join(docsDir, "01-glossary.md"), "glossary", "GLOSSARY", true);
	validateSingleton(join(docsDir, "02-actors.md"), "actors", "ACTORS", true);
	validateSingleton(join(docsDir, "goals-backlog.md"), "backlog", "GOALS_BACKLOG", false);
	validateSingleton(join(docsDir, "verification", "GLOBAL.md"), "global", "VERIFICATION_GLOBAL", false);
	validateDesign(join(docsDir, "design.md"));

	return { goals, ucs, contracts, shared };
}

function crossChecks(model) {
	const { ucs, contracts } = model;
	//  契約カバレッジ: UC が active（＝実装に進んでよい）なのに契約が無い
	for (const [id, uc] of ucs) {
		if (uc.status === "active" && !contracts.has(id)) warn(uc.file, `${id}: UC が active だが contract.yaml が無い（境界ゼロなら operations: {} + x-no-boundary で宣言する）`);
		if (uc.status === "draft" && uc.phase && uc.phase !== "定義") err(uc.file, `${id}: UC が draft なのに phase が ${uc.phase}（承認前に工程を進めない）`);
	}
	//  契約 ↔ UC（親 draft に fixed 契約は不可・異常系の相互整合）
	for (const [id, c] of contracts) {
		const uc = ucs.get(id);
		if (!uc) {
			err(c.file, `契約 "${id}" に対応する UC.md が無い`);
			continue;
		}
		if (c.status === "fixed" && uc.status === "draft") err(c.file, `親 UC が draft なのに契約が fixed（先に UC を active にする）: ${id}`);
		if (c.status === "fixed" && uc.reqs.some((r) => r.status === "draft"))
			err(c.file, `契約が fixed だが draft の REQ がある（${uc.reqs.filter((r) => r.status === "draft").map((r) => r.id).join(", ")}）— 要件が settle する前に契約を凍結しない（移行中は baseline に載せる）`);
		if (uc.hasExceptionDerivation && c.errorCount === 0 && !c.legacy)
			warn(c.file, `${id}: UC の例外系の走査に導出があるが契約に errors が 1 件も無い`);
	}
}

function cmdValidate(docsDir, opts) {
	if (existsSync(join(docsDir, "specs"))) {
		if (!opts.ignoreLegacy) {
			console.error(
				`spec-lint: 旧レイアウト（${docsDir}/specs/F-xxx-<slug>/）を検出。` +
					`現行レイアウト（${docsDir}/goals/GOAL-nn/UC-nnn/）へ /docs-migrate で移行するか、移行までは旧タグ（v0.x）の harness を使う。` +
					`移行中に新レイアウト側だけを検査するなら --ignore-legacy-layout`,
			);
			return 1;
		}
		warn(join(docsDir, "specs"), `旧レイアウトが残っている（--ignore-legacy-layout で続行中）— 移行完了時に attic へ移す`);
	}
	if (existsSync(join(docsDir, "PRD.md"))) warn(join(docsDir, "PRD.md"), `旧レイアウトの PRD.md がある — 00-vision.md へ移す（/docs-migrate）`);
	if (!existsSync(join(docsDir, "goals")) && !existsSync(join(docsDir, "adr"))) {
		console.log(`spec-lint: ${docsDir}/goals が無いため検証をスキップ`);
		return 0;
	}
	const model = loadModel(docsDir);
	crossChecks(model);
	return reportWithBaseline(opts);
}

//  --- baseline ラチェット（trace-check と同じ意味論。既存プロジェクトの漸進導入と移行中の既知の赤のため）---
//  台帳のキーは「ファイル（行番号を除く）: メッセージ」。行番号を落とすのは、無関係な編集で行がずれても
//  同じ違反を新規と数えないため。--update-baseline は現状を丸ごと記録する（縮めるのも同じコマンド / R-804）
const baselineKey = (e) => `${e.file.replace(/:\d+$/, "")}: ${e.msg}`;

function reportWithBaseline(opts) {
	for (const w of warns) console.warn(`  warn  ${w.file}: ${w.msg}`);
	if (opts.updateBaseline) {
		writeFileSync(opts.baseline, JSON.stringify(errors.map(baselineKey), null, 2) + "\n");
		console.log(`spec-lint: baseline を更新: ${errors.length} 件を記録（${opts.baseline}）`);
		return 0;
	}
	let baseline = [];
	if (existsSync(opts.baseline) && !opts.strict) baseline = JSON.parse(readFileSync(opts.baseline, "utf8"));
	const known = errors.filter((e) => baseline.includes(baselineKey(e)));
	const fresh = errors.filter((e) => !baseline.includes(baselineKey(e)));
	const resolved = baseline.filter((b) => !errors.some((e) => baselineKey(e) === b));
	for (const e of known) console.warn(`  known ${e.file}: ${e.msg}`);
	for (const e of fresh) console.error(`  ERROR ${e.file}: ${e.msg}`);
	if (resolved.length) console.log(`spec-lint: 解消済み ${resolved.length} 件 -> --update-baseline で baseline を縮めること`);
	if (fresh.length === 0) console.log(`spec-lint: OK（warn ${warns.length}${known.length ? ` / baseline 済み ${known.length}` : ""}）`);
	else console.error(`spec-lint: ${fresh.length} 件の新規違反${known.length ? `（baseline 済み ${known.length} 件は別）` : ""}`);
	return fresh.length > 0 ? 1 : 0;
}

//  --- gate コマンド（draft なのに実装、を防ぐ） ---
function findUcDir(docsDir, id) {
	const goalsRoot = join(docsDir, "goals");
	for (const g of listDirs(goalsRoot)) {
		const hit = listDirs(join(goalsRoot, g)).find((d) => d === id || d.startsWith(id + "-"));
		if (hit) return join(goalsRoot, g, hit);
	}
	return null;
}

function gateUc(docsDir, id) {
	const dir = findUcDir(docsDir, id);
	if (!dir || !existsSync(join(dir, "UC.md"))) {
		err("gate", `${id}: 対応する UC が無い（docs/goals/<GOAL-nn-slug>/${id}-<slug>/UC.md を作る）`);
		return;
	}
	const uc = parseFrontmatter(readFileSync(join(dir, "UC.md"), "utf8")).data;
	if (uc.status !== "active") err("gate", `${id}: UC が active でない（現在 ${uc.status ?? "不明"}。draft のまま実装しない）`);
	const reqs = listFiles(dir, /^REQ-\d+\.md$/);
	if (reqs.length === 0) err("gate", `${id}: REQ が 1 件も無い（状態 × イベント表から REQ を導出してから実装する）`);
	for (const f of reqs) {
		const s = parseFrontmatter(readFileSync(f, "utf8")).data.status;
		if (s === "draft" || !s) err("gate", `${id}: ${basename(f, ".md")} が active でない（現在 ${s ?? "不明"}）`);
	}
	//  契約は「存在し、かつ fixed」を要求する（契約なしのまま実装が進む事故を断つ）
	const contractFile = join(dir, "contract.yaml");
	if (!existsSync(contractFile)) {
		err("gate", `${id}: 契約が無い（${basename(dir)}/contract.yaml を作り fixed にする）`);
		return;
	}
	const { root } = parseStrictYaml(readFileSync(contractFile, "utf8"));
	if (root["x-status"] !== "fixed") err("gate", `${id}: 契約が fixed でない（draft のまま実装しない）`);
}

function cmdGate(docsDir, opts) {
	let ids = [];
	if (opts.uc) ids = [opts.uc];
	else if (opts.message) {
		if (!existsSync(opts.message)) {
			console.error(`spec-lint gate: メッセージファイルが無い: ${opts.message}`);
			return 2;
		}
		const msg = readFileSync(opts.message, "utf8");
		ids = [...msg.matchAll(/^UC:\s*(UC-\d+)/gim)].map((m) => m[1]);
		if (ids.length === 0) return 0; //  トレーラ未使用はオプトイン。素通り（未強制）
	} else {
		console.error("spec-lint gate: --message <file> か --uc UC-nnn が要る");
		return 2;
	}
	for (const id of ids) gateUc(docsDir, id);
	report();
	return errors.length > 0 ? 1 : 0;
}

//  --- convert コマンド（旧 OpenAPI 3.x 契約 → harness 契約。docs/adr/ADR-0001「変換は spec-lint のサブコマンドが機械的に行う」）---
//
//  形を保つ変換だけを行い、判断が要る箇所（向き・エラーコードの語彙合わせ・summary の日本語・UC の割当）は
//  出力末尾の "# convert:" 注記と stderr に残して author / 人間へ返す。出力は厳格サブセット YAML で、
//  そのまま validate に掛かる。写像:
//    paths.<path>.<method>（operationId）   → operations.<operationId>（transport: http / wire: method, path, success）
//    parameters（path / query）+ requestBody → request（1 つの object に畳む）
//    responses.2xx                           → response
//    responses.4xx / 5xx                     → errors[]（code は x-error-code > スキーマの code の const / enum > ステータス既定）
//    example(s)                              → examples（正常 ok / 異常はコード名）
//    components.schemas                      → 契約ローカルの schemas:（$ref "#/components/schemas/X" → "#/schemas/X"）
//    security / x-status                     → auth / x-status（未指定は none / draft と注記）

const STATUS_CODE_FALLBACK = { 400: "INVALID_INPUT", 401: "UNAUTHENTICATED", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT", 422: "INVALID_INPUT", 429: "RATE_LIMITED" };
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

const firstLine = (s) => (typeof s === "string" ? s.split(/\r?\n/)[0].trim() : "");

//  "#/components/<section>/X" の $ref を components から引く（無ければそのまま）
function resolveRef(node, comps, section) {
	let cur = node;
	for (let i = 0; i < 8 && isMap(cur) && typeof cur["$ref"] === "string"; i++) {
		const m = cur["$ref"].match(/^#\/components\/([\w-]+)\/([^/]+)$/);
		if (!m || m[1] !== section || !isMap(comps[section]) || !(m[2] in comps[section])) return cur;
		cur = comps[section][m[2]];
	}
	return cur;
}

//  ローカル $ref を契約側の書き方へ（深いコピー）
function rewriteRefs(node) {
	if (Array.isArray(node)) return node.map(rewriteRefs);
	if (!isMap(node)) return node;
	const out = {};
	for (const [k, v] of Object.entries(node)) {
		if (k === "$ref" && typeof v === "string")
			out[k] = v
				.replace(/^#\/components\/schemas\//, "#/schemas/")
				.replace(/^(?:\.\.\/)+_shared\/components\.yaml#\/components\/schemas\//, "../../../_shared/components.yaml#/schemas/");
		else out[k] = rewriteRefs(v);
	}
	return out;
}

const jsonSchemaOf = (content) => {
	if (!isMap(content)) return null;
	const media = content["application/json"] || Object.values(content).find(isMap);
	return isMap(media) && isMap(media.schema) ? media.schema : null;
};
const exampleOf = (content) => {
	if (!isMap(content)) return undefined;
	const media = content["application/json"] || Object.values(content).find(isMap);
	if (!isMap(media)) return undefined;
	if (media.example !== undefined) return media.example;
	if (isMap(media.examples)) {
		const first = Object.values(media.examples).find(isMap);
		if (first && first.value !== undefined) return first.value;
	}
	return undefined;
};

//  get /users/{id} → getUsersById
function camelName(method, path) {
	const parts = path.split("/").filter(Boolean).map((seg) => {
		const prm = seg.match(/^\{(.+)\}$/);
		const word = prm ? "By" + prm[1] : seg;
		return word.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
	});
	return method + parts.join("");
}

function errorCodesOf(resp, status, comps, notes, name) {
	if (resp && resp["x-error-code"]) return [String(resp["x-error-code"])];
	if (resp && Array.isArray(resp["x-error-codes"])) return resp["x-error-codes"].map(String);
	const schema = resp ? resolveRef(jsonSchemaOf(resp.content), comps, "schemas") : null;
	const props = isMap(schema) && isMap(schema.properties) ? schema.properties : {};
	const nested = isMap(props.error) ? resolveRef(props.error, comps, "schemas") : null;
	const codeProp = props.code || (isMap(nested) && isMap(nested.properties) ? nested.properties.code : null);
	if (isMap(codeProp)) {
		if (codeProp.const !== undefined) return [String(codeProp.const)];
		if (Array.isArray(codeProp.enum) && codeProp.enum.length) return codeProp.enum.map(String);
	}
	const fallback = STATUS_CODE_FALLBACK[status] || (status >= 500 ? "INTERNAL_ERROR" : `HTTP_${status}`);
	notes.push(`${name}: ${status} のエラーコードが旧契約から読めないため ${fallback} を仮置き（_shared errorCodes と照合する）`);
	return [fallback];
}

function buildRequest(op, params, comps) {
	const body = op.requestBody ? resolveRef(op.requestBody, comps, "requestBodies") : null;
	const bodySchema = isMap(body) ? jsonSchemaOf(body.content) : null;
	const props = {};
	const required = [];
	for (const raw of params) {
		const prm = resolveRef(raw, comps, "parameters");
		if (!isMap(prm) || !prm.name || !["path", "query"].includes(prm.in)) continue;
		props[prm.name] = rewriteRefs(isMap(prm.schema) ? prm.schema : { type: "string" });
		if (prm.required === true || prm.in === "path") required.push(prm.name);
	}
	if (!bodySchema && required.length === 0 && Object.keys(props).length === 0) return null;
	if (bodySchema && Object.keys(props).length === 0) return rewriteRefs(bodySchema);
	//  パラメータと本体を 1 つの object に畳む（$ref の本体はここでだけ展開する）
	const inline = bodySchema ? resolveRef(bodySchema, comps, "schemas") : null;
	const merged = { type: "object", required: [...required], properties: { ...props } };
	if (isMap(inline)) {
		if (Array.isArray(inline.required)) merged.required.push(...inline.required.filter((r) => !merged.required.includes(r)));
		if (isMap(inline.properties)) for (const [k, v] of Object.entries(inline.properties)) merged.properties[k] = rewriteRefs(v);
	}
	if (merged.required.length === 0) delete merged.required;
	return merged;
}

function buildExamples(op, responses, success, errs, comps) {
	const ex = {};
	const body = op.requestBody ? resolveRef(op.requestBody, comps, "requestBodies") : null;
	const reqEx = isMap(body) ? exampleOf(body.content) : undefined;
	const okResp = success ? resolveRef(responses[success.key], comps, "responses") : null;
	const okEx = isMap(okResp) ? exampleOf(okResp.content) : undefined;
	if (reqEx !== undefined || okEx !== undefined) {
		ex.ok = {};
		if (reqEx !== undefined) ex.ok.request = reqEx;
		if (okEx !== undefined) ex.ok.response = okEx;
	}
	for (const e of errs) {
		const r = resolveRef(responses[String(e.wire.status)], comps, "responses");
		if (!isMap(r) || exampleOf(r.content) === undefined) continue;
		const key = e.code.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase());
		if (!(key in ex)) ex[key] = { error: e.code }; //  旧契約の異常 example は応答側なので request は持てない
	}
	return ex;
}

function buildOperation(name, op, method, path, params, globalSecurity, comps, opts, notes) {
	const o = { transport: "http", direction: opts.direction, owned: true };
	//  security: [] ＝ none / 未指定 ＝ 文書全体の security / どちらも無ければ none と注記
	const sec = Array.isArray(op.security) ? op.security : globalSecurity;
	if (!Array.isArray(sec)) {
		o.auth = "none";
		notes.push(`${name}: security が無いため auth: none を仮置き（不要なら確定、要るなら _shared authSchemes 名へ）`);
	} else if (sec.length === 0) o.auth = "none";
	else {
		const first = sec.find(isMap);
		o.auth = first && Object.keys(first).length ? Object.keys(first)[0] : "none";
	}
	o.summary = firstLine(op.summary) || firstLine(op.description) || `<${name} が何をするか 1 行>`;
	if (o.summary.startsWith("<")) notes.push(`${name}: summary が無い（1 行で書く）`);
	const responses = isMap(op.responses) ? op.responses : {};
	const statuses = Object.keys(responses).map((key) => ({ key, code: Number(key) })).filter((s) => Number.isInteger(s.code));
	const success = statuses.find((s) => s.code >= 200 && s.code < 300);
	o.wire = { method: method.toUpperCase(), path, success: success ? success.code : 200 };
	if (!success) notes.push(`${name}: 2xx レスポンスが無い（wire.success は 200 を仮置き）`);
	const request = buildRequest(op, params, comps);
	if (request) o.request = request;
	if (success) {
		const r = resolveRef(responses[success.key], comps, "responses");
		const schema = isMap(r) ? jsonSchemaOf(r.content) : null;
		if (schema) o.response = rewriteRefs(schema);
	}
	//  4xx / 5xx → errors。1 件も無ければ errors: []（失敗経路を持たない宣言。旧契約に無かった失敗例を発明しない）
	const errs = [];
	for (const s of statuses) {
		if (s.code < 400) continue;
		const r = resolveRef(responses[s.key], comps, "responses");
		const when = (isMap(r) && firstLine(r.description)) || `<発生条件を 1 行>`;
		if (when.startsWith("<")) notes.push(`${name}: ${s.code} の発生条件（when）が読めない`);
		for (const code of errorCodesOf(r, s.code, comps, notes, name)) errs.push({ code, when, wire: { status: s.code } });
	}
	o.errors = errs;
	const examples = buildExamples(op, responses, success, errs, comps);
	if (Object.keys(examples).length) o.examples = examples;
	return o;
}

function buildContract(oa, opts, notes) {
	const comps = isMap(oa.components) ? oa.components : {};
	const contract = {};
	contract["x-uc"] = opts.uc || "UC-000";
	if (!opts.uc) notes.push("x-uc: --uc UC-nnn が無いため UC-000 を仮置き（配置先の UC ディレクトリの ID に置き換える）");
	contract["x-status"] = CONTRACT_STATUS.includes(oa["x-status"]) ? oa["x-status"] : "draft";
	if (!CONTRACT_STATUS.includes(oa["x-status"])) notes.push("x-status: 旧契約に無いため draft（承認状態を保つなら移行台本の指示で fixed にする）");
	contract["x-spec"] = "./UC.md";
	contract["x-updated"] = opts.date || new Date().toISOString().slice(0, 10);
	const ops = {};
	const globalSecurity = Array.isArray(oa.security) ? oa.security : null;
	for (const [path, item] of Object.entries(isMap(oa.paths) ? oa.paths : {})) {
		if (!isMap(item)) continue;
		const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
		for (const method of HTTP_METHODS) {
			const op = item[method];
			if (!isMap(op)) continue;
			const name = typeof op.operationId === "string" && OP_NAME_RE.test(op.operationId) ? op.operationId : camelName(method, path);
			if (name !== op.operationId) notes.push(`${method.toUpperCase()} ${path}: operationId "${op.operationId ?? ""}" が使えないため ${name} を生成`);
			if (name in ops) notes.push(`${name}: 操作名が重複している（改名する）`);
			ops[name] = buildOperation(name, op, method, path, [...pathParams, ...(Array.isArray(op.parameters) ? op.parameters : [])], globalSecurity, comps, opts, notes);
		}
	}
	contract.operations = ops;
	if (isMap(comps.schemas) && Object.keys(comps.schemas).length) contract.schemas = rewriteRefs(comps.schemas);
	return contract;
}

//  厳格サブセットで書き出す（ブロック記法 + 空の {} / [] + スカラ列の [a, b]。ブロックスカラ・アンカーは出さない）
function emitYaml(value, indent = 0) {
	const pad = "  ".repeat(indent);
	const lines = [];
	if (Array.isArray(value)) {
		for (const item of value) {
			if (isMap(item) && Object.keys(item).length) {
				const inner = emitYaml(item, indent + 1).split("\n");
				lines.push(`${pad}- ${inner[0].trimStart()}`, ...inner.slice(1));
			} else if (Array.isArray(item) && item.length) lines.push(`${pad}-`, ...emitYaml(item, indent + 1).split("\n"));
			else lines.push(`${pad}- ${yamlScalar(item)}`);
		}
		return lines.join("\n");
	}
	for (const [k, v] of Object.entries(value)) {
		const key = yamlKey(k);
		if (isMap(v)) lines.push(Object.keys(v).length ? `${pad}${key}:\n${emitYaml(v, indent + 1)}` : `${pad}${key}: {}`);
		else if (Array.isArray(v)) {
			if (v.length === 0) lines.push(`${pad}${key}: []`);
			else if (v.every((x) => !isMap(x) && !Array.isArray(x))) lines.push(`${pad}${key}: [${v.map(yamlScalar).join(", ")}]`);
			else lines.push(`${pad}${key}:\n${emitYaml(v, indent + 1)}`);
		} else lines.push(`${pad}${key}: ${yamlScalar(v)}`);
	}
	return lines.join("\n");
}
//  引用が要らないのは、先頭が英数・非 ASCII で、YAML の指示子・区切りを含まず、数値 / 真偽 / null に読めない文字列だけ
function yamlScalar(v) {
	if (v === null || v === undefined) return "null";
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	const s = String(v);
	const plain =
		/^[A-Za-z0-9_./\u00A0-\uFFFF][^#:\[\]{},"'`&*!|>%@]*$/.test(s) && !/^(true|false|null|~|-?\d+(\.\d+)?)$/.test(s) && !/^\s|\s$/.test(s);
	return plain ? s : JSON.stringify(s);
}
const yamlKey = (k) => (/^[A-Za-z0-9_$\u00A0-\uFFFF][\w$.\u00A0-\uFFFF-]*$/.test(k) ? k : JSON.stringify(k));

function cmdConvert(opts) {
	const input = opts._[0];
	if (!input || !existsSync(input)) {
		console.error("spec-lint convert: 入力ファイル（OpenAPI 3.x の YAML）が要る");
		return 2;
	}
	if (!DIRECTIONS.includes(opts.direction)) {
		console.error(`spec-lint convert: --direction は ${DIRECTIONS.join(" | ")}`);
		return 2;
	}
	//  lenient: 旧契約の複数行スカラは 1 行に畳んで読む（検証では使わない）
	const { root, problems } = parseStrictYaml(readFileSync(input, "utf8"), { lenient: true });
	for (const p of problems) console.error(`  warn  ${input}:${p.line}: ${p.msg}`);
	if (!isMap(root) || (!("openapi" in root) && !("paths" in root))) {
		console.error(`spec-lint convert: ${input} は OpenAPI 文書ではない（openapi: / paths: が無い）`);
		return 2;
	}
	const notes = [];
	const contract = buildContract(root, opts, notes);
	const text = [
		`# Converted from ${basename(input)} by spec-lint convert — 形を保つ変換。判断が要る箇所は末尾の "# convert:" 注記`,
		`# 向きは --direction（既定 outbound ＝ このアプリが呼ぶ。サーバ側の自前 API なら inbound）`,
		emitYaml(contract),
		...(notes.length ? ["", ...notes.map((n) => `# convert: ${n}`)] : []),
		"",
	].join("\n");
	if (opts.out) {
		writeFileSync(opts.out, text);
		console.error(`spec-lint convert: ${opts.out} に書き出した（operations ${Object.keys(contract.operations).length} 件 / 注記 ${notes.length} 件）`);
	} else process.stdout.write(text);
	for (const n of notes) console.error(`  note  ${n}`);
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
	const opts = { docs: "docs", baseline: ".spec-baseline.json", direction: "outbound", _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--docs") opts.docs = argv[++i];
		else if (a === "--message") opts.message = argv[++i];
		else if (a === "--uc") opts.uc = argv[++i];
		else if (a === "--ignore-legacy-layout") opts.ignoreLegacy = true;
		else if (a === "--update-baseline") opts.updateBaseline = true;
		else if (a === "--strict") opts.strict = true;
		else if (a === "--baseline") opts.baseline = argv[++i];
		else if (a === "--out") opts.out = argv[++i];
		else if (a === "--direction") opts.direction = argv[++i];
		else if (a === "--date") opts.date = argv[++i];
		else if (a.startsWith("--")) {
			console.error(`spec-lint: 不明な引数 ${a}`);
			process.exit(2);
		} else opts._.push(a);
	}
	return opts;
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const opts = parseArgs(rest);
	if (cmd === "validate" || cmd === undefined) process.exit(cmdValidate(opts.docs, opts));
	if (cmd === "gate") process.exit(cmdGate(opts.docs, opts));
	if (cmd === "convert") process.exit(cmdConvert(opts));
	console.error(
		"usage: spec-lint.mjs validate [--docs docs] [--ignore-legacy-layout] [--update-baseline|--strict] [--baseline f]\n" +
			"       spec-lint.mjs gate --message f | --uc UC-012\n" +
			"       spec-lint.mjs convert <openapi.yaml> [--uc UC-012] [--direction outbound|inbound] [--out contract.yaml] [--date YYYY-MM-DD]",
	);
	process.exit(2);
}

main();
