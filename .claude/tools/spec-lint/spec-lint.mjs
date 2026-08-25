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
//    docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/REQ-nnn.md          要求（EARS 1 文 + 検証方針）
//    docs/goals/GOAL-nn-<slug>/UC-nnn-<slug>/contract.yaml       UC の境界契約（harness 独自 YAML）
//    docs/rules/BR-nnn.md  docs/nfr/NFR-nnn.md  docs/adr/ADR-nnnn-<slug>.md   横断（中央）
//    docs/verification/GLOBAL.md                                 【任意】全体の検証除外
//    docs/_shared/components.yaml                                契約の共有語彙（$ref 先）
//
//  書式の SSOT は .claude/templates/develop/ のテンプレート。必須フロントマター・必須セクション・
//  契約の必須 x- キーはテンプレートから導出する（書式改定はテンプレートを直せば lint も追従する。
//  テンプレートで「# optional」と注記されたキーだけ任意）。閉じた語彙（status / phase / pattern /
//  transport / direction）は実行コードでしか強制できないため本ツールが持つ。
//  トレーサビリティ（被覆・参照・配置の整合 C1–C12）は tools/trace-check の仕事で、ここでは見ない。
//
//  契約フォーマットの判断は docs/adr/ADR-0001（OpenAPI をやめた理由）と
//  docs/adr/ADR-0002（パーサを自前実装し YAML を厳格サブセットに限る理由）。
//
//  使い方:
//    node spec-lint.mjs validate [--docs docs]      全 docs を検証（フォーマット＋ライフサイクル不変条件）
//    node spec-lint.mjs gate --message <file>       commit メッセージの UC: トレーラの UC が実装可能か検証
//    node spec-lint.mjs gate --uc UC-012            指定 UC が実装可能（UC / REQ が active・契約 fixed）か検証
//
//  終了コード: 0=OK / 1=違反あり / 2=使い方エラー
//

import { readFileSync, readdirSync, existsSync } from "node:fs";
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
const MAX_EARS_CHARS = 200; //  EARS 文 1 本の長さ（超えるのは複数要求の圧縮 / R-401）
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
function checkSentinels(file, text, status) {
	if (!isSettled(status)) return;
	for (const s of SENTINELS) {
		if (new RegExp(`\\b${s}\\b`).test(text)) err(file, `${status} なのにテンプレのプレースホルダが残っている: "${s}"`);
	}
	const angle = text.match(/<[^>\n]{1,60}>/g) || [];
	for (const a of angle) {
		//  <機能名> のような全角含みプレースホルダのみ（HTML タグ等は対象外）
		if (/[^\x00-\x7F]/.test(a)) {
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
	//  REQ の検証方針は「参照先」「値の SSOT は <path>」を書く正規の場所なので、アンカー系の検査は要求文の側だけに掛ける
	const policyIdx = kind === "req" ? plain.indexOf(`## ${POLICY}`) : -1;
	const head = policyIdx >= 0 ? plain.slice(0, policyIdx) : plain;

	//  1) 本文中の日付括弧: 「（2026-07-26 改訂）」のような経緯の追記痕
	const dates = plain.match(/[（(]\d{4}-\d{2}-\d{2}/g) || [];
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
	const hasExceptionDerivation = excRows.some((r) => r.slice(1).some((c) => c && !/^(なし|—|-)$/.test(c)));
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

	//  EARS 文: 検証方針の前に blockquote 段落がちょうど 1 つ（R-401: 1 要求 1 文）
	const policyIdx = body.indexOf(`## ${POLICY}`);
	const head = policyIdx >= 0 ? body.slice(0, policyIdx) : body;
	const paras = blockquoteParagraphs(stripComments(head));
	if (paras.length === 0) err(file, `要求文（> で始まる EARS 1 文）が無い（R-401）`);
	else if (paras.length > 1) err(file, `要求文の blockquote が ${paras.length} 段落ある — 1 要求 1 文。別の要求は別の REQ へ（R-401）`);
	else if (paras[0].length > MAX_EARS_CHARS) warn(file, `要求文が ${paras[0].length} 文字（${MAX_EARS_CHARS} 文字超）— 複数の要求の圧縮ではないか（R-401）`);

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
	if (isSettled(status) && blockquoteParagraphs(stripComments(body)).length === 0) err(file, `${status} なのに要求文（> で始まる 1 文）が無い`);
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
			err(c.file, `契約が fixed だが draft の REQ がある（${uc.reqs.filter((r) => r.status === "draft").map((r) => r.id).join(", ")}）— 要求が settle する前に契約を凍結しない`);
		if (uc.hasExceptionDerivation && c.errorCount === 0 && !c.legacy)
			warn(c.file, `${id}: UC の例外系の走査に導出があるが契約に errors が 1 件も無い`);
	}
}

function cmdValidate(docsDir) {
	if (existsSync(join(docsDir, "specs"))) {
		console.error(
			`spec-lint: 旧レイアウト（${docsDir}/specs/F-xxx-<slug>/）を検出。` +
				`現行レイアウト（${docsDir}/goals/GOAL-nn/UC-nnn/）へ /docs-migrate で移行するか、移行までは旧タグ（v0.x）の harness を使う`,
		);
		return 1;
	}
	if (existsSync(join(docsDir, "PRD.md"))) warn(join(docsDir, "PRD.md"), `旧レイアウトの PRD.md がある — 00-vision.md へ移す（/docs-migrate）`);
	if (!existsSync(join(docsDir, "goals")) && !existsSync(join(docsDir, "adr"))) {
		console.log(`spec-lint: ${docsDir}/goals が無いため検証をスキップ`);
		return 0;
	}
	const model = loadModel(docsDir);
	crossChecks(model);
	report();
	return errors.length > 0 ? 1 : 0;
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
		else if (argv[i] === "--message") opts.message = argv[++i];
		else if (argv[i] === "--uc") opts.uc = argv[++i];
	}
	return opts;
}

function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	const opts = parseArgs(rest);
	if (cmd === "validate" || cmd === undefined) process.exit(cmdValidate(opts.docs));
	if (cmd === "gate") process.exit(cmdGate(opts.docs, opts));
	console.error("usage: spec-lint.mjs validate|gate [--docs docs] [--message f] [--uc UC-012]");
	process.exit(2);
}

main();
