#!/usr/bin/env python3
"""Count tasks in which CodeMap was the first tool to name the expected source file.

Usage: analyze-first-surface.py <manifest.json> <evidence.json> <trace-dir>... | --self-test

Uses the evidence's result runs, found by mode, task and run order in one or more trace directories
bound to the evidence's manifest hash and to each run's original patch. Task 04 is excluded from all
counts; the last line gives the decision numbers on the remaining tasks. Walks each run's Codex items in order. The first agent message,
command, or file change whose text or output names an expected path decides who surfaced it: CodeMap
when that item is a shell command consisting only of `codemap search`/`context` calls (optionally piped
into head, tail, or jq) and the command text itself does not name the path; otherwise another source.
"""
import hashlib
import json
import re
import shlex
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

PIPE_OK = {"head", "tail", "jq"}
# Task 04's required error message names the attribute to change; it never counts for decisions.
EXCLUDED = ["large-repo-04"]


def inner_command(command: str) -> str:
    try:
        argv = shlex.split(command)
    except ValueError:
        return command
    if len(argv) == 3 and argv[0].endswith("bash") and argv[1] in {"-lc", "-c"}:
        return argv[2]
    return command


def codemap_only(command: str) -> bool:
    lexer = shlex.shlex(inner_command(command).replace("\n", ";"), posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        tokens = list(lexer)
    except ValueError:
        return False
    segments: list[tuple[str, list[str]]] = [("", [])]
    for token in tokens:
        if token in {";", "&&", "||", "|"}:
            segments.append((token, []))
        elif set(token) <= set(";&|<>()"):
            return False
        else:
            segments[-1][1].append(token)
    for operator, words in segments:
        if not words:
            continue
        if operator == "|":
            if words[0] not in PIPE_OK:
                return False
        elif words[:1] != ["codemap"] or words[1:2] not in (["search"], ["context"]):
            return False
    return True


def first_surface(stdout: str, paths: list[str]) -> str:
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        item = event.get("item") or {}
        if event.get("type") != "item.completed":
            continue
        kind = item.get("type")
        if kind == "agent_message":
            text = item.get("text", "")
        elif kind == "command_execution":
            text = item.get("command", "") + "\n" + item.get("aggregated_output", "")
        elif kind == "file_change":
            text = json.dumps(item.get("changes", []))
        else:
            continue
        if not any(path in text for path in paths):
            continue
        command = item.get("command", "")
        if kind == "command_execution" and codemap_only(command) and not any(path in command for path in paths):
            return "codemap"
        return "other"
    return "never"


def load_runs(evidence: dict, trace_dirs: list[Path]) -> list[tuple[dict, dict]]:
    candidates: dict[tuple, list[tuple[Path, dict]]] = defaultdict(list)
    for directory in trace_dirs:
        bound = (directory / "manifest-sha256.txt").read_text().strip()
        if bound != evidence["manifestSha256"]:
            raise SystemExit(f"{directory}: manifest hash {bound} does not match evidence")
        for trace in directory.glob("run-*.json"):
            run = json.loads(trace.read_text())
            candidates[(run["mode"], run["taskId"], run["runOrder"])].append((trace, run))
    pairs = []
    for result in evidence["results"]:
        key = (result["mode"], result["taskId"], result["runOrder"])
        found = candidates.get(key, [])
        found = [(trace, run) for trace, run in found if patch_sha(trace) == result.get("originalPatchSha256")]
        if len(found) != 1:
            raise SystemExit(f"{key}: expected one trace, found {len(found)}")
        pairs.append((result, found[0][1]))
    return pairs


def patch_sha(trace: Path) -> str | None:
    patch = trace.with_name(trace.stem + "-original.patch")
    return hashlib.sha256(patch.read_bytes()).hexdigest() if patch.exists() else None


def summary(evidence: dict, excluded: set[str]) -> dict:
    runs = {(r["mode"], r["taskId"]): r for r in evidence["results"] if r["taskId"] not in excluded}
    tasks = sorted({task for _, task in runs})

    def duration(run: dict) -> float:
        return run["agentDurationMs"] + run["indexDurationMs"] + (run.get("verifierDurationMs") or 0)

    def tokens(run: dict) -> int:
        usage = run["usage"]
        return sum(usage.get(key) or 0 for key in ("inputTokens", "outputTokens", "cacheReadInputTokens", "cacheCreationInputTokens"))

    out = {"tasks": len(tasks)}
    for mode in sorted({mode for mode, _ in runs}):
        own = [runs[(mode, task)] for task in tasks]
        base = [runs[("baseline", task)] for task in tasks]
        out[mode] = {
            "solved": sum(run["success"] for run in own),
            "lossesVsBaseline": sum(b["success"] and not r["success"] for r, b in zip(own, base)),
            "winsVsBaseline": sum(r["success"] and not b["success"] for r, b in zip(own, base)),
            "fasterThanBaseline": sum(duration(r) < duration(b) for r, b in zip(own, base)),
            "totalDurationRatio": sum(map(duration, own)) / sum(map(duration, base)),
            "tokenRatio": sum(map(tokens, own)) / sum(map(tokens, base)),
        }
    return out


def manifest_sha256(path: str) -> str:
    script = ('import("./scripts/eval-agent-impact-lib.ts").then(lib => process.stdout.write('
              'lib.hashAgentImpactJson(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))))')
    return subprocess.run(["node", "--experimental-strip-types", "--no-warnings", "-e", script, str(Path(path).resolve())],
                          cwd=Path(__file__).resolve().parent.parent, capture_output=True, text=True, check=True).stdout


def self_test() -> None:
    def trace(*items: dict) -> str:
        return "\n".join(json.dumps({"type": "item.completed", "item": item}) for item in items)

    def cmd(command: str, output: str) -> dict:
        return {"type": "command_execution", "command": command, "aggregated_output": output}

    path = ["django/x.py"]
    cases = [
        (trace(cmd("/bin/bash -lc 'codemap search foo --json'", '"path": "django/x.py"')), "codemap"),
        (trace(cmd("/bin/bash -lc 'codemap search foo --json | head -50'", "django/x.py")), "codemap"),
        (trace(cmd("/bin/bash -lc 'codemap search foo --json || rg -l foo django'", "django/x.py")), "other"),
        (trace(cmd("/bin/bash -lc 'codemap context django/x.py --json'", "django/x.py")), "other"),
        (trace({"type": "agent_message", "text": "Look at django/x.py"},
               cmd("/bin/bash -lc 'codemap search foo'", "django/x.py")), "other"),
        (trace(cmd("/bin/bash -lc 'rg foo'", "nothing")), "never"),
        (trace(cmd("/bin/bash -lc 'codemap search \"PBKDF2|MD5; hash\" --json'", "django/x.py")), "codemap"),
        (trace(cmd("/bin/bash -lc 'codemap search foo > out.json; cat out.json'", "django/x.py")), "other"),
    ]
    for stdout, expected in cases:
        actual = first_surface(stdout, path)
        assert actual == expected, (stdout, actual, expected)
    print("self-test passed")


def main() -> None:
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return
    manifest = json.loads(Path(sys.argv[1]).read_text())
    evidence = json.loads(Path(sys.argv[2]).read_text())
    if manifest_sha256(sys.argv[1]) != evidence["manifestSha256"]:
        raise SystemExit("manifest does not match the evidence's manifest hash")
    expected = {task["id"]: task["expectedPaths"] for task in manifest["tasks"]}
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    rows = []
    for result, run in load_runs(evidence, [Path(item) for item in sys.argv[3:]]):
        if result["taskId"] in EXCLUDED:
            continue
        who = first_surface(run.get("stdout", ""), expected[result["taskId"]])
        counts[result["mode"]][who] += 1
        rows.append((result["mode"], result["taskId"], who))
    for mode, task, who in sorted(rows):
        print(f"{mode}\t{task}\t{who}")
    print(json.dumps({mode: dict(value) for mode, value in counts.items()}, sort_keys=True))
    print(json.dumps(summary(evidence, set(EXCLUDED)), sort_keys=True))


if __name__ == "__main__":
    main()
