# Target patches

This directory carries source patches needed by upstream tools for
the Thistle64 target. Each patch should identify the upstream
project and version to which it applies.

Patches are build inputs, not installed files. A toolchain release
records their checksums in its lock metadata.

## Inspect the driver target

From the repository root:

```sh
bun run driver --help
```

The listed architecture and ABI defaults identify the target expected by the patch set.
