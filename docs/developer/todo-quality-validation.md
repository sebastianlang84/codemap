# Development quality checks

All twelve known development tasks pass the expanded base/reference contract with the declared local reference augmentation for case 09. The original manifest is unchanged. No model calls were made and no confirmation cases were inspected.

| Case | Runtime oracle | Additional mandatory checks |
| --- | --- | --- |
| 01 Express download | Existing public and upstream regression tests | No in-repo type contract for this JavaScript API |
| 02 Fastify proxy | Existing public and upstream regression tests | Full upstream TypeScript suite |
| 03 Flask URL generation | Existing public and upstream regression tests | Full Flask source mypy |
| 04 Express cookie lifetime | Existing public and upstream regression tests | No in-repo type contract for this JavaScript API |
| 05 Fastify route errors | Existing public and upstream regression tests | Full TypeScript suite; new error must satisfy the existing error-constructor type |
| 06 Flask trusted hosts | Existing public and upstream regression tests | Full Flask source mypy |
| 07 Express cookie deletion | Existing public and upstream regression tests | No in-repo type contract for this JavaScript API |
| 08 Fastify request port | Existing public and upstream regression tests | Full upstream TypeScript suite |
| 09 Flask decorators | Existing public and upstream regression tests | Full source mypy plus separate existing/bare caller checks for all six decorators |
| 10 Express format | Existing public and upstream regression tests | No in-repo type contract for this JavaScript API |
| 11 Fastify coercion | Existing public and upstream regression tests | Full upstream TypeScript suite |
| 12 Flask session signing | Existing public and upstream regression tests | Full Flask source mypy |

Case 09 covers `()`, positional names, keyword names and bare decorators, with `assert_type` preserving `str` or `bool` results. The archived bad patch fails all three type checks; the archived repaired patch passes all three, each twice. Source checks alone are insufficient: the upstream reference passes them but fails both caller fixtures. A separately declared local reference patch adds six overload sets, correct generic signatures and two narrowed return casts. It changes no runtime behavior and must be applied only to the maintainer's reference workspace, never to agent setup or profiles. Its provenance is the task and public contracts; archived agent patches were used separately only to test the detector.

Public fixtures are shared setup files with SHA-256 hashes and forbidden-change paths. The reference patch is not a setup file. Fastify dependencies remain locked. Flask 03/06 use their original pinned typing requirements in a nested Python 3.11.14 environment; the runtime tests retain Python 3.14.2. Flask 09/12 retain their upstream lockfiles.

[Machine-readable results](todo-quality-validation.json) record both repetitions, source/reference identities, fixture hashes and archived-patch checks. Express uses the actual oracle runner; typed tasks use the same manifest commands in isolated archives. An initial run exhausted `/tmp` and was discarded, then repeated in the maintainer cache. These are correctness checks, not timing measurements.

Before model calls: integrate Oracle-only reference-patch handling, run every public quality command inside the actual sandbox arms, bind the nested Python 3.11.14 runtime, and freeze the final product commit and arm protocol. No sandbox pass or agent benefit is claimed here.
