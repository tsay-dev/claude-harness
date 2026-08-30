#!/usr/bin/env python3
"""sonagi — L2/L3 の決定的な組み立て（build）と、成果物の機械検査（check）。

このスクリプトは sonagi skill の「機械オラクル」である。
LLM に算数（累積秒・合計尺・1対1の対応）をさせず、ここで決定的に落とす。
書式の SSOT は .claude/rules/sonagi/schema.md。
"""
import argparse
import json
import os
import re
import sys

# --- 閉じた語彙（SSOT: rules/sonagi/schema.md）--------------------------------
ROLES = {"hook", "setup", "body", "turn", "cta"}
LAYOUTS = {"full-bleed", "split", "caption-over", "title-card", "side-by-side"}
TRANSITIONS = {"cut", "fade", "slide", "zoom", "whip"}
SFX = {"none", "whoosh", "pop", "ding", "impact", "swell"}
BGM_MOODS = {"upbeat", "calm", "tense", "warm", "neutral"}

IMAGE_KEYS = ["subject", "composition", "lighting", "style", "aspect", "negative"]
ASSET_KEYS = ["scene_id", "role", "duration_sec", "narration", "caption", "telop",
              "image", "sfx", "layout", "transition_in", "transition_out"]

FORMAT_PRESETS = {
    "short": {"resolution": "1080x1920", "fps": 30, "aspect": "9:16"},
    "long": {"resolution": "1920x1080", "fps": 30, "aspect": "16:9"},
}

NARRATION_TOLERANCE = 0.10   # 文字予算からの許容ずれ。ここが唯一の権威（rules/agent は数値を持たない）
TELOP_CHAR_SOFT_LIMIT = 12   # 「3語以内」の機械的な目安（日本語）


class Findings:
    def __init__(self):
        self.items = []

    def error(self, code, where, msg):
        self.items.append({"level": "ERROR", "code": code, "where": where, "message": msg})

    def warn(self, code, where, msg):
        self.items.append({"level": "WARN", "code": code, "where": where, "message": msg})

    @property
    def errors(self):
        return [i for i in self.items if i["level"] == "ERROR"]

    @property
    def warnings(self):
        return [i for i in self.items if i["level"] == "WARN"]


# --- 最小の frontmatter パーサ（外部依存を持たない）----------------------------
def parse_frontmatter(text):
    """--- ... --- で囲まれたフラットな key: value を dict にする。"""
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?", text, re.S)
    if not m:
        return {}, text
    body = text[m.end():]
    fm = {}
    for line in m.group(1).splitlines():
        line = line.split("#", 1)[0].rstrip()
        if not line.strip() or ":" not in line:
            continue
        k, v = line.split(":", 1)
        v = v.strip().strip('"').strip("'")
        if re.fullmatch(r"-?\d+", v):
            v = int(v)
        elif re.fullmatch(r"-?\d+\.\d+", v):
            v = float(v)
        fm[k.strip()] = v
    return fm, body


def parse_script(path, f):
    """script.md を {frontmatter, rows} にする。rows は表の1行＝1シーン。"""
    if not os.path.exists(path):
        f.error("C1", "script.md", "台本が無い。script-writer をまだ回していない")
        return None
    text = open(path, encoding="utf-8").read()
    fm, body = parse_frontmatter(text)
    for key in ("video_id", "format", "duration_sec", "speech_rate"):
        if key not in fm:
            f.error("C1", "script.md", f"frontmatter に `{key}` が無い")
    rows = []
    header_seen = False
    for line in body.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        if not header_seen:
            if cells and cells[0].lower() == "scene_id":
                header_seen = True
            continue
        if all(re.fullmatch(r":?-{2,}:?", c) for c in cells if c):
            continue
        if len(cells) < 5:
            f.error("C2", "script.md", f"表の列が足りない: {s[:60]}")
            continue
        scene_id, role, dur, budget, narration = cells[0], cells[1], cells[2], cells[3], cells[4]
        try:
            dur_v = float(dur)
        except ValueError:
            f.error("C2", scene_id, f"duration_sec が数値でない: {dur!r}")
            dur_v = 0.0
        try:
            budget_v = int(float(budget))
        except ValueError:
            f.error("C2", scene_id, f"char_budget が数値でない: {budget!r}")
            budget_v = 0
        rows.append({"scene_id": scene_id, "role": role, "duration_sec": dur_v,
                     "char_budget": budget_v, "narration": narration})
    if not header_seen:
        f.error("C2", "script.md", "`| scene_id | role | duration_sec | char_budget | narration |` の表が無い")
    return {"frontmatter": fm, "rows": rows}


def check_script(script, f):
    fm, rows = script["frontmatter"], script["rows"]
    if not rows:
        f.error("C2", "script.md", "シーンが1つも無い")
        return
    # C2 連番・重複・欠番
    seen = set()
    for i, r in enumerate(rows, start=1):
        expected = f"SC-{i:02d}"
        if r["scene_id"] in seen:
            f.error("C2", r["scene_id"], "scene_id が重複している")
        seen.add(r["scene_id"])
        if r["scene_id"] != expected:
            f.error("C2", r["scene_id"], f"scene_id が連番でない（{expected} を期待）")
        if r["role"] not in ROLES:
            f.error("C7", r["scene_id"], f"role `{r['role']}` は閉じた語彙外。許容: {sorted(ROLES)}")
    # C3 尺の合計 == 宣言尺
    total = round(sum(r["duration_sec"] for r in rows), 3)
    declared = fm.get("duration_sec")
    if isinstance(declared, (int, float)) and abs(total - declared) > 1e-6:
        f.error("C3", "script.md", f"尺の合計 {total}秒 が宣言尺 {declared}秒 に一致しない")
    # C4 文字予算 == 尺 × 話速
    rate = fm.get("speech_rate")
    if isinstance(rate, (int, float)):
        for r in rows:
            expect = round(r["duration_sec"] * rate)
            if abs(r["char_budget"] - expect) > 1:
                f.error("C4", r["scene_id"],
                        f"char_budget {r['char_budget']} が尺×話速 {expect} と合わない")
    # C5 ナレーション長が予算内
    for r in rows:
        n = len(r["narration"])
        if r["char_budget"] > 0:
            lo = r["char_budget"] * (1 - NARRATION_TOLERANCE)
            hi = r["char_budget"] * (1 + NARRATION_TOLERANCE)
            if not (lo <= n <= hi):
                f.error("C5", r["scene_id"],
                        f"ナレーション {n}文字 が予算 {r['char_budget']}文字 ±{int(NARRATION_TOLERANCE*100)}% を外れる")


def load_assets(video_dir, script, f):
    assets_dir = os.path.join(video_dir, "assets")
    ids = [r["scene_id"] for r in script["rows"]]
    assets = {}
    for sid in ids:
        p = os.path.join(assets_dir, f"{sid}.json")
        if not os.path.exists(p):
            f.error("C6", sid, "素材ファイルが無い（このシーンだけ asset-generator を再起動する）")
            continue
        try:
            assets[sid] = json.load(open(p, encoding="utf-8"))
        except json.JSONDecodeError as e:
            f.error("C6", sid, f"素材ファイルが JSON として壊れている: {e}")
    # 孤児の素材（台本から消えたシーンの残骸）
    if os.path.isdir(assets_dir):
        for name in sorted(os.listdir(assets_dir)):
            if not name.endswith(".json"):
                continue
            stem = name[:-5]
            if stem != "THUMB" and stem not in ids:
                f.error("C6", stem, "台本に無い素材ファイルが残っている（削除するか台本に足す）")
    return assets


def check_assets(script, assets, f):
    by_id = {r["scene_id"]: r for r in script["rows"]}
    for sid, a in assets.items():
        row = by_id[sid]
        for k in ASSET_KEYS:
            if k not in a:
                f.error("C7", sid, f"必須キー `{k}` が無い")
        if a.get("scene_id") != sid:
            f.error("C7", sid, f"scene_id がファイル名と一致しない: {a.get('scene_id')!r}")
        for key, vocab in (("role", ROLES), ("layout", LAYOUTS), ("sfx", SFX),
                           ("transition_in", TRANSITIONS), ("transition_out", TRANSITIONS)):
            v = a.get(key)
            if v is not None and v not in vocab:
                f.error("C7", sid, f"{key} `{v}` は閉じた語彙外。許容: {sorted(vocab)}")
        # C8 台本が正。素材側で書き換えない
        if a.get("narration") != row["narration"]:
            f.error("C8", sid, "narration が台本と一致しない（台本が正。素材側で書き換えない）")
        # C9 尺の一致
        if a.get("duration_sec") != row["duration_sec"]:
            f.error("C9", sid, f"duration_sec が台本 {row['duration_sec']} と一致しない: {a.get('duration_sec')}")
        # C11 画像プロンプト
        img = a.get("image")
        if not isinstance(img, dict):
            f.error("C11", sid, "image がオブジェクトでない")
        else:
            for k in IMAGE_KEYS:
                if not str(img.get(k, "")).strip():
                    f.error("C11", sid, f"image.{k} が空")
            for k in ("subject", "composition", "lighting", "style", "negative"):
                v = str(img.get(k, ""))
                if re.search(r"[ぁ-んァ-ン一-龥]", v):
                    f.error("C11", sid, f"image.{k} は英語で書く（サービス非依存の中立記述）")
                if re.search(r"--ar|::|\(\s*[\w ]+\s*:\s*[\d.]+\s*\)", v):
                    f.error("C11", sid, f"image.{k} に特定サービスの記法が混ざっている")
        # C12 テロップの長さ
        telop = str(a.get("telop", ""))
        if len(telop) > TELOP_CHAR_SOFT_LIMIT:
            f.warn("C12", sid, f"telop が {len(telop)}文字（3語＝{TELOP_CHAR_SOFT_LIMIT}文字以内が目安）")
        # C12 キャプションがナレーションの書き起こしになっていないか（部分一致でも撃つ）
        cap, nar = str(a.get("caption", "")), str(a.get("narration", ""))
        if cap and nar and len(cap) >= 6 and (cap in nar or nar in cap):
            f.error("C12", sid, "caption が narration の一部をそのまま写している（耳と目で同じ情報を処理させている）")
        if telop and cap and len(telop) >= 4 and (telop in cap or cap in telop):
            f.warn("C12", sid, "telop と caption が重なっている（同じコマに同じ語が二重に出る）")


def find_channel(video_dir):
    """videos/<format>/<id>/ から上に辿って channel/ を探す。"""
    d = os.path.abspath(video_dir)
    for _ in range(6):
        d = os.path.dirname(d)
        c = os.path.join(d, "channel")
        if os.path.isdir(c):
            return c
    return None


def canonical_style(channel_dir):
    """channel/style.md が `image.<key>` 見出し＋コードブロックで宣言した正規文字列を全て拾う。

    どのキーを固定するかは channel の裁量である（`style` / `negative` は常に固定したいが、
    `lighting` を場面ごとに変えたいチャンネルもある）。**宣言されたものだけ**を強制する。
    """
    if not channel_dir:
        return {}
    p = os.path.join(channel_dir, "style.md")
    if not os.path.exists(p):
        return {}
    text = open(p, encoding="utf-8").read()
    out = {}
    for m in re.finditer(r"^#+[^\n]*\bimage\.([a-z_]+)[^\n]*\n+```[^\n]*\n(.*?)\n```",
                         text, re.S | re.M):
        out["image." + m.group(1)] = m.group(2).strip()
    return out


def check_visual_consistency(video_dir, script, assets, thumb, f):
    """並列生成が構造的に生む「画風の割れ」と「境界の食い違い」を機械で撃つ（C14/C15/C16）。

    どちらも1シーンだけ見ていては原理的に見えない。横断でしか判定できないので、
    judge の文脈を毎回これに使わせず、ここで決定的に落とす。
    """
    items = dict(assets)
    if thumb:
        items["THUMB"] = thumb

    # C14 全素材の image.style / image.negative が同一文字列か
    for key in ("style", "negative"):
        vals = {}
        for sid, a in items.items():
            v = str((a.get("image") or {}).get(key, "")).strip()
            vals.setdefault(v, []).append(sid)
        if len(vals) > 1:
            shape = "; ".join(f"{sorted(ids)}→{v[:40]!r}" for v, ids in sorted(vals.items()))
            f.error("C14", "assets/", f"image.{key} が {len(vals)} 通りに割れている: {shape}")

    # C16 channel/style.md が宣言した正規文字列と一致するか
    canon = canonical_style(find_channel(video_dir))
    for key, want in sorted(canon.items()):
        short = key.split(".", 1)[1]
        bad = [sid for sid, a in items.items()
               if str((a.get("image") or {}).get(short, "")).strip() != want]
        if bad:
            f.error("C16", "assets/", f"{key} が channel/style.md の正規文字列と違う: {sorted(bad)}")

    # C15 シーン境界の transition_out ⇄ 次の transition_in
    ids = [r["scene_id"] for r in script["rows"]]
    for a_id, b_id in zip(ids, ids[1:]):
        a, b = assets.get(a_id), assets.get(b_id)
        if not a or not b:
            continue
        out_, in_ = a.get("transition_out"), b.get("transition_in")
        if out_ != in_:
            f.error("C15", f"{a_id}→{b_id}",
                    f"境界の演出が食い違っている（{a_id}.transition_out={out_} / {b_id}.transition_in={in_}）")


def load_thumb(video_dir, f):
    p = os.path.join(video_dir, "assets", "THUMB.json")
    if not os.path.exists(p):
        f.error("C10", "THUMB", "サムネ定義が無い（publisher をまだ回していない）")
        return None
    try:
        t = json.load(open(p, encoding="utf-8"))
    except json.JSONDecodeError as e:
        f.error("C10", "THUMB", f"JSON として壊れている: {e}")
        return None
    if t.get("layout") not in LAYOUTS:
        f.error("C10", "THUMB", f"layout `{t.get('layout')}` は閉じた語彙外")
    if len(str(t.get("telop", ""))) > TELOP_CHAR_SOFT_LIMIT:
        f.warn("C10", "THUMB", "telop が長い（3語以内・高コントラストで判別させる）")
    if "duration_sec" in t or "transition_in" in t:
        f.error("C10", "THUMB", "サムネは時間軸を持たない（duration_sec / transition_* を持たせない）")
    return t


def build(video_dir, script, assets, thumb):
    fm = script["frontmatter"]
    fmt = fm.get("format", "short")
    preset = FORMAT_PRESETS.get(fmt, FORMAT_PRESETS["short"])
    scenes, t = [], 0.0
    for r in script["rows"]:
        a = assets.get(r["scene_id"], {})
        ids = [f"{r['scene_id']}.narration", f"{r['scene_id']}.caption",
               f"{r['scene_id']}.telop", f"{r['scene_id']}.image"]
        if a.get("sfx", "none") != "none":
            ids.append(f"{r['scene_id']}.sfx")
        scenes.append({
            "scene_id": r["scene_id"], "role": r["role"],
            "start_sec": round(t, 3), "duration_sec": r["duration_sec"],
            "assets": ids,
            "layout": a.get("layout"), "transition_in": a.get("transition_in"),
            "transition_out": a.get("transition_out"),
        })
        t += r["duration_sec"]
    total = round(t, 3)
    scenes_doc = {"video_id": fm.get("video_id"), "format": fmt, **preset, "scenes": scenes}
    if thumb:
        scenes_doc["thumbnail"] = {"assets": ["THUMB.telop", "THUMB.image"],
                                   "layout": thumb.get("layout")}
    timeline_doc = {
        "video_id": fm.get("video_id"), "total_duration_sec": total, **preset,
        "scene_order": [s["scene_id"] for s in scenes],
        "bgm": {"mood": fm.get("bgm_mood", "neutral"), "start_sec": 0,
                "duration_sec": total, "duck_under_narration": True},
    }
    return scenes_doc, timeline_doc


def check_built(video_dir, script, f):
    """生成済みの scenes.json / timeline.json が台本と整合しているか（C13）。"""
    sp = os.path.join(video_dir, "scenes.json")
    tp = os.path.join(video_dir, "timeline.json")
    for p, label in ((sp, "scenes.json"), (tp, "timeline.json")):
        if not os.path.exists(p):
            f.error("C13", label, "未生成（`sonagi build` を回す）")
            return
    s = json.load(open(sp, encoding="utf-8"))
    tl = json.load(open(tp, encoding="utf-8"))
    rows = script["rows"]
    if len(s.get("scenes", [])) != len(rows):
        f.error("C13", "scenes.json",
                f"コマ数 {len(s.get('scenes', []))} が台本の行数 {len(rows)} と一致しない")
    acc = 0.0
    for sc, r in zip(s.get("scenes", []), rows):
        if sc.get("scene_id") != r["scene_id"]:
            f.error("C13", "scenes.json", f"順序が台本とずれている: {sc.get('scene_id')} != {r['scene_id']}")
        if abs(sc.get("start_sec", -1) - acc) > 1e-6:
            f.error("C13", sc.get("scene_id"), f"start_sec が累積和と合わない（{acc} を期待）")
        acc += r["duration_sec"]
    declared = script["frontmatter"].get("duration_sec")
    if abs(tl.get("total_duration_sec", -1) - round(acc, 3)) > 1e-6:
        f.error("C13", "timeline.json", "total_duration_sec がコマの合計と一致しない")
    if isinstance(declared, (int, float)) and abs(tl.get("total_duration_sec", -1) - declared) > 1e-6:
        f.error("C13", "timeline.json", f"total_duration_sec が指定尺 {declared}秒 と一致しない")
    if tl.get("bgm", {}).get("mood") not in BGM_MOODS:
        f.error("C13", "timeline.json", f"bgm.mood `{tl.get('bgm', {}).get('mood')}` は閉じた語彙外")


def report(f, as_json, extra=None):
    if as_json:
        out = {"errors": f.errors, "warnings": f.warnings,
               "ok": not f.errors, "error_count": len(f.errors), "warning_count": len(f.warnings)}
        if extra:
            out.update(extra)
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        for i in f.items:
            print(f"{i['level']} {i['code']} [{i['where']}] {i['message']}")
        if not f.items:
            print("OK — 指摘なし")
        else:
            print(f"\n{len(f.errors)} error(s), {len(f.warnings)} warning(s)")
    return 1 if f.errors else 0


def main():
    ap = argparse.ArgumentParser(prog="sonagi", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, help_ in (("build", "script.md + assets/ から scenes.json / timeline.json を決定的に生成する"),
                        ("check", "成果物を機械検査する（スキーマ・1対1・尺・閉じた語彙・参照切れ）")):
        p = sub.add_parser(name, help=help_)
        p.add_argument("video_dir", help="videos/<format>/<id>/ のパス")
        p.add_argument("--json", action="store_true", help="結果を JSON で出す")
        if name == "check":
            p.add_argument("--stage", choices=["script", "assets", "thumb", "all"], default="all",
                           help="自分の担当分だけ検査する（producer の自己検査用）")
    args = ap.parse_args()

    video_dir = args.video_dir
    f = Findings()
    script = parse_script(os.path.join(video_dir, "script.md"), f)
    if script is None:
        return report(f, args.json)
    check_script(script, f)
    stage = getattr(args, "stage", "all")
    assets, thumb = {}, None
    if args.cmd == "build" or stage in ("assets", "all"):
        assets = load_assets(video_dir, script, f)
        check_assets(script, assets, f)
    if args.cmd == "build" or stage in ("thumb", "all"):
        thumb = load_thumb(video_dir, f)
    if args.cmd == "build" or stage in ("assets", "all"):
        check_visual_consistency(video_dir, script, assets, thumb, f)

    if args.cmd == "build":
        if f.errors:
            return report(f, args.json, {"built": False})
        scenes_doc, timeline_doc = build(video_dir, script, assets, thumb)
        for name, doc in (("scenes.json", scenes_doc), ("timeline.json", timeline_doc)):
            with open(os.path.join(video_dir, name), "w", encoding="utf-8") as fh:
                json.dump(doc, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
        return report(f, args.json, {"built": True,
                                     "scenes": len(scenes_doc["scenes"]),
                                     "total_duration_sec": timeline_doc["total_duration_sec"]})
    if stage == "all":
        check_built(video_dir, script, f)
    return report(f, args.json)


if __name__ == "__main__":
    sys.exit(main())
