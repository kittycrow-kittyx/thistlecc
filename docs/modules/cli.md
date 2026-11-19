# CLI entry

`helpText()` returns usage, stage selection, target policy and configuration flags. `main(argv)` combines JSON configuration, environment variables and argument overrides before invoking the driver. It returns a numeric process exit status and writes diagnostic errors to stderr. Help and version requests return status 0.
