# Migrating from `pi-ext-codemap`

CodeMap is now CLI-first and lives at [`sebastianlang84/codemap`](https://github.com/sebastianlang84/codemap). The `codemap` CLI is the primary interface; `codemap-mcp` and the Pi extension are adapters over the same operations.

The migration has four independent parts:

1. update the GitHub/package source;
2. update the Pi installation, if used;
3. optionally establish a development checkout at `~/dev/codemap`;
4. optionally move state out of the legacy Pi directory.

Existing indexes are not moved automatically. If `~/.pi/agent/state/codemap` is your only state directory and no state environment override is set, CodeMap keeps using it so upgrading the package does not lose approvals or indexes.

## Before you start

- Use Node 22.13 or newer.
- Finish active CodeMap indexing and close Pi/MCP clients before changing the package or moving state.
- Do not manually merge `registry.sqlite` or per-repo SQLite files from two state directories.

## Update a global CLI/MCP installation

GitHub redirects the old repository URL, but update the source explicitly. The old package name and new scoped package name can otherwise coexist and compete for the same binaries.

```bash
npm uninstall -g pi-ext-codemap
npm install -g github:sebastianlang84/codemap

command -v codemap
codemap --help
npm ls -g @sebastianlang84/codemap --depth=0
```

The GitHub install provides both `codemap` and `codemap-mcp`. There is no registry-published npm package yet, so keep using the `github:` source.

If your MCP configuration already launches `codemap-mcp` from `PATH`, its command does not change; restart the MCP host after upgrading. If it points directly into the old checkout, replace that path with the `codemap-mcp` command or the new checkout path.

## Update the Pi extension

Pi tracks the Git source identity, so remove the old source and install the renamed one:

```bash
pi remove git:github.com/sebastianlang84/pi-ext-codemap
pi install git:github.com/sebastianlang84/codemap
pi list
```

If Pi does not recognize the old source string, run `pi list` first and remove the exact old entry it reports.

Restart Pi, open an approved repository, and verify:

```text
/codemap-status --full
/codemap-search package.json dependencies
```

The Pi commands and `codemap_*` tool names are unchanged.

## Use `~/dev/codemap` as the development checkout

Prefer a fresh, user-owned clone over manually moving Pi's package-manager checkout from `~/.pi/agent/git/...`:

```bash
git clone git@github.com:sebastianlang84/codemap.git ~/dev/codemap
cd ~/dev/codemap
npm install
npm run build
npm uninstall -g pi-ext-codemap @sebastianlang84/codemap
npm link
```

This makes the built `codemap` and `codemap-mcp` binaries resolve to the development checkout. Add the Pi adapter from the same clone only if needed:

```bash
pi list
# Remove whichever Git-backed CodeMap source is listed:
pi remove git:github.com/sebastianlang84/pi-ext-codemap  # if listed
pi remove git:github.com/sebastianlang84/codemap         # if listed
pi install ~/dev/codemap
pi list
```

Verify the new checkout before removing any leftover Pi-managed clone:

```bash
git -C ~/dev/codemap remote -v
git -C ~/dev/codemap status --short
codemap --help
```

If you already have a normal, user-owned clone rather than a Pi-managed checkout, keeping it is also safe:

```bash
git remote set-url origin git@github.com:sebastianlang84/codemap.git
git remote -v
```

You may then rename or move that clone while no process is using it. Moving the CodeMap source checkout does not move the global CodeMap state. Because repo approvals/indexes are keyed by absolute target-repo path, only a target repository whose own directory moves needs `codemap index --approve` again at its new path.

## Move state to the platform-neutral location

### Resolution order

CodeMap resolves state in this order:

1. CLI `--state-dir <path>`;
2. `CODEMAP_HOME`;
3. `$XDG_DATA_HOME/codemap`;
4. `~/.local/share/codemap`.

`CODEMAP_HOME` selects the state root; it does not point at the CodeMap source checkout.

Backward compatibility applies only to the unconfigured default: when `~/.pi/agent/state/codemap` exists and `~/.local/share/codemap` does not, CodeMap continues using the legacy Pi path. Setting `CODEMAP_HOME` or `XDG_DATA_HOME`, or creating the new default directory, selects the new location instead.

You can therefore upgrade first and leave state where it is. A deliberate move is recommended once the new CLI/MCP/Pi installation is verified.

### Deliberate move

Close Pi and any MCP host, then compute the destination from the same environment precedence CodeMap uses:

```bash
legacy="$HOME/.pi/agent/state/codemap"
target="${CODEMAP_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/codemap}"

test -d "$legacy"
test ! -e "$target"
mkdir -p "$(dirname "$target")"
mv "$legacy" "$target"
```

The `test ! -e` guard is intentional. If it fails, both locations contain state or the destination was created early. Do not merge their SQLite files. Either keep using one location explicitly with `CODEMAP_HOME`/`--state-dir`, or choose one state tree and rebuild missing repo indexes with `codemap index --approve`.

After the move, start a new shell/client and verify from a repository that was already approved:

```bash
codemap status --full --repo /path/to/approved/repo
codemap search --repo /path/to/approved/repo package.json
```

The reported `dbPath` should be below the new destination. Pi users can additionally run `/codemap-status --repo-path /path/to/approved/repo --full`.

### Existing overrides

If you already use `--state-dir`, `CODEMAP_HOME`, or `XDG_DATA_HOME`, that explicit location takes priority and no legacy fallback or move is required. Keep the override stable across the CLI, MCP host, and Pi process if they should share approvals and indexes.

## Final verification checklist

- `command -v codemap` resolves the intended installation.
- `npm ls -g @sebastianlang84/codemap --depth=0` shows the new package when using a global install.
- `codemap status --full` reports the expected state directory and readiness.
- `codemap search <terms>` returns results in an approved repo.
- `pi list` no longer identifies the old Git source when Pi is used.
- MCP hosts have been restarted and launch `codemap-mcp` from the intended installation.

Indexes are rebuildable. If an old index cannot be reused, re-approve and rebuild only the affected repository:

```bash
codemap index --repo /path/to/repo --approve
```
