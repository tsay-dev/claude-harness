# gate-hook — machine enforcement of the §2 implementation start gate (opt-in)

A tool that structurally enforces the develop skill's **§2 implementation start gate** (never write
implementation code before the UC and its REQs are `active` and the contract is `fixed`) as a Claude Code **PreToolUse hook**.

- **The develop process works without it** (§2 is a self-check, and the spec-lint gate is a post-hoc
  check at commit time). This hook adds a third net to those two: **a stop line that physically halts
  at the moment of writing**.
- **Enabling it is up to the host project.** The harness bundles only the script and these
  instructions (installation — the wiring into settings — is each project's responsibility; see the
  "bundled machine checks" section of the README).

## How it works

1. The hook fires immediately before Write / Edit / NotebookEdit and receives the target path.
2. If the target is "implementation code" (it matches a `--code` glob), it reads the `phase:` frontmatter of every `docs/goals/**/UC-*/UC.md` (the progress ledger lives there — no ledger file is committed, R-1003).
3. It verifies, **for every UC whose phase is 実装 (implement) or 検証 (verify)**, that the UC is `active`, none of its REQs is still `draft`, and its `contract.yaml` is `fixed`.
4. If anything is missing it **blocks the tool call with exit 2** and sends the reason (which UC is missing what, and the return-point phase) back to the AI on stderr. This halts regardless of the AI's intent.

Because the UC's own frontmatter is the machine-readable gate state, **there is no extra state file**. As
long as the orchestrator advances `phase:` per the SKILL's procedure, that is exactly what the hook judges from.

### Decision rules

| Write target | Decision |
| --- | --- |
| Under `docs/` (UC, REQ, contract), `traceconfig.json`, `.trace-baseline.json` | Always allowed (writing the SSOT is the gate's precondition) |
| Under `.claude/`, matching `--exclude`, or not matching `--code` | Allowed (outside the gate) |
| Implementation code + no `docs/goals` | **Blocked** (no SSOT → Phase 1) |
| Implementation code + no UC with phase 実装\|検証 | **Blocked** (advance the UC's `phase:` before starting) |
| Implementation code + an in-progress UC not `active`, a `draft` REQ in it, or its contract absent / not `fixed` | **Blocked** (→ Phase 1 / Phase 3) |
| All of the above satisfied | Allowed |

An internal error in the hook itself (malformed stdin and the like) **fails open** (allows) — a bug in
the hook must not break the session. The gate decision itself, conversely, **fails closed** — with no
SSOT, it halts.

## Installation (in the host project)

Add this to `.claude/settings.local.json` (personal, uncommitted; stays within the host project even
under a submodule placement):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/tools/gate-hook/gate-hook.mjs\" --code 'src/**' --code 'app/**'"
          }
        ]
      }
    ]
  }
}
```

To share it with the team, you may put the same content in `.claude/settings.json` if `.claude` is
placed by copy or symlink (not possible under a submodule placement, where settings.json is a
harness-side file — in that case each person puts it in their own settings.local.json).

### Arguments (all configuration lives here; no config file is added)

| Argument | Meaning |
| --- | --- |
| `--code <glob>` | Paths treated as implementation code, i.e. gated (repeatable, **required**). e.g. `'src/**'` `'app/**'` `'db/schema.*'` |
| `--exclude <glob>` | Paths excluded from `--code` (repeatable). e.g. the skeleton's workspace `'skeleton/**'` |
| `--docs <dir>` | The docs root (default `docs`) |

- Enabled without `--code`, it blocks nothing and only warns (exit 1 — for detecting a misinstallation).
- The globs are a minimal implementation supporting only `**` / `*` / `?` (matched against paths relative to the project root).

## Limits (use it knowing these)

- **Writes via Bash (`sed -i`, redirects, and so on) pass straight through**, because the matcher covers
  only the Write/Edit family. A design that also blocks Bash misfires too often (obstructing builds and
  test runs), so it is deliberately out of scope.
- **It does not distinguish the main agent from subagents.** A legitimate Write by an implementation
  producer passes the same check, but legitimate implementation only happens once the UC, its REQs, and its
  contract are all in place, so the extra net is harmless (indeed it also stops a producer that strays).
- **The walking skeleton** (§3; the explicit exception that writes behavior before the contract is fixed)
  should work outside the mainline code tree (e.g. `skeleton/`) and be excluded with `--exclude`, or be
  placed outside the gated globs.
- If a UC's `phase:` or a status drifts from reality, the decision drifts with it.
  spec-lint (`../spec-lint/`) and trace-check (`../trace-check/`) confirm consistency at commit time.

## Checking that it works

```bash
echo '{"tool_input":{"file_path":"src/x.js"},"cwd":"/path/to/project"}' \
  | node .claude/tools/gate-hook/gate-hook.mjs --code 'src/**'
echo $?   # 2 unless an in-progress UC, its REQs, and its contract are all in place (the block reason goes to stderr)
```
