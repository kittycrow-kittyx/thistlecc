# Smoke tests

The smoke inputs exercise compilation, linking and THX execution for
the smallest useful C, C++ and assembly programmes. They are intended
to catch a broken compiler or sysroot before a larger package build
starts.

## Compile-only smoke input

With a configured RISC-V toolchain, from the repository root:

```sh
bun run driver -c toolchain/smoke/hello.c -o /tmp/thistle-smoke.o
```
