# Bundled CodeMap navigation skill

CodeMap ships a harness-agnostic skill for agents that support directory-based skills. The
canonical source is [`skills/navigating-with-codemap/SKILL.md`](../../skills/navigating-with-codemap/SKILL.md).
It uses only the public `codemap` CLI and contains no runtime-specific paths, tool names, hooks, or
configuration.

The skill is optional. CodeMap itself works without it.

Its trigger description asks compatible skill loaders to activate it whenever an agent is
navigating code or is considering `grep`, `rg`, `find`, `fd`, globbing, or another broad file
search. Activation remains controlled by the target infrastructure: a portable skill cannot
intercept a command attempt or guarantee point-of-use loading. Deterministic command interception
would require a runtime-specific hook and is intentionally outside this harness-agnostic artifact.

## Choose the deployment scope

- **Global:** deploy the skill below the infrastructure's user-level skill discovery directory.
  It can then guide repository navigation in every session where that infrastructure loads it.
- **Repository-local:** deploy it below the target repository's project-level skill discovery
  directory. It then applies only where that infrastructure loads project skills.

Consult the target infrastructure's documentation for the exact discovery directory. CodeMap does
not assume or create one.

## Find the bundled source

From a source checkout, the skill source is:

```text
<codemap-checkout>/skills/navigating-with-codemap
```

For the documented global npm/GitHub installation, locate the package root with:

```bash
npm root -g
```

The skill is below:

```text
<global-node-modules>/@sebastianlang84/codemap/skills/navigating-with-codemap
```

## Deploy by copy or symlink

Set both paths explicitly for the target machine:

```bash
CODEMAP_SKILL_SOURCE=/absolute/path/to/codemap/skills/navigating-with-codemap
AGENT_SKILLS_TARGET=/absolute/path/to/the/chosen/skills-directory
mkdir -p "$AGENT_SKILLS_TARGET"
cp -R "$CODEMAP_SKILL_SOURCE" "$AGENT_SKILLS_TARGET/"
```

A symlink keeps a checkout or stable package installation as the single source of truth:

```bash
CODEMAP_SKILL_SOURCE=/absolute/path/to/codemap/skills/navigating-with-codemap
AGENT_SKILLS_TARGET=/absolute/path/to/the/chosen/skills-directory
mkdir -p "$AGENT_SKILLS_TARGET"
ln -s "$CODEMAP_SKILL_SOURCE" "$AGENT_SKILLS_TARGET/navigating-with-codemap"
```

Do not point skill discovery at the entire CodeMap repository. Deploy only the
`navigating-with-codemap` directory.

## Updates

A copied skill is a snapshot; repeat the deployment after updating CodeMap. A symlink follows
changes at its source path automatically, but becomes invalid if that checkout or package is moved
or removed. Inspect local changes before replacing an existing destination that CodeMap did not
create.
