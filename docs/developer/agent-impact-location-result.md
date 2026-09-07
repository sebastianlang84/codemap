# Location-first comparison result

CodeMap solved **4/4**, baseline **3/4**: one paired win, no losses, three ties.
Agent time fell **17.0%**, while total tokens rose **4.7%**. The frozen efficiency gate
**failed** because it required at least 15% fewer total tokens. Keep the positive task
result, but do not change the success criterion after seeing it.

[Protocol](agent-impact-location.md), [stable result](agent-impact-location-result.json),
[private trace inventory](agent-impact-location-traces.json). Values below are baseline : treatment.

| Task | Solved | Total tokens | Agent seconds |
| --- | --- | --- | --- |
| express-pr-6285 | 1 : 1 | 379,883 : 407,636 | 132.3 : 140.9 |
| fastify-pr-6774 | 1 : 1 | 876,182 : 1,509,986 | 205.8 : 218.8 |
| fastify-pr-6746 | 0 : 1 | 3,339,227 : 3,057,648 | 805.6 : 553.8 |
| fastify-pr-6714 | 1 : 1 | 408,811 : 263,623 | 111.2 : 128.0 |
| Total | 3 : 4 | 5,004,103 : 5,238,893 | 1254.9 : 1041.5 |

Token accounting, including repeated cached input:

| Category | Baseline | Treatment |
| --- | --- | --- |
| Uncached input | 412,555 | 417,120 |
| Cached input | 4,554,240 | 4,779,776 |
| Output, including reasoning | 37,308 | 41,997 |

Cache writes were zero. Totals match all eight raw completed-turn usage records.
No USD amount is reported; these token counters are not a bill or a quota-cost estimate.
Index setup totaled 1.645 seconds and was excluded from agent time, as were preflight
checks and hidden-test verification.

## What changed in practice

All four treatment runs used one search followed by one explicit `path:start-end`
context call with `--limit 1`. The harness index calls do not count as adoption.
The selected locations were a response test, error types, the response-writing function,
and the trailer-related code. No missing ripgrep, sandbox-denial or external-retrieval
pattern was found in 180 completed command events. This is command-trace screening,
not packet-level observation. All eight sandbox preflights passed and all four oracles
passed base-fail/reference-pass validation twice. No provider failures or model retries.

The HTTP/2 case supplies the only paired win and dominates the time reduction.
Baseline used `end(payload)` and passed its own tests, but failed the hidden cancellation
case. Reapplying its runtime diff reproduced `NGHTTP2_ENHANCE_YOUR_CALM` twice.
Treatment selected the relevant response-writing region and implemented bounded writes,
passing the hidden tests. Both arms reached that implementation area; one attempt per
arm cannot establish whether retrieval caused the different solution strategy.

For plugin dependencies, treatment read the error types first, then continued with broad
search and repeated source reads: 30 command events versus baseline's 17. Here the initial
CodeMap calls supplemented ordinary navigation rather than demonstrably replacing it.
The corrected handoff works; reliable navigation savings are still unproven.

## Decision and limits

Preserve the verified location fix, concise guidance and sandbox checks. Keep CodeMap
available for targeted use; the failed frozen gate does not justify a mandatory default,
feature expansion or another automatic model series. The one success improvement is a
reason to retain the evidence, not a general product-effect claim.

Four development tasks from two JavaScript frameworks, one attempt per arm; paired
success p=1. The test explicitly instructed initial CodeMap use and disabled host skills;
it does not evaluate optional adoption or skill-loader activation. Requested model/effort
was `gpt-5.6-luna/high`; actual response model is unreported, with no observed rerouting.
Timings are descriptive on a shared host; the local HTTP/2 diagnostic replay overlapped
part of treatment run 6. Earlier trace-path setup rejection occurred before any model call.
No untouched-holdout run, release, tag or global policy rollout was performed.
