# Configuration loading

- `scanConfigArguments(argv)`: extract `--config` and `--no-config`.
- `loadConfig(cwd, explicitPath, disabled)`: read JSON from an explicit path or search parent directories for `thistlecc.json` or `.thistlecc.json`.
- `environmentConfig(env)`: collect environment overrides; legacy aliases remain accepted.
- `mergeConfig(...values)`: shallow merge, with later entries taking precedence.

Malformed JSON, unknown fields and invalid values raise a `CliError`.

`emptyConfig()` constructs a configuration whose absent fields are null.
