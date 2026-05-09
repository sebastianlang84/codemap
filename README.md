# pi-ext-code-search

Local SQLite/FTS codebase search for Pi coding agents. It indexes a Git repository and provides fast path, symbol, and source-chunk lookup without sending code to a remote service.

## Install

```bash
pi install git:github.com/sebastianlang84/pi-ext-code-search
```

For local development:

```bash
cd ~/dev/pi-extensions/pi-ext-code-search
pi install .
```

## Usage

Approve and index the current Git repository:

```text
/codebase-index --approve-repo
```

Search or fetch compact read-first context:

```text
/codebase-search <query>
/codebase-context <path-or-symbol>
/codebase-status --full
```

## License

MIT, as declared in `package.json`.
