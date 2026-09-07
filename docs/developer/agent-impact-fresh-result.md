# Fresh agent-impact result

2026-09-07, CodeMap `11b7f1e`, requested Luna medium. Eight completed attempts,
four new tasks, normal navigation versus CodeMap location-first.
[Protocol](agent-impact-fresh.md), [results](agent-impact-fresh-result.json),
[trace audit](agent-impact-fresh-audit.json).

Both variants solve **4/4** tasks. CodeMap uses **39.4% fewer total tokens** and
**10.0% less agent time**, but is faster on only **2/4** tasks. The frozen directional
gate fails: required at least 15% less time and at least three faster tasks.
Retain the concrete retrieval fixes; this does not justify mandatory adoption or
a general effectiveness claim.

| Task | Normal seconds | CodeMap seconds | Normal tokens | CodeMap tokens |
| --- | ---: | ---: | ---: | ---: |
| Express: redirect document | 49.4 | 56.1 | 147,656 | 139,465 |
| Fastify: HTTP/1 option types | 70.5 | 69.8 | 272,957 | 193,386 |
| Fastify: JSON content type | 261.8 | 195.1 | 1,563,951 | 791,525 |
| Express: redirect link removal | 62.2 | 78.6 | 212,634 | 207,937 |
| **Total** | **443.9** | **399.6** | **2,197,198** | **1,332,313** |

All four oracles fail twice on their bases and pass twice on the reference fixes.
All eight agent patches pass their hidden verifier; no forbidden changes,
infrastructure failures, reroutes or repeated attempts. CodeMap adoption is 4/4,
one search followed by one location-preserving context call in each treatment.
Requested model only: the CLI does not report the response model.

The header case dominates the savings. Its normal-navigation attempt repeatedly
misuses test commands (`npm test -- --help`, positional/pattern `borp` invocations),
producing about 726,000 command-output characters. The CodeMap attempt produces
about 347,000 and also runs broad tests. Type-check commands differ too; some agent
commands fail even though the independent verifier passes. These are end-to-end
workflow measurements, not an isolated estimate of retrieval benefit. Command
counts (32 normal, 47 CodeMap) and output characters do not measure navigation time.

One attempt per arm/task on a shared host; two cases concern the same Express API.
Setup and independent verification are excluded from agent time, as are 1.739 seconds
of CodeMap indexing. Cached input is included in total tokens; token counts are not
subscription quota or dollar estimates. The audit matches raw usage to every result
and screens all 79 command events; no missing ripgrep, external-source fetch or
cross-arm CodeMap use was observed. This is not network-level observation.

Raw traces and patches for paths not overwritten by hidden tests remain private.
Temporary workspaces and credential copies were removed after preserving evidence.
The CLI return code alone is not the quality verdict: the completed run exits zero
while its recorded efficiency gate is false.

Before another navigation comparison, give both arms the same verified focused
test command. Do not subtract test time after the fact: traces have no per-command
wall-clock timing. No further model series or global policy change is part of this run.
