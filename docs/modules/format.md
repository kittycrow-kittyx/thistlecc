# Binary validation

| Function | Input | Result |
| --- | --- | --- |
| `inspectElf` | File path | `ElfSummary` for static little-endian ELF64 RISC-V executable |
| `inspectThx` | File path | `ThxSummary` for THX2 with valid lengths, FNV-1a checksum and RV64GC metadata |

Invalid images raise a `CliError` with exit status 4.
