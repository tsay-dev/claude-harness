#!/usr/bin/env node
//  gate-hook — §2 実装着手ゲートの機械強制（PreToolUse フック）
//
//  develop skill §2 は「UC / REQ が active になり契約が fixed になる前に実装コードを書くな」
//  という停止線だが、それ自体は説得的制御（AI が読み飛ばせば止まらない）。spec-lint の
//  gate も commit 時にしか発火しない事後チェックである。本フックはその停止線を
//  Write / Edit の直前で発火する構造的強制に変える。
//
//  仕組み:
//    Claude Code の PreToolUse フックとして起動され、stdin の JSON から書き込み
//    対象パスを取り出す。対象が「実装コード」（--code glob にマッチ）なら、
//    docs/goals/**/UC-*/UC.md の frontmatter phase:（工程台帳）を読み、実装中
//    （phase=実装|検証）の全 UC について UC active / 全 REQ が draft でない / 契約 fixed を
//    検証する。欠けていれば exit 2 でツール実行そのものをブロックし、stderr の理由が
//    AI に差し戻される。
//
//  判定規則（fail-open / fail-closed の境界）:
//    - docs 配下・.claude 配下・--code 非マッチ・--exclude マッチ → 許可（exit 0）。
//      SSOT を書く行為はゲートの前提なので docs は常に通す。
//    - 実装コードへの書き込みで、
//        docs/goals が無い / phase=実装|検証 の UC が無い /
//        該当 UC が active でない / draft の REQ がある / 契約が無い・fixed でない
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
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

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

//  ---- docs パーサ（spec-lint / trace-check と同じ規約: frontmatter が SSOT） -------

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

const ACTIVE_PHASES = new Set(["実装", "検証"]);

const listDirs = (dir) =>
	existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(dir, d.name)).sort() : [];

//  docs/goals/**/UC-*/UC.md を全部読む（工程台帳は UC.md の phase: / R-1003 で台帳ファイルは持たない）
function collectUcs(goalsRoot) {
	const ucs = [];
	for (const gdir of listDirs(goalsRoot)) {
		if (basename(gdir).startsWith("_") || basename(gdir).startsWith(".")) continue;
		for (const udir of listDirs(gdir)) {
			const ufile = join(udir, "UC.md");
			if (!existsSync(ufile)) continue;
			const fm = parseFrontmatter(readFileSync(ufile, "utf8"));
			ucs.push({ id: fm.id || basename(udir).match(/^UC-\d+/)?.[0] || basename(udir), dir: udir, status: fm.status || null, phase: fm.phase || null });
		}
	}
	return ucs;
}

function draftReqs(dir) {
	return readdirSync(dir)
		.filter((n) => /^REQ-\d+\.md$/.test(n))
		.filter((n) => {
			const s = parseFrontmatter(readFileSync(join(dir, n), "utf8")).status;
			return !s || s === "draft";
		})
		.map((n) => n.replace(/\.md$/, ""));
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

	//  SSOT・harness 自身・trace 設定は常に通す（ゲートを通すための行為を塞がない）
	const docsDir = opts.docs.replace(/\/+$/, "");
	if (rel === docsDir || rel.startsWith(docsDir + "/")) process.exit(0);
	if (rel.startsWith(".claude/")) process.exit(0);
	if (rel === "traceconfig.json" || rel === ".trace-baseline.json") process.exit(0);

	if (matchesAny(rel, opts.exclude)) process.exit(0);
	if (!matchesAny(rel, opts.code)) process.exit(0);

	//  ---- ここから実装コードへの書き込み: UC.md の工程で §2 を検証（fail-closed） ----

	const goalsRoot = join(root, docsDir, "goals");
	if (!existsSync(goalsRoot))
		block([`対象: ${rel}`, `${docsDir}/goals（GOAL → UC → REQ の SSOT）が存在しない。§2 判定条件 1 を満たせません。`]);

	const active = collectUcs(goalsRoot).filter((u) => u.phase && ACTIVE_PHASES.has(u.phase));
	if (active.length === 0)
		block([
			`対象: ${rel}`,
			`phase=実装（または 検証）の UC が ${docsDir}/goals 配下にありません。`,
			"実装に入る UC の UC / REQ を active、契約を fixed にしたうえで、orchestrator が UC.md の phase: を「実装」へ更新してから書くこと。",
		]);

	const problems = [];
	for (const u of active) {
		if (u.status !== "active") problems.push(`${u.id}: UC が active でない（現在 ${u.status ?? "不明"}）→ Phase 1`);
		const drafts = draftReqs(u.dir);
		if (drafts.length > 0) problems.push(`${u.id}: draft の REQ がある（${drafts.join(", ")}）→ Phase 1`);
		const contract = contractStatus(u.dir);
		if (!contract) problems.push(`${u.id}: 契約（${basename(u.dir)}/contract.yaml）が存在しない → Phase 3`);
		else if (contract.status !== "fixed")
			problems.push(`${u.id}: 契約が fixed でない（現在 ${contract.status ?? "不明"}）→ Phase 3（fixed 化は structure-oracle 不整合ゼロ後に orchestrator が行う）`);
	}
	if (problems.length > 0)
		block([`対象: ${rel}`, `実装中（phase=実装|検証）の UC に未充足があります:`, ...problems.map((p) => "  - " + p)]);

	process.exit(0);
}

main();
