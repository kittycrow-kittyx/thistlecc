# Hosted examples

`hello.c` and `hello.cc` are minimal hosted-language inputs used to
confirm that the C and C++ front ends, standard libraries, linker and
THX packer agree on the selected target.

## Compile an example

With the RISC-V musl compiler on PATH, from the repository root:

```sh
bun run driver -c toolchain/hosted/hello.c -o /tmp/thistle-hello.o
```
