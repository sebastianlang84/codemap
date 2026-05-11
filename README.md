# CodeMap

CodeMap is a local SQLite/FTS codebase index for Pi coding agents. It indexes a Git repository and provides fast path, symbol, and source-chunk lookup without sending code to a remote service.

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-codemap
```

For local development:

```bash
cd ~/dev/pi-extensions/pi-ext-codemap
pi install .
```

## Usage

Approve and index the current Git repository:

```text
/codemap-index --approve-repo
```

Search or fetch compact read-first context:

```text
/codemap-search <query>
/codemap-context <path-or-symbol>
/codemap-status --full
```

## Compatibility

Legacy `/codebase-*` commands and `codebase_*` tools are still registered as deprecated aliases. Prefer the primary CodeMap names:

- `codemap_status`
- `codemap_index`
- `codemap_search`
- `codemap_context`

CodeMap stores indexes under `~/.pi/agent/codemap/` and non-destructively migrates existing `~/.pi/agent/code-search/` data when needed.

## License

MIT, as declared in `package.json`.
