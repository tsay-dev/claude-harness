#!/usr/bin/env node
//
//  trace-check — トレーサビリティ検査（harness 同梱ツール。依存ゼロの Node）
//
//  目標状態: 「テストと本検査がすべて緑 ＝ docs と実装の辻褄が機械検査の範囲で合っている」。
//  被覆マトリクスは手書きせず、ここで生成する（--index で全体地図も生成。どちらもコミットしない）。
//
//  前提の構成（rules/develop/docs.md §10–11）:
//    docs/goals/<GOAL-nn-slug>/GOAL.md
//                             └ <UC-nnn-slug>/UC.md + REQ-*.md + contract.yaml（縦は互いに素）
//    docs/rules/BR-*.md  docs/nfr/NFR-*.md  docs/adr/ADR-*.md（横は中央）
//    所属の SSOT は frontmatter。パスは配置であり、両者の整合を C9 が検査する。
//    各 REQ の「## 検証方針」は分割クラス `#name` を宣言する（下限 C10 / 上限 C11）。
//
//  既存プロジェクトへの漸進導入（baseline ラチェット）:
//    --update-baseline で現状違反を台帳化 → 以降は新規違反のみ FAIL → 返済で縮め、空になったら --strict へ。
//
//  検査項目:
//    C1   すべての active な REQ が 1 件以上のテストに被覆されているか
//    C2   すべての active な REQ に「## 検証方針」セクションがあるか
//    C3   テストの @covers が実在する REQ を指しているか
//    C4   すべての BR がいずれかの UC / REQ から参照されているか（死んだ規則）
//    C5   コードの @implements が実在する ID を指しているか（孤児参照）
//    C6   レイヤの依存方向が内向きに保たれているか（traceconfig の layering）
//    C7   実装のエラーコード ⊆ 契約語彙（docs/_shared/components.yaml の errorCodes）か
//    C8   すべての active な GOAL が 1 件以上の UC から参照されているか
//    C9   パス整合: GOAL / UC ディレクトリ名と frontmatter id・goal の一致、ノード定義ファイルの存在、
//         REQ のファイル名 = id、REQ が自身の uc の直下にあること
//    C10  宣言された全分割クラスに 1 件以上のテストがあるか（未検証クラス / クラス未宣言）
//    C11  全テストが宣言済みクラスを指しているか（方針にないテスト ＝ 生成上限違反）
//    C12  同一 ID が複数箇所で定義されていないか（採番衝突）
//    C13  enforced_at に database を含む BR が、スキーマ源（traceconfig の schema.files）から @implements されているか
//         （DB 制約の存在を機械で担保する。制約が本当に規則を強制するかは structure-oracle の判断に残る）
//
//  使い方:
//    node trace-check.mjs [--root .] [--config traceconfig.json]      検査（baseline との差分で判定）
//    node trace-check.mjs --update-baseline                            現状の違反を baseline に記録
//    node trace-check.mjs --strict                                     baseline を無視して全違反を FAIL
//    node trace-check.mjs --index                                      1 行 1 ID の索引を出力（生成物）
//    node trace-check.mjs --next <goal|uc|req|br|nfr|adr>              次の空き ID を出力（採番はこれで / R-204）
//    node trace-check.mjs --only C9,C12                                指定の検査項目だけ判定（producer の自己検査用）
//
//  終了コード: 0 = 新規違反なし / 1 = 新規違反あり / 2 = 使い方エラー
//

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const CLASS_DECL_RE = /^\s*-\s*`#([\w-]+)`/gm;
const GOAL_DIR_RE = /^(GOAL-\d+)/;
const UC_DIR_RE = /^(UC-\d+)/;
const ID_KIND_RE = /^(GOAL|UC|REQ|BR|NFR|ADR)-\d+$/;
const POLICY_HEADING = "## 検証方針";

//  ---- ファイル入出力 -----------------------------------------------------------

const read = (p) => readFileSync(p, "utf8");

function frontmatter(path) {
	const fm = {};
	const lines = read(path).split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return fm;
	for (const line of lines.slice(1)) {
		if (line.trim() === "---") break;
		const m = line.match(/^(\w+):\s*(.+)$/);
		if (m) fm[m[1]] = m[2].replace(/\s+#.*$/, "").trim();
	}
	return fm;
}

function listDirs(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => join(dir, d.name))
		.sort();
}

function listFiles(dir, pred) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isFile() && pred(d.name))
		.map((d) => join(dir, d.name))
		.sort();
}

function walk(dir, exts) {
	const out = [];
	if (!existsSync(dir)) return out;
	for (const d of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, d.name);
		if (d.isDirectory()) out.push(...walk(p, exts));
		else if (exts.some((e) => d.name.endsWith(e))) out.push(p);
	}
	return out.sort();
}

//  ---- 設定 -------------------------------------------------------------------

function loadConfig(root, configPath) {
	if (!existsSync(configPath)) {
		console.error(`trace-check: 設定が無い: ${configPath}（テンプレート .claude/templates/develop/traceconfig.json を host 直下に置く）`);
		process.exit(2);
	}
	const cfg = JSON.parse(read(configPath));
	cfg._root = root;
	return cfg;
}

const p = (cfg, keyPath) => join(cfg._root, keyPath.split(".").reduce((n, k) => n[k], cfg));
const rel = (cfg, path) => relative(cfg._root, path).split("\\").join("/");

//  ---- 1 ID 1 ファイルの定義（横の ID 空間） ---------------------------------------

function definedInDir(dir) {
	const result = {}; //  id -> status
	for (const f of walk(dir, [".md"])) {
		const fm = frontmatter(f);
		if (fm.id) result[fm.id] = fm.status || "active";
	}
	return result;
}

//  ---- ゴール集約ディレクトリの走査（縦の木） ---------------------------------------

class Corpus {
	constructor(cfg) {
		this.goals = {}; //  id -> { status, dir }
		this.ucs = {}; //  id -> { goal, status, phase, dir, goalDir, file }
		this.reqs = {}; //  id -> { uc, status, dir, goalDir, file, hasPolicy, classes }
		this.pathViolations = [];
		const goalsDir = p(cfg, "docs.goals_dir");
		const r = (x) => rel(cfg, x);

		for (const gdir of listDirs(goalsDir)) {
			const name = basename(gdir);
			if (name.startsWith("_") || name.startsWith(".")) continue; //  _shared 等は木の外
			const m = name.match(GOAL_DIR_RE);
			const dirGoal = m ? m[1] : null;
			const gfile = join(gdir, "GOAL.md");
			if (!m || !existsSync(gfile)) {
				this.pathViolations.push(`${r(gdir)}: GOAL-nn で始まる名前と直下の GOAL.md が必要`);
				continue;
			}
			const gfm = frontmatter(gfile);
			if (gfm.id !== dirGoal)
				this.pathViolations.push(`${r(gfile)}: frontmatter id (${gfm.id}) がディレクトリ名 (${dirGoal}) と一致しない`);
			this.goals[gfm.id || dirGoal] = { status: gfm.status || "active", dir: gdir };

			//  旧形式（ゴール直下の UC-*.md / REQ-*.md）は配置違反
			for (const f of listFiles(gdir, (n) => /^(UC|REQ)-\d+.*\.md$/.test(n)))
				this.pathViolations.push(`${r(f)}: UC / REQ はゴール直下ではなく UC ディレクトリ配下に置く`);

			for (const udir of listDirs(gdir)) {
				const um = basename(udir).match(UC_DIR_RE);
				const dirUc = um ? um[1] : null;
				const ufile = join(udir, "UC.md");
				if (!um || !existsSync(ufile)) {
					this.pathViolations.push(`${r(udir)}: UC-nnn で始まる名前と直下の UC.md が必要`);
					continue;
				}
				const ufm = frontmatter(ufile);
				if (ufm.id !== dirUc)
					this.pathViolations.push(`${r(ufile)}: frontmatter id (${ufm.id}) がディレクトリ名 (${dirUc}) と一致しない`);
				if (ufm.goal !== dirGoal)
					this.pathViolations.push(`${r(ufile)}: goal (${ufm.goal}) が配置ディレクトリ (${dirGoal}) と一致しない`);
				const uid = ufm.id || dirUc;
				this.ucs[uid] = { goal: ufm.goal, status: ufm.status || "active", phase: ufm.phase || "", dir: udir, goalDir: gdir, file: ufile };

				for (const f of listFiles(udir, (n) => /^REQ-\d+\.md$/.test(n))) {
					const fm = frontmatter(f);
					const stem = basename(f, ".md");
					const rid = fm.id || stem;
					if (fm.id && fm.id !== stem)
						this.pathViolations.push(`${r(f)}: frontmatter id (${fm.id}) がファイル名 (${stem}) と一致しない`);
					const text = read(f);
					const idx = text.indexOf(POLICY_HEADING);
					const classes = idx >= 0 ? [...text.slice(idx).matchAll(CLASS_DECL_RE)].map((x) => x[1]) : [];
					this.reqs[rid] = { uc: fm.uc, status: fm.status || "active", dir: udir, goalDir: gdir, file: f, hasPolicy: idx >= 0, classes };
				}
			}
		}
		//  REQ の uc が、自身の配置ディレクトリの UC を指しているか
		for (const [rid, rq] of Object.entries(this.reqs)) {
			const uc = this.ucs[rq.uc || ""];
			if (!uc) this.pathViolations.push(`${rid}: uc (${rq.uc}) が未定義`);
			else if (uc.dir !== rq.dir)
				this.pathViolations.push(`${rid}: uc (${rq.uc}) は ${basename(uc.dir)}/ 配下だが、REQ は ${basename(rq.dir)}/ に配置されている`);
		}
	}
}

//  ---- 定義レジストリ（重複検出と採番） ---------------------------------------------

function collectDefinitions(cfg) {
	const registry = {}; //  id -> [file]
	for (const key of ["docs.goals_dir", "docs.rules_dir", "docs.nfr_dir", "docs.adr_dir"]) {
		const base = p(cfg, key);
		for (const f of walk(base, [".md"])) {
			const fm = frontmatter(f);
			if (fm.id && ID_KIND_RE.test(fm.id)) (registry[fm.id] ||= []).push(f);
		}
	}
	return registry;
}

function nextId(cfg, kind) {
	kind = kind.toLowerCase();
	const prefix = kind.toUpperCase() + "-";
	const pattern = cfg.id_patterns?.[kind] || "";
	const m = pattern.match(/\\d\{(\d+)\}/);
	const width = m ? Number(m[1]) : 3;
	const nums = Object.keys(collectDefinitions(cfg))
		.filter((i) => i.startsWith(prefix))
		.map((i) => Number(i.split("-")[1]));
	//  backlog の ### 見出し定義も採番対象（R-203 の例外）
	const backlog = p(cfg, "docs.goals_backlog");
	if (kind === "goal" && existsSync(backlog))
		for (const x of read(backlog).matchAll(/^###\s+GOAL-(\d+)/gm)) nums.push(Number(x[1]));
	const next = nums.length ? Math.max(...nums) + 1 : 1;
	return `${prefix}${String(next).padStart(width, "0")}`;
}

//  ---- コード側の注釈 ------------------------------------------------------------

function iterFiles(cfg, section) {
	const sec = cfg[section];
	if (!sec) return [];
	return sec.dirs.flatMap((d) => walk(join(cfg._root, d), sec.extensions));
}

//  (REQ, class|null) -> [検証箇所]。注釈は行単位の正規表現で拾う（言語非依存）
function collectTestCoverage(cfg, coversRe) {
	const coverage = new Map();
	const key = (req, k) => `${req}#${k ?? ""}`;
	for (const path of iterFiles(cfg, "tests")) {
		const lines = read(path).split(/\r?\n/);
		lines.forEach((line, i) => {
			for (const m of line.matchAll(coversRe)) {
				const k = key(m[1], m[2] || null);
				if (!coverage.has(k)) coverage.set(k, { req: m[1], klass: m[2] || null, where: [] });
				coverage.get(k).where.push(`${basename(path)}:${i + 1}`);
			}
		});
	}
	return coverage;
}

function collectSourceAnnotations(cfg, implRe, files = iterFiles(cfg, "source")) {
	const found = {}; //  id -> Set<file>
	for (const path of files)
		for (const m of read(path).matchAll(implRe)) (found[m[1]] ||= new Set()).add(rel(cfg, path));
	return found;
}

//  スキーマ源（migration / schema.prisma / モデル定義）。R-102 で DB 設計の SSOT は native 形式にあり、docs には無い
function schemaFiles(cfg) {
	const s = cfg.schema;
	if (!s) return null;
	const out = [];
	for (const f of s.files || []) if (existsSync(join(cfg._root, f))) out.push(join(cfg._root, f));
	for (const d of s.dirs || []) out.push(...walk(join(cfg._root, d), s.extensions || [".sql", ".prisma"]));
	return out;
}

const DB_ENFORCED_RE = /\b(database|db)\b/i;

function checkLayering(cfg) {
	const lay = cfg.layering;
	if (!lay) return [];
	const root = join(cfg._root, lay.root);
	const violations = [];
	for (const path of walk(root, cfg.source.extensions)) {
		const parts = relative(root, path).split(/[\\/]/);
		const layer = parts.length > 1 ? parts[0] : null;
		if (!layer || !(layer in lay.forbidden)) continue;
		const text = read(path);
		for (const forbidden of lay.forbidden[layer]) {
			const pats = lay.import_patterns.map((t) => new RegExp(t.split("{layer}").join(forbidden), "m"));
			if (pats.some((re) => re.test(text))) violations.push(`${rel(cfg, path)}: ${layer} 層が ${forbidden} 層へ依存`);
		}
	}
	return violations;
}

//  契約語彙（_shared の errorCodes キー）を行スキャンで読む。厳格な構文判定は spec-lint の仕事
function sharedErrorCodes(cfg) {
	const file = p(cfg, "docs.shared");
	if (!existsSync(file)) return null;
	const codes = new Set();
	let inBlock = false;
	for (const raw of read(file).split(/\r?\n/)) {
		const line = raw.replace(/\s+#.*$/, "");
		if (/^errorCodes:/.test(line)) {
			inBlock = true;
			const inline = line.match(/^errorCodes:\s*\{([^}]*)\}/);
			if (inline) for (const kv of inline[1].split(",")) if (kv.trim()) codes.add(kv.split(":")[0].trim());
			continue;
		}
		if (inBlock) {
			if (/^\S/.test(line) && line.trim() !== "") break;
			const m = line.match(/^\s+([A-Z][A-Z0-9_]*):/);
			if (m) codes.add(m[1]);
		}
	}
	return codes;
}

function checkContractConformance(cfg) {
	const con = cfg.contract;
	if (!con) return [];
	const src = join(cfg._root, con.error_source);
	if (!existsSync(src)) return [`contract.error_source が無い: ${con.error_source}`];
	const exclude = new Set(con.exclude_codes || []);
	const impl = new Set([...read(src).matchAll(new RegExp(con.error_code_pattern, "g"))].map((m) => m[1]));
	for (const c of exclude) impl.delete(c);
	const shared = sharedErrorCodes(cfg);
	if (shared === null) return [`契約語彙 ${cfg.docs.shared} が無い（C7 は errorCodes と突き合わせる）`];
	return [...impl].filter((c) => !shared.has(c)).sort().map((c) => `エラーコード ${c} が実装にあるが契約語彙（${cfg.docs.shared} の errorCodes）に無い`);
}

//  ---- 検査本体 ---------------------------------------------------------------

function runChecks(cfg) {
	const coversRe = new RegExp(cfg.covers_pattern, "g");
	const implRe = new RegExp(cfg.implements_pattern, "g");
	const brRe = new RegExp(cfg.id_patterns.br, "g");

	const corpus = new Corpus(cfg);
	const brs = definedInDir(p(cfg, "docs.rules_dir"));
	const coverage = collectTestCoverage(cfg, coversRe);
	const schema = schemaFiles(cfg);
	const schemaImplements = schema ? collectSourceAnnotations(cfg, implRe, schema) : {};
	const implementsMap = collectSourceAnnotations(cfg, implRe);
	for (const [id, files] of Object.entries(schemaImplements)) for (const x of files) (implementsMap[id] ||= new Set()).add(x);

	const reqTests = {}; //  req -> [where]
	for (const c of coverage.values()) (reqTests[c.req] ||= []).push(...c.where);

	const referencedBrs = new Set();
	for (const rq of Object.values(corpus.reqs)) for (const m of read(rq.file).matchAll(brRe)) referencedBrs.add(m[0]);
	for (const uc of Object.values(corpus.ucs)) for (const m of read(uc.file).matchAll(brRe)) referencedBrs.add(m[0]);
	const referencedGoals = new Set(Object.values(corpus.ucs).filter((u) => u.status !== "withdrawn").map((u) => u.goal));

	const activeReqs = Object.keys(corpus.reqs).filter((r) => corpus.reqs[r].status === "active").sort();
	const failures = [];

	for (const req of activeReqs) if (!reqTests[req]) failures.push(`[C1] ${req} を被覆するテストが存在しない（未検証の要求）`);
	for (const req of activeReqs) if (!corpus.reqs[req].hasPolicy) failures.push(`[C2] ${req} のファイルに「${POLICY_HEADING}」セクションがない`);
	for (const req of Object.keys(reqTests).sort()) if (!(req in corpus.reqs)) failures.push(`[C3] テストが未定義の ${req} を @covers している`);
	for (const br of Object.keys(brs).sort()) if (!referencedBrs.has(br)) failures.push(`[C4] ${br} がどの UC / REQ からも参照されていない（死んだ規則）`);
	const known = new Set([...Object.keys(corpus.reqs), ...Object.keys(brs), ...Object.keys(corpus.ucs)]);
	for (const ident of Object.keys(implementsMap).sort())
		if (!known.has(ident)) failures.push(`[C5] コードが未定義の ${ident} を参照（${[...implementsMap[ident]].sort().join(", ")}）`);
	for (const v of checkLayering(cfg)) failures.push(`[C6] ${v}`);
	for (const v of checkContractConformance(cfg)) failures.push(`[C7] ${v}`);
	for (const [goal, g] of Object.entries(corpus.goals).sort())
		if (g.status === "active" && !referencedGoals.has(goal)) failures.push(`[C8] ${goal} (active) を実現する UC が存在しない`);
	for (const v of corpus.pathViolations) failures.push(`[C9] ${v}`);

	//  C10: 宣言クラスの下限被覆 / クラス未宣言
	for (const req of activeReqs) {
		const classes = corpus.reqs[req].classes;
		if (classes.length === 0) {
			failures.push(`[C10] ${req} に分割クラスが宣言されていない（検証方針に \`#name\` を列挙すること）`);
			continue;
		}
		for (const k of classes) if (!coverage.has(`${req}#${k}`)) failures.push(`[C10] ${req}#${k} を被覆するテストが存在しない（未検証の分割クラス）`);
	}

	//  C11: 生成上限 — 全テストは宣言済みクラスを指す
	const sortedCov = [...coverage.values()].sort((a, b) => (a.req + (a.klass ?? "")).localeCompare(b.req + (b.klass ?? "")));
	for (const c of sortedCov) {
		if (!(c.req in corpus.reqs)) continue; //  C3 で報告済み
		const declared = corpus.reqs[c.req].classes;
		const w = c.where.join(", ");
		if (c.klass === null) failures.push(`[C11] ${w}: クラス指定がない（@covers ${c.req}#<class> 形式にすること）`);
		else if (!declared.includes(c.klass))
			failures.push(`[C11] ${w}: 未宣言のクラス ${c.req}#${c.klass} を指している。テストを増やす前に検証方針へクラスを宣言すること（生成上限）`);
	}

	//  C13: DB で強制する規則にはスキーマ側の制約（@implements）が要る。schema 未設定なら判定しない
	if (schema) {
		for (const f of walk(p(cfg, "docs.rules_dir"), [".md"])) {
			const fm = frontmatter(f);
			if (!fm.id || fm.status === "withdrawn" || !DB_ENFORCED_RE.test(fm.enforced_at || "")) continue;
			if (!schemaImplements[fm.id])
				failures.push(`[C13] ${fm.id} は enforced_at に database を含むが、スキーマ源（${(cfg.schema.files || cfg.schema.dirs || []).join(", ")}）から @implements されていない（制約のコメントに @implements ${fm.id} を書く）`);
		}
	}

	//  C12: 重複 ID（採番衝突）
	for (const [ident, files] of Object.entries(collectDefinitions(cfg)).sort())
		if (files.length > 1) failures.push(`[C12] ${ident} が複数箇所で定義されている（${files.map((f) => rel(cfg, f)).join(", ")}）`);

	//  ---- レポート（被覆マトリクス。本出力が SSOT / 手書き禁止） ----
	const lines = ["=".repeat(68), " トレーサビリティ検査（被覆マトリクスは本出力が SSOT / 手書き禁止）", "=".repeat(68)];
	const nActiveGoals = Object.values(corpus.goals).filter((g) => g.status === "active").length;
	const nTests = [...coverage.values()].reduce((n, c) => n + c.where.length, 0);
	const nClasses = Object.values(corpus.reqs).reduce((n, r) => n + r.classes.length, 0);
	lines.push(
		`  GOAL: ${Object.keys(corpus.goals).length} (active: ${nActiveGoals}) / UC: ${Object.keys(corpus.ucs).length}` +
			` / REQ: ${Object.keys(corpus.reqs).length} / 分割クラス: ${nClasses} / BR: ${Object.keys(brs).length} / テスト: ${nTests}`,
	);
	for (const goal of Object.keys(corpus.goals).sort()) {
		const g = corpus.goals[goal];
		lines.push("-".repeat(68), ` ${goal} (${basename(g.dir)}/)`);
		for (const uid of Object.keys(corpus.ucs).sort().filter((u) => corpus.ucs[u].goalDir === g.dir)) {
			const u = corpus.ucs[uid];
			lines.push(`  ${uid} (${basename(u.dir)}/)${u.phase ? `  [${u.phase}]` : ""}`);
			for (const req of Object.keys(corpus.reqs).sort().filter((r) => corpus.reqs[r].dir === u.dir)) {
				const info = corpus.reqs[req];
				lines.push(`    ${req}  ${req in implementsMap ? "impl:o" : "impl:-"}  [${info.status}]`);
				for (const k of info.classes) {
					const hit = coverage.get(`${req}#${k}`)?.where || [];
					lines.push(`      ${hit.length ? "OK " : "NG "}#${k.padEnd(22)} ${hit.join(", ") || "(テストなし)"}`);
				}
			}
		}
	}
	lines.push("-".repeat(68), " BR -> 実装（生成）");
	for (const br of Object.keys(brs).sort()) {
		const files = [...(implementsMap[br] || [])].sort();
		lines.push(`  ${files.length ? "OK " : "NG "}${br}  ${files.join(", ") || "(実装参照なし)"}`);
	}
	lines.push("=".repeat(68));
	return { failures, report: lines.join("\n") };
}

//  ---- 索引（派生物: ファイルへコミットしない） ----------------------------------------

function printIndex(cfg) {
	const firstQuote = (path) => {
		for (const line of read(path).split(/\r?\n/)) if (line.startsWith("> ")) return line.slice(2).trim();
		return "";
	};
	const corpus = new Corpus(cfg);
	const out = ["# 索引（生成物 / trace-check --index。コミット禁止）"];
	for (const goal of Object.keys(corpus.goals).sort()) {
		const g = corpus.goals[goal];
		out.push("", `## ${goal} [${g.status}] ${basename(g.dir)}/`, `   ${firstQuote(join(g.dir, "GOAL.md"))}`);
		for (const [uid, u] of Object.entries(corpus.ucs).sort()) {
			if (u.goalDir !== g.dir) continue;
			out.push(`   ${uid}/ [${u.status}${u.phase ? ` / ${u.phase}` : ""}]  ${frontmatter(u.file).title || ""}`);
			for (const [rid, r] of Object.entries(corpus.reqs).sort()) {
				if (r.dir !== u.dir) continue;
				let text = firstQuote(r.file);
				if (text.length > 42) text = text.slice(0, 42) + "…";
				out.push(`     ${rid} [${frontmatter(r.file).pattern || "?"}] ${text}`, `            classes: ${r.classes.map((k) => `#${k}`).join(" ")}`);
			}
		}
	}
	out.push("", "## rules");
	for (const f of walk(p(cfg, "docs.rules_dir"), [".md"])) {
		const fm = frontmatter(f);
		if (fm.id) out.push(`   ${fm.id}  ${fm.title || ""}  (enforced_at: ${fm.enforced_at || "?"})`);
	}
	out.push("", "## nfr");
	for (const f of walk(p(cfg, "docs.nfr_dir"), [".md"])) {
		const fm = frontmatter(f);
		if (fm.id) out.push(`   ${fm.id}  [${fm.category || "?"}]  ${firstQuote(f).slice(0, 60)}`);
	}
	out.push("", "## adr");
	for (const f of walk(p(cfg, "docs.adr_dir"), [".md"])) {
		const fm = frontmatter(f);
		if (fm.id) out.push(`   ${fm.id}  [${fm.status || "?"}]  ${fm.title || ""}`);
	}
	console.log(out.join("\n"));
}

//  ---- 引数と main ---------------------------------------------------------------

function parseArgs(argv) {
	const opts = { root: ".", config: null, updateBaseline: false, strict: false, index: false, next: null, only: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--root") opts.root = argv[++i];
		else if (a === "--config") opts.config = argv[++i];
		else if (a === "--update-baseline") opts.updateBaseline = true;
		else if (a === "--strict") opts.strict = true;
		else if (a === "--index") opts.index = true;
		else if (a === "--next") opts.next = argv[++i];
		else if (a === "--only") opts.only = new Set(argv[++i].split(",").map((s) => s.trim().toUpperCase()));
		else {
			console.error(`trace-check: 不明な引数 ${a}`);
			process.exit(2);
		}
	}
	return opts;
}

function main() {
	const opts = parseArgs(process.argv.slice(2));
	const root = resolve(opts.root);
	const cfg = loadConfig(root, opts.config ? resolve(opts.config) : join(root, "traceconfig.json"));
	const baselinePath = join(root, cfg.baseline_file || ".trace-baseline.json");

	if (opts.next) {
		if (!["goal", "uc", "req", "br", "nfr", "adr"].includes(opts.next.toLowerCase())) {
			console.error("trace-check --next: goal|uc|req|br|nfr|adr のいずれか");
			return 2;
		}
		console.log(nextId(cfg, opts.next));
		return 0;
	}
	if (opts.index) {
		printIndex(cfg);
		return 0;
	}

	let { failures, report } = runChecks(cfg);
	if (opts.only) failures = failures.filter((f) => opts.only.has((f.match(/^\[(C\d+)\]/) || [])[1]));
	if (!opts.only) console.log(report);

	if (opts.updateBaseline) {
		writeFileSync(baselinePath, JSON.stringify(failures, null, 2) + "\n");
		console.log(`\nbaseline を更新: ${failures.length} 件を記録（${basename(baselinePath)}）`);
		return 0;
	}

	let baseline = [];
	if (existsSync(baselinePath) && !opts.strict && !opts.only) baseline = JSON.parse(read(baselinePath));
	const fresh = failures.filter((f) => !baseline.includes(f));
	const knownOnes = failures.filter((f) => baseline.includes(f));
	const resolved = baseline.filter((b) => !failures.includes(b));

	if (knownOnes.length) {
		console.log(`\nWARN（baseline 済み ${knownOnes.length} 件 / 返済対象）:`);
		for (const f of knownOnes) console.log(`  ~ ${f}`);
	}
	if (resolved.length) console.log(`\n解消済み ${resolved.length} 件 -> --update-baseline で baseline を縮めること`);
	if (fresh.length) {
		console.log(`\nFAIL（新規違反 ${fresh.length} 件）:`);
		for (const f of fresh) console.log(`  x ${f}`);
		console.log("\n-> 上流 SSOT を更新してから再導出すること（逆流ルール R-801）");
		return 1;
	}
	console.log("\n新規違反なし。" + (knownOnes.length ? "" : "欠落・孤児・未宣言テスト・重複した正はありません。"));
	return 0;
}

process.exit(main());
