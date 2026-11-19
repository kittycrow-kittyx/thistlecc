# Argument parsing

| Export | Behaviour |
| --- | --- |
| `inferLanguage` | Select C or C++ from explicit language, executable name and input suffixes |
| `inputArguments` | Extract recognised source and link inputs, skipping flag values |
| `defaultOutput` | Derive the output file name from the stage and suffix |
| `ParsedArguments` | Result containing options, stage and language |
| `parseArguments` | Combine configuration defaults with CLI overrides; reject incompatible stage/output flags |

Arguments after `--` are forwarded to the host compiler.
