# Luna-high optional CodeMap result

The frozen efficiency gate **failed**. Both arms solved 8/8 tasks;
CodeMap search/context was used in 0/8 treatment runs. This measures optional
availability under the fixed CLI hint. With no use, the resource differences cannot establish
the benefit or harm of CodeMap retrieval or the nested-function fix. No general product-effect claim.

[Raw result](agent-impact-luna-result.json), [protocol](agent-impact-luna.md),
[private trace inventory](agent-impact-luna-traces.json). Values below are baseline : treatment.

| Repository | Solved | Total tokens | Token change | Agent seconds | Time change |
| --- | --- | --- | --- | --- | --- |
| express | 4/4 : 4/4 | 979,604 : 1,319,446 | +34.7% | 354.8 : 359.0 | +1.2% |
| fastify | 4/4 : 4/4 | 3,546,990 : 4,196,936 | +18.3% | 747.6 : 879.4 | +17.6% |
| all | 8/8 : 8/8 | 4,526,594 : 5,516,382 | +21.9% | 1102.4 : 1238.3 | +12.3% |

Frozen discovery strata (four tasks each; both arms 4/4 solved):

| Stratum | Total tokens | Token change | Agent seconds | Time change |
| --- | --- | --- | --- | --- |
| direct API | 1,291,355 : 1,251,236 | -3.1% | 406.5 : 362.3 | -10.9% |
| cross-component | 3,235,239 : 4,265,146 | +31.8% | 695.9 : 876.0 | +25.9% |

| Task | Solved | Total tokens | Agent seconds | Search/context calls |
| --- | --- | --- | --- | --- |
| express-pr-4893 | 1 : 1 | 330,705 : 321,333 | 129.3 : 92.2 | 0 |
| express-pr-6903 | 1 : 1 | 165,351 : 175,143 | 56.9 : 67.6 | 0 |
| express-pr-4885 | 1 : 1 | 113,367 : 143,065 | 59.6 : 61.4 | 0 |
| express-pr-6073 | 1 : 1 | 370,181 : 679,905 | 108.9 : 137.8 | 0 |
| fastify-pr-6483 | 1 : 1 | 821,889 : 1,051,028 | 164.3 : 183.5 | 0 |
| fastify-pr-6838 | 1 : 1 | 681,932 : 611,695 | 160.6 : 141.2 | 0 |
| fastify-pr-6680 | 1 : 1 | 1,277,277 : 1,689,346 | 252.7 : 388.5 | 0 |
| fastify-pr-6753 | 1 : 1 | 765,892 : 844,867 | 170.1 : 166.2 | 0 |

All eight oracles passed base-fail/reference-pass validation twice. All 16 attempts have raw
traces; 210 completed command events were screened for external retrieval and sandbox
denials, with no matches. This is a command-trace check, not packet-level network observation.
Index setup totaled 2.865 seconds and is excluded
from agent time. Provider USD cost is unreported. Requested model/effort: gpt-5.6-luna/high;
the CLI does not expose the actual response model. No observed rerouting.

Eight tasks from two JavaScript frameworks, one attempt per arm: descriptive development
results, no statistical claim. Earlier tool-host and network-policy failures remain separate
and are excluded from these totals. The untouched holdout remains unused.

## Navigation audit

The baseline is weaker than intended: **all 16 runs report `rg: command not found`**
and fall back to `grep`/`find`. Both arms are affected; the paired results remain recorded,
but they do not establish performance against a working ripgrep-equipped agent.
The original harness gate did not check this prerequisite. No rerun was started.

[Audit counts](agent-impact-luna-navigation.json) reference the hash-verified private traces.
Reproduce from the repository root with `python3 scripts/analyze-luna-navigation.py`.
Command ordinals below count completed command events within the named run.

| Task | Observed navigation in baseline / treatment | Implication |
| --- | --- | --- |
| Express 4893 | Runs 1/2 read response implementation and send tests at command 3. | Header terms locate the target early. |
| Express 6903 | Runs 4/3 read application render and its tests at commands 3/4. | The prompt already names `app.render`. |
| Express 4885 | Runs 5/6 read the links implementation and tests at command 3. | One short source range suffices after search. |
| Express 6073 | Runs 8/7 read response implementation at command 3, then inspect `send`/`serve-static` dependencies. Run 8 command 9 reads the same dependency range twice. | A compact source excerpt could avoid some reads; dependency behavior still needs checking. |
| Fastify 6483 | Runs 9/10 read validation implementation at commands 4/3, then search multiple tests and docs. | Finding the file is easy; selecting relevant validator-contract evidence is the potential opportunity. |
| Fastify 6838 | Runs 12/11 read route implementation at commands 3/5. Treatment spends commands 2/3 listing files, including `.git` before excluding it. | Exact `findRoute` lookup already works; inventory noise is avoidable. |
| Fastify 6680 | Runs 13/14 read request implementation at commands 4/6. Both repeatedly run proxy/port tests and inspect expectations. | Much of the later work is behavioral debugging, not locating code. |
| Fastify 6753 | Runs 16/15 read decoration implementation at command 3, then constructors and plugin overrides. | Related-file context is plausible, but ordinary navigation also reaches the dependencies. |

There are 3,035,126 Unicode characters in recorded command outputs. The 16 outputs
of at least 60,000 characters total 1,926,301 (63.5%); each is a test-suite invocation.
These are stored output characters, **not model tokens or attribution of the token difference**.
Repeated model input, caching, reasoning and output truncation prevent that conversion.
The +21.9% token difference cannot be assigned to search, test output or the CLI hint
from these aggregate counters.

The traces show tool choices, not why the model made them. No CodeMap search/context
call occurred, even after ripgrep failed. This protocol supplied only the optional CLI
hint and disabled skill discovery; it did **not** evaluate the bundled CodeMap skill.
Strengthening its frontmatter or forcing invocation is therefore not a supported fix
from this run alone.

Next evidence, if development resumes: first make a local, no-model comparison on
validator evidence selection or repeated source reads, using only the task prompt and
already-observed hits for queries. Count returned source and relevant evidence retained,
not hypothetical agent savings. These are now development cases, not fresh holdout cases.
Before any future agent comparison, verify `rg` inside the actual login-shell sandbox
and keep test-output handling identical between arms. Neither change justifies an
automatic model rerun. No retrieval/ranking change is supported by this audit.

Decision: no demonstrated advantage and no adoption. Close this recovery cycle; maintenance
only, no automatic further paid experiment or feature expansion based on these cases.
