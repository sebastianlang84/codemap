# JavaScript definition correction

Freeze before implementation, 2026-09-07. Baseline `ebe0444`; its product code is
unchanged from the cached `54df28c` profile used for the local reproduction.
[Originating diagnosis](agent-impact-context-result.md).

One lever: recognize function-expression assignments and distinguish method headers
from callback-bearing calls. Keep ranking weights, query planning and public tools.
Share assignment recognition with chunk selection so the indexed function is complete.
Index the assigned target and its short property alias; do not substitute a private
function-expression name. Existing indexes rebuild on the next index command.

Frozen checks:
- Named/anonymous/async/generator expressions assigned to variables or dotted properties.
- Full and short names, correct location/signature, complete top-level and nested bodies.
- Calls with function/arrow callbacks are not definitions; real methods with nested
  calls, callback defaults, destructuring, quoted parentheses, regex and comments remain.
- Preserve Python handling and existing declaration/chunking controls.
- Existing-index refresh must repair unchanged files.
- On the pinned Express base, all three existing queries find `res.send` at line 112
  within five hits; exact `res.send` and `send` rank it first. Context for either name
  and the line location must return exactly lines 112–212, byte-for-byte.
- Existing `verify:local` retrieval, context, navigation and token gates must pass.

Before code changes, all five new tests fail and all five real-repo checks fail.
[Baseline](javascript-definitions-baseline.json). Frozen SHA-256:
- `tests/javascript-definitions.test.ts`: `f66e4b4e15544450fb3dbf3af97564e5e04485185da52aff09e9a6f45837d596`
- `scripts/eval-javascript-definitions.py`: `00d91eaba6a68a26f1ae9f86a49d76b0f02dcd2674921bfd27f9a891c0206146`

Reproduce against a built CLI with the existing Express cache:

```sh
python3 scripts/eval-javascript-definitions.py --cli /path/to/dist/cli/bin.js --output /tmp/definitions-result.json
```

The script records failed baselines without a nonzero exit; inspect `passed`.
No model calls or general agent-benefit claim. Keep only when every frozen check passes.
Unrelated context gaps and broader parser integration remain outside this correction.
Release impact: patch; next release would be 0.10.2. Record under Unreleased; releasing
and tagging are outside this task.
