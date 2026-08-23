#!/usr/bin/env node
//  gate-hook — §2 実装着手ゲートの機械強制（PreToolUse フック）
//
//  develop skill §2 は「spec と契約が fixed になる前に実装コードを書くな」という
//  停止線だが、それ自体は説得的制御（AI が読み飛ばせば止まらない）。spec-lint の
//  gate も commit 時にしか発火しない事後チェックである。本フックはその停止線を
//  Write / Edit の直前で発火する構造的強制に変える。
//
//  仕組み:
//    Claude Code の PreToolUse フックとして起動され、stdin の JSON から書き込み
//    対象パスを取り出す。対象が「実装コード」（--code glob にマッチ）なら、
//    docs/specs/specs.md の台帳（工程列）を読み、実装中（工程=実装|検証）の
//    全機能について spec / 契約の fixed を検証する。欠けていれば exit 2 で
//    ツール実行そのものをブロックし、stderr の理由が AI に差し戻される。
//
//  判定規則（fail-open / fail-closed の境界）:
//    - docs 配下・.claude 配下・--code 非マッチ・--exclude マッチ → 許可（exit 0）。
//      SSOT を書く行為はゲートの前提なので docs は常に通す。
//    - 実装コードへの書き込みで、
//        specs.md（台帳）が無い / 工程=実装|検証 の行が無い /
//        該当機能の spec が fixed でない / 契約が無い・fixed でない
//      → ブロック（exit 2）。ここは fail-closed（ゲートの存在意義）。
//    - stdin が解釈できない等の内部エラー → 許可（exit 0）。フック自身の不具合で
//      セッションを壊さない（ゲートは spec-lint gate と §2 自己確認が二重に守る）。
//
//  設定はフックコマンドの引数で渡す（設定ファイルを増やさない。submodule 配置でも
//  取り込み先の settings.local.json に閉じる）:
//    node .claude/tools/gate-hook/gate-hook.mjs --code 'src/**' [--code ...]
//         [--exclude 'skeleton/**' ...] [--docs docs]
//
//  使い方・設置手順・制約は同梱 README.md を参照。

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

//  ---- 引数 ----------------------------------------------------------------

function parseArgs(argv) {
	const opts = { code: [], exclude: [], docs: "docs" };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--code") opts.code.push(argv[++i]);
		else if (a === "--exclude") opts.exclude.push(argv[++i]);
		else if (a === "--docs") opts.docs = argv[++i];
	}
	return opts;
}

//  ---- glob（依存ゼロの最小実装: ** / * / ? のみ） --------------------------

function globToRegExp(glob) {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				//  "**/" は 0 階層以上、行末の "**" は残り全部
				if (glob[i + 2] === "/") {
					re += "(?:.*/)?";
					i += 2;
				} else {
					re += ".*";
					i += 1;
				}
			} else re += "[^/]*";
		} else if (c === "?") re += "[^/]";
		else if ("\\^$.|+()[]{}".includes(c)) re += "\\" + c;
		else re += c;
	}
	return new RegExp("^" + re + "$");
}

function matchesAny(relPath, globs) {
	return globs.some((g) => globToRegExp(g).test(relPath));
}

//  ---- docs パーサ（spec-lint と同じ規約: 値でセルを特定する） --------------

function parseFrontmatter(text) {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	const data = {};
	if (m)
		for (const line of m[1].split(/\r?\n/)) {
			const kv = line.match(/^([^:#]+):\s*(.*)$/);
			if (kv) data[kv[1].trim()] = kv[2].trim().split(/\s+#/)[0].trim();
		}
	return data;
}

const STAGES = ["定義", "構造", "実装", "検証", "完了"];
// 旧工程名「攻撃」は「検証」の別名として台帳読取時のみ認める
const ACTIVE_STAGES = new Set(["実装", "検証", "攻撃"]);

function parseLedger(body) {
	const rows = [];
	for (const line of body.split(/\r?\n/)) {
		const t = line.trim();
		if (!t.startsWith("|")) continue;
		const cells = t
			.split("|")
			.slice(1, -1)
			.map((c) => c.trim());
		const idm = cells[0] && cells[0].match(/F-\d+/);
		if (!idm) continue; //  ヘッダ・区切り行
		rows.push({
			id: idm[0],
			status: cells.find((c) => c === "draft" || c === "fixed") || null,
			stage: cells.find((c) => STAGES.includes(c) || c === "攻撃") || null,
		});
	}
	return rows;
}

//  機能ディレクトリ（docs/specs/F-xxx-<slug>/）をディレクトリ名の ID 部で解決する
function findFeatureDir(specsRoot, id) {
	if (!existsSync(specsRoot)) return null;
	for (const f of readdirSync(specsRoot, { withFileTypes: true })) {
		if (f.isDirectory() && (f.name === id || f.name.startsWith(id + "-")))
			return join(specsRoot, f.name);
	}
	return null;
}

function specStatus(dir) {
	const p = join(dir, "spec.md");
	if (!existsSync(p)) return null;
	return { status: parseFrontmatter(readFileSync(p, "utf8"))["ステータス"] || null };
}

//  契約（境界契約 yaml）の x-status をトップレベル行スキャンで読む
function contractStatus(dir) {
	const p = join(dir, "contract.yaml");
	if (!existsSync(p)) return null;
	const m = readFileSync(p, "utf8").match(/^x-status:\s*([\w-]+)/m);
	return { status: m ? m[1] : null };
}

//  ---- 本体 ----------------------------------------------------------------

function block(lines) {
	//  exit 2: PreToolUse のブロック。stderr がそのまま AI に差し戻される。
	process.stderr.write(
		[
			"[gate-hook] 実装着手ゲート（develop skill §2）によりこの書き込みをブロックしました。",
			...lines,
			"コードでなく SSOT を先に整えること（§2 の分岐表に従い Phase 1 / Phase 3 へ）。",
		].join("\n") + "\n",
	);
	process.exit(2);
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.code.length === 0) {
		//  有効化したのに対象 glob が無いのは設置ミス。ブロックはせず人間にだけ警告
		//  （exit 1: 非ブロッキングエラー。stderr はユーザー向け表示に載る）。
		process.stderr.write(
			"[gate-hook] --code が未指定のため何もゲートしません（settings の hook コマンドに --code 'src/**' 等を追加してください）\n",
		);
		process.exit(1);
	}

	let payload;
	try {
		payload = JSON.parse(readFileSync(0, "utf8"));
	} catch {
		process.exit(0); //  入力が解釈できない → フック都合でセッションを壊さない
	}

	const input = payload.tool_input || {};
	const target = input.file_path || input.notebook_path;
	if (!target) process.exit(0);

	const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
	const abs = isAbsolute(target) ? target : resolve(root, target);
	const rel = relative(root, abs).split(sep).join("/");
	if (rel.startsWith("..")) process.exit(0); //  プロジェクト外（scratchpad 等）

	//  SSOT・harness 自身は常に通す（ゲートを通すための行為を塞がない）
	const docsDir = opts.docs.replace(/\/+$/, "");
	if (rel === docsDir || rel.startsWith(docsDir + "/")) process.exit(0);
	if (rel.startsWith(".claude/")) process.exit(0);

	if (matchesAny(rel, opts.exclude)) process.exit(0);
	if (!matchesAny(rel, opts.code)) process.exit(0);

	//  ---- ここから実装コードへの書き込み: 台帳で §2 を検証（fail-closed） ----

	const specsRoot = join(root, docsDir, "specs");
	const ledgerFile = join(specsRoot, "specs.md");
	if (!existsSync(ledgerFile))
		block([
			`対象: ${rel}`,
			`${docsDir}/specs/specs.md（台帳）が存在しない＝SSOT が無い。§2 判定条件 1 を満たせません。`,
		]);

	const ledger = parseLedger(readFileSync(ledgerFile, "utf8"));
	const active = ledger.filter((r) => r.stage && ACTIVE_STAGES.has(r.stage));
	if (active.length === 0)
		block([
			`対象: ${rel}`,
			`specs.md の台帳に 工程=実装（または 検証）の機能がありません。`,
			"実装に入る機能の spec / 契約を fixed にしたうえで、orchestrator が台帳の工程列を「実装」へ更新してから書くこと。",
		]);

	const problems = [];
	for (const r of active) {
		const dir = findFeatureDir(specsRoot, r.id);
		const spec = dir ? specStatus(dir) : null;
		if (!spec)
			problems.push(`${r.id}: spec（${docsDir}/specs/${r.id}-<slug>/spec.md）が存在しない → Phase 1`);
		else if (spec.status !== "fixed")
			problems.push(`${r.id}: spec が fixed でない（現在 ${spec.status ?? "不明"}）→ Phase 1`);
		const contract = dir ? contractStatus(dir) : null;
		if (!contract)
			problems.push(`${r.id}: 契約（同ディレクトリの contract.yaml）が存在しない → Phase 3`);
		else if (contract.status !== "fixed")
			problems.push(
				`${r.id}: 契約が fixed でない（現在 ${contract.status ?? "不明"}）→ Phase 3（fixed 化は structure-oracle 不整合ゼロ後に orchestrator が行う）`,
			);
	}
	if (problems.length > 0)
		block([`対象: ${rel}`, `実装中（工程=実装|検証）の機能に未充足があります:`, ...problems.map((p) => "  - " + p)]);

	process.exit(0);
}

main();
