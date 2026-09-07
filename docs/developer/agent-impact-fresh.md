# Fresh agent-impact directional check

Selection protocol fixed before solver runs on 2026-09-07:
scan commits reachable from each cached Express and Fastify HEAD, ordered by
committer timestamp descending, then full SHA ascending. Take the first two
eligible fixes per repository, excluding every fix commit/task in any existing
agent-impact manifest. Require an upstream regression test, bounded behavior change,
and a focused deterministic test command. Exclude dependency-only changes, broad
redesign, infrastructure-sensitive networking/hang cases, and incompatible test
setup. Require a real associated PR because the current harness rejects commit source URLs.
Record every scanned exclusion. Oracle-invalid candidates may be excluded
before any solver runs, with the failure recorded. Never select on CodeMap results.

Eight isolated Luna medium subscription runs: baseline and CodeMap location-first,
one attempt per arm/task, deterministic rotated order, 15-minute timeout. No curated
source and no outcome retries; stop on infrastructure failure. Report token counts,
not inferred dollars. Require no paired success losses, at least 15% aggregate time
improvement, token ratio <=1.10, and faster completion on at least three of four
cases. This is a small directional check, not a generalized effectiveness claim.

The initial draft restricted the scan to first-parent history. History inspection
showed that Express merges skip newer maintenance fixes under that rule. Before
solver calls, broadened traversal to every HEAD-reachable commit while retaining
newest-first selection; merge containers are excluded and their commits considered
individually. This amendment and oracle exclusions precede all solver outcomes.

CodeMap is pinned to 11b7f1e8c30c6a53fe5db88f5d49a59e0fa9a078, version 0.10.1.
The measured lever is CodeMap availability with location-first instructions against
normal navigation. No source excerpts, diagnostic arm or additional solver hints.
The 3/4 faster requirement is a report-level check; the manifest schema enforces
aggregate time, token and paired-success constraints. All eight runs count;
incomplete pairs or infrastructure failures cannot pass the gate.

Fastify 6888 uses TSTyche with `--target '*'`, which selects its locally installed
TypeScript (verified in the installed runner), not a remotely fetched compiler.
Pinned setup resolved TSTyche 7.2.4 and TypeScript 6.0.3. Fastify 6830 runs the entire upstream reply-internals test file, including the
JSON charset regression and existing reply controls; cache-internals assertions from the
same patch are outside this behavioral task. Its score does not establish that
every refactoring change in the upstream patch was reproduced.

Internal evaluation artifacts only: no release or version bump.

Fastify scan head: `1beaf7e72d24b2fc63a02a7f5806772a00e45454`.
Every commit through the second selected fix is accounted for below; abbreviations
are unique in this cached history.

- No product change (docs, tests, dependencies or infrastructure): `1beaf7e72d24`, `83e69762aff0`, `dbebe73c4215`, `d693f43d890f`, `9a1535bcfe2a`, `b7de40faa21e`, `3efe8748335f`, `e1fc82593b61`, `2e81c38bfede`, `f87eb61a6df2`, `cc21039f49fa`, `a2f590563f11`, `22c419abfb57`, `f5b14008159e`, `ed48e732396b`, `39e87e892da4`, `3f6451cc79f0`, `f28528ff3355`, `2afc49b4eded`, `74c44c94afea`, `625d2b846632`, `720355b46a98`, `84b1158f4ee7`, `b6cdc6a40598`, `f3fd0f3df84b`, `ea664e6c3d5a`, `e6db5733121f`, `812608e5c9cb`, `ff7eff5eec8a`, `b912c24f422a`, `29b6bda04d7b`, `5454a669af4e`, `ada0623dce9e`, `6206df7165bb`, `de3752df84bb`, `ab9b96eb2f93`, `c47975e8a4c0`, `82952b865209`, `ec4bc662af6c`, `d0b649dfb678`, `826c807059a9`.
- Previously used fix: `4176096a31f5`, `6e95cb9f6de4`, `f5ef34443c5b`, `15c2fb193346`, `e4ffc205328d`, `16a74e7cb2d1`, `27938ac777c1`, `7299a57d3fdc`, `9ba6d6016fa9`, `0e9a3b35d8b1`, `29bdcbb91f13`, `01ca8393b9d1`, `325682c9e5ab`, `6682c4f9a76c`, `6ac2e9537053`.
- No regression test in commit (includes release bumps): `9334d0712958`, `377533a260d5`, `ed664c344f4d`, `a22ceded3dfb`, `9eaef5123b88`, `043baf988048`, `b93d611c7cef`, `94bcbcc6e2ef`.
- No associated PR; unsupported sourceUrl schema (GitHub API returned []): `9493c0fb716c`, `af079bd4c60c`.
- New feature, not bug fix: `eaff726a68c6`, `6e680c3e8150`.
- Merge container; constituent commits scanned separately: `1e08dfd9f0c8`, `e5fcec84a863`, `52f9c88a36d8`, `6f2558fb105e`, `d25836db9c4f`, `c5e00597132e`, `13647f199dd4`.
- Refactor, performance change or API removal, not bounded bug fix: `2808d207d93c`, `42321d896471`, `bd3e246de0c1`, `63ef53497c52`, `7df35fb8b423`, `b8cb861f155e`, `7b531afeea64`, `bdb13216b0de`, `5c83a9dcfded`, `e5df35542ec4`, `7bdb2cb733aa`, `1d1cf69d0aa8`, `d26726333fd9`, `97d10c26a3f5`, `5f4871f931d4`.
- Selected: `0f54a40f63b3`, `6f63ce9324b7`.

Express scan head: `023767fe9872e029271df1418f73401bff20ff40`.

- No product-library change (docs, tests, examples, dependencies or infrastructure): `023767fe9872`, `2574a53bbc52`, `28f732e98f54`, `8ba0c07fdcb3`, `a3714473feb3`, `ba006766fb96`, `5175d2f357e9`, `66878d3e7043`, `b3004cb8c825`, `cb19f04170fc`, `a08da78e64a7`, `dae209ae6559`, `777001a0f52a`, `64576bde91c6`, `f5c159b112e8`, `2eae22b1e12d`, `f873ac23124f`, `6340c1eaaedc`, `8cc3afa8e35e`, `e7fd63a38785`, `8e022edc9185`, `e5099198b292`, `6c4249feec8a`, `06e2367f9149`, `e3b962c558cc`, `411061d94e71`, `b4ab7d65d772`, `c4cc78bdf55a`, `925a1dff1e42`, `9c85a25c02e8`, `1140301f6a0e`, `c76ed5ae05a0`, `2d4192ebb325`, `66404b347a16`, `d12772393c82`, `6b7ccfcf120e`, `5a4568abfe05`, `912893c07cac`, `2cd372e34cd6`, `04d3a4997607`, `bc7d155f53ef`, `00bb633ca6d1`, `3c0ad4e8dcae`, `4ae96bdf5e98`, `3e81873b52e1`, `b5aae8759450`, `b8fc000f3116`, `c2fb76e99f73`, `9eb700151b68`, `dbac741a49a5`, `4007ad103ba2`, `ed0ba3f1dc90`, `8eace4603cb2`, `30bae810279b`, `758d4355d453`, `77bcd5274a87`, `f33caf1f89a0`, `2551a7d8afd8`, `4453d83ccaed`, `db507669ca5d`, `374fc1a0f9a8`, `1b196c8b82af`, `64e7373d6976`, `e4fb370ad8c2`, `60d4c16cc992`, `9e6760e18628`, `ffa89f2ccfe4`, `b9b9f52b2f7c`, `9a7afb288624`, `2eb42059f33d`, `aa907945cd17`, `d9a62f983390`, `8f21493cc57d`, `6616e39d4dbc`, `ed64290e4a8a`, `b52ff7ca6010`, `9420cd3f9b5e`, `ef5f2e13ef64`, `7a9311216adf`, `b0ed15b4525c`, `a039e4917501`, `ffc562c7d1b7`, `52872b84caf8`, `b8ab46594da8`, `fedd60e6426a`, `99a0bd3354e4`, `dfd1851245aa`, `9f4dbe3a1332`, `9784321e89b7`, `ee1ef41bd3c2`, `1ca803dd5545`, `73555815b95a`, `a1161b4686a0`, `f9954dd317a1`, `5da5a11a498a`, `fa40ecfe7619`, `cd7d4397c398`, `4c4f3ea10593`, `cb4c56e9a7eb`, `7b44e1d8501d`, `eb6d12587a2f`, `f1a2dc884de7`, `6b51e8ef979d`, `1f311c59d4b9`, `9e97144222cb`, `29d09803c116`, `1d63162dbfe5`, `4a2175dfc979`, `0bb00e19068e`, `1e359f57fc8c`, `9cbe2c2cbb01`, `35e15362ab20`, `90e522ac90e0`, `59703c23217c`, `6ed3439584b6`, `d2de128a32f1`, `2a53336e5d90`, `a42413d4e34a`, `c2f576cbe9ed`, `99473c593a2d`, `2d589b644a34`, `85e48bb8c109`, `af7cd90893f4`, `ae6a4621bc19`, `8d3934590261`, `a5cb681eb8f5`, `7f13d572c132`, `62336717bfb6`, `3bbffdc41c1a`, `ff86319ed538`, `1c5cf0feaddc`, `256a3d152794`, `4f952a953bab`, `6a40af829378`, `43020ff27534`, `e4a61bd88e2f`, `39f5d633b557`, `52ed64606fc1`, `4e92ac903194`, `cc751cff8fc8`, `9e3dbb437446`, `b31910c542c7`, `e162764f0f9c`, `508c74091f9a`, `b274047a5d38`, `082d6d1253c5`, `94546a3cc549`, `ab022403361c`, `a46cfdc37f5e`, `d14b2de782c1`, `2027b87a2739`, `2cbf22721def`, `3e1a1cedb237`, `6340d1509f83`, `344b022fc7ed`, `0c49926a9b7a`, `b3906cbdded2`, `fed8c2a8857a`, `6c98f80b6ac9`, `21df421ebc7a`, `4c9ddc1c47bf`, `9ebe5d500d22`, `ec4a01b6b881`.
- No regression test in commit: `91d333b4cfea`, `9d8223d92ee8`, `90ec6206d327`, `a479419b16f5`, `ae265a90c7f6`, `54af593b739e`, `c5b8d55a6a94`, `3910323d0980`, `3dc96995df98`, `511d9dfca8f2`, `805ef52ae615`, `8cb53ea5c332`.
- New feature, not bug fix: `ae6dd37680e3`.
- Previously used fix: `18e5985b8a9d`, `c9ecf7b65838`, `caa4f68ee8d3`, `327af123a183`, `55869f49a65f`.
- Dependency API migration requires different base/fix package versions: `59e205a57a04`.
- Selected: `9a3f7ff4120d`, `54271f69b511`.
- Oracle invalid: base [0,0], reference [0,0]; equivalent charset refactor: `6cd404eb28ff`.
- Reverts security patch; no new regression added: `697547cde621`.
- Security patch reverted immediately upstream: `2f64f68c37c6`.
- Equivalent socket/connection alias migration; no regression assertion: `89f198c6a50a`.
- Import/lint migration: `98c85eb0dd64`, `41113599afb0`, `9f8589e31ce8`.
- Dependency removal/spread refactor: `246f6f5aeeba`.
- Dependency replacement: `b11122be8537`.
- Buffer dependency/import migration: `c70197ad3305`.
- API removal, not bug fix: `bdd81f867097`.
- Merge container; constituent commits scanned separately: `f9256ef36fa9`, `e5feb9fcc9ab`.

Express 5785 is the merge PR associated with the specific upstream security fix
by GitHub's commit/pulls endpoint; the pinned fix is that single commit, not the
merge patch. Both Express cases concern HTML redirects. They are fresh task IDs
and commits, but correlated behavior, not broad independent coverage. The later
base already includes the earlier fix; isolated sessions prevent cross-task reads.
The 5167 prompt specifies a compact public response example because its upstream
oracle compares exact HTML bytes; semantically equivalent formatting is outside
that explicit response contract.

Order is Express 5167, Fastify 6888, Fastify 6830, Express 5785. Seed 0 alternates
which arm runs first, balancing first-arm order within each repository.

Regression provenance (SHA-256 of the full upstream hidden file at fix commit):

| Task | Hidden file SHA-256 |
| --- | --- |
| express-fresh-5167 | `451fae6e8674bbb463de046afd8fafa3c7a766fea840abd8b1af63a1f31b8f04` |
| fastify-fresh-6888 | `78e4d60a4cd98c5236255d84b714aed246175d6402f1beab6df49aa1a846d8e0` |
| fastify-fresh-6830 | `edb481f41331ae555e9b47d5820aa1f043d4ca95e4c964762a39ccbf0900105d` |
| express-fresh-5785 | `a3a6f2f10069292ffc0ee7d482c1f437e06b074d43030072222e2cf18b7155fe` |

Reproduce without solver calls:

```sh
npm run eval:agent-impact -- --manifest scripts/eval-agent-impact-fresh.manifest.json --dry-run
npm run eval:agent-impact -- --manifest scripts/eval-agent-impact-fresh.manifest.json \
  --cache-dir ~/.cache/codemap/external-holdout-v1 --offline --validate-oracles
```

Oracle validation on Node 22.23.2: all four valid; each base failed twice by
assertion, each reference passed twice. Express 5785 base exits were [4,4];
other bases [1,1]; all references [0,0]. No solver runs were made during selection.
Before solver calls, broadened Fastify 6830 from its named charset test to the
whole reply-internals file. The prompt now specifies the other changed public
assertion: quoting a version parameter when adding the default charset. No internal
cache API requirement was added.
The broadened Fastify 6830 oracle again returned base [1,1] assertions and reference
[0,0]. Final dry-run plans eight runs and no inferred dollar budget.
Frozen manifest hash (canonical harness JSON):
`7f7fe756421029ad147bc7b0d18cfa3fd90e47cdbb94bcc13e0781ab78f52736`.
