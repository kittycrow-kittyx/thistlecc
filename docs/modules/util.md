# Host utilities

- `CliError`, `fail`, `errorMessage`: exit status and error reporting.
- `quoteArgument`, `printCommand`: display command lines on stderr.
- `RunOptions`, `RunResult`, `run`: invoke host executables without a shell; capture output or inherit the terminal.
- `pathExists`, `isRegularFile`: asynchronous filesystem checks.
- `commandExists`, `firstExistingCommand`: executable discovery in search order.
- `sha256File`: hash file bytes.
- `atomicCopy`, `atomicWrite`: publish through a temporary sibling file; optional file permissions.
- `absolute`: resolve a path against a working directory.
- `sourceDateEpoch`: read a non-negative decimal timestamp from the environment.

`defaultRunOptions()` provides explicit default process execution settings.

`ensureDirectory(path)` creates missing parent directories and verifies that an existing path is a directory.
