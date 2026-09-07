# Selected context helps; current CodeMap does not reliably deliver it

Twelve completed attempts, all arms **3/4 solved**, no paired success differences.
Selected base source reduced aggregate agent time **40.9%** and total tokens **46.8%**
against normal navigation; all four selected-context attempts were faster. The frozen
**directional diagnostic signal passed**. This supports investigating context selection,
not a general benefit claim or an ideal-context upper bound.

[Protocol](agent-impact-context.md), [result](agent-impact-context-result.json),
[trace inventory](agent-impact-context-traces.json), [audit](agent-impact-context-navigation.json).
Freeze commit: `1982a38`. Stable result SHA-256:
`ef7d390462b7354564ab025c7fd07e7646035e65af33661475046ad3ffec8aa0`.

| Task | Solved, all arms | Normal seconds | CodeMap seconds | Selected seconds |
| --- | --- | ---: | ---: | ---: |
| Express Uint8Array | yes | 109.8 | 117.6 | 75.0 |
| Plugin dependency errors | yes | 146.6 | 122.8 | 124.9 |
| HTTP/2 cancellation | no | 320.5 | 561.8 | 133.8 |
| Trailer first completion | yes | 78.6 | 60.5 | 53.9 |
| Total | 3/4 | 655.5 | 862.7 | 387.5 |

| Tokens | Normal | CodeMap | Selected |
| --- | ---: | ---: | ---: |
| Uncached input | 205,832 | 210,729 | 164,636 |
| Cached input | 1,609,472 | 2,210,816 | 796,160 |
| Output, including reasoning | 17,761 | 23,605 | 13,911 |
| Total | 1,833,065 | 2,445,150 | 974,707 |

Cache writes were zero. Counts include repeated cached input; they are not a bill or
subscription-quota estimate. CodeMap totals were **31.6% more time, 33.4% more tokens**
than normal navigation. Its HTTP/2 failure dominates that result. Descriptively excluding
that shared failed task, CodeMap used 10.2% less time and 3.0% fewer tokens; selected
context used 24.3% less time and 45.9% fewer tokens. This is a post-hoc breakdown, not a
replacement success criterion. Faster failed attempts do not produce correct patches.

## What the traces establish

Command ordinals below refer to completed command events. Before the first edit,
normal / CodeMap / selected used **7/7/2**, **4/7/2**, **5/7/2**, **2/4/2** commands
on the four tasks respectively. These are operation counts, not navigation durations.

- **Express: concrete extraction and retrieval miss.** CodeMap's first search selects
  tests; the implementation hit points to a `sendfile` call rather than `res.send`.
  Context correctly returns the requested test chunk, which is then reread during
  normal navigation. A frozen-profile [local probe](agent-impact-context-symbol-probe.json)
  reproduces the mechanism: `res.send = function send(body) {` produces no symbol,
  while `sendfile(res, file, opts, function (err) {` produces a false method definition.
  The actual query reproduces the trace; neither `res.send` nor `send` returns the
  implementation region in its ten results. Extraction is defective; its individual
  contribution to the final ranking and agent outcome has not been isolated.
- **Plugin errors: correct function, incomplete surrounding evidence.** CodeMap selects
  the dependency check on rank 5 and returns it completely. Related tests are empty.
  Commands 3–7 reread it and search for tests, the error catalog, types and exports.
  Selected context supplies these locations, but commands 1–2 still reread them.
- **Trailers: caller instead of target.** `sendTrailer` is absent from CodeMap's ten
  search results. The agent selects its caller, then finds and reads the target through
  ordinary search. Selected context already contains it, yet it is reread in command 1.
- **HTTP/2: target found, implementation still wrong.** All three receive `onSendEnd`;
  CodeMap returns its complete body in command 2. Existing tests and initial large-body
  probes do not reliably reproduce the requested cancellation failure. CodeMap spends
  commands 9–20 on repeated probes/timeouts and eventually removes its new test file.
  Its final patch also checks `req.httpVersionMajor`, although `req` is the Fastify
  request. A subsequent live HTTP/2 probe returns that property as `undefined` and
  `req.raw.httpVersionMajor` as `2`. Each final patch independently reproduces the same
  hidden cancellation failure: `NGHTTP2_ENHANCE_YOUR_CALM`, seven tests pass, one fails.

**Test strategy materially differs.** Several purportedly focused `borp` commands run
whole suites: two baseline HTTP/2 invocations consume about 73 seconds and emit 336,150
characters; baseline trailers spends about 36 seconds on its full suite. Selected
context generally uses targeted Node tests. Express selected context has a final edit
without another agent test, although the independent final verifier passes. Thus the
time/token differences cannot be attributed solely to retrieval or avoided reads.

## Decision and limits

There is actionable implementation work, and the manually selected context suggests
room to improve. There is no evidence that navigation has reached a fundamental limit.
The next bounded candidate is recognizing JavaScript function assignments while rejecting
callback-bearing calls as definitions. First freeze these misses plus positive/negative
controls and run the existing retrieval/context/token gates. This diagnosis changes no
product code and does not authorize another automatic model series or default rollout.

Four already examined tasks, one attempt per arm, two JavaScript frameworks, requested
Luna medium; actual response model unreported. Selection used expected paths and a
curator who saw all task bases. Source-selection effort and 1.737 seconds of index setup are excluded from agent time.
Selected context is privileged and may still be incomplete. Agent sessions are isolated;
the same test oracles are used across arms. No provider retries or infrastructure failures.
All sandbox preflights and twice-repeated base-fail/reference-pass checks passed.

All 119 completed commands were screened: no missing ripgrep, external retrieval/history
commands, or CodeMap invocation in control arms observed. This is trace screening, not
packet observation. Token totals match all twelve raw usage records. Timings describe a
shared host; local read/probe activity continued during runs. Final failure replays were
after all model runs. No untouched holdout, release, tag or global policy change.

Reproduce the retained trace audit with `python3 scripts/analyze-context-diagnostic.py`
and the frozen symbol/query probe with `python3 scripts/probe-context-symbols.py`.
