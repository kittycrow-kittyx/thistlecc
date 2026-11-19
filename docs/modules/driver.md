# Compiler driver

- `resolveTools(options, language, stage)`: find host compiler, converter, strip and readelf commands. Only final THX links need the converter.
- `doctor(options, language, stage)`: print machine and compiler diagnostics as JSON.
- `compile(options, stage, language)`: invoke the selected compiler, validate final ELF/THX files and publish the requested outputs.

Final links use a temporary work directory; `--keep-work` preserves it for diagnosis.
