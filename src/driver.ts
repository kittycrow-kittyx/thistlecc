import { chmod, copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { inputArguments } from "./args.js";
import { inspectElf, inspectThx } from "./format.js";
import type { CliOptions, Manifest, ResolvedTools, Stage } from "./types.js";
import { VERSION } from "./types.js";
import { absolute, atomicCopy, atomicWrite, commandExists, fail, firstExistingCommand, isRegularFile, pathExists, run, sha256File, sourceDateEpoch, defaultRunOptions, ensureDirectory } from "./util.js";

const SUPPORTED_MARCH = new Set(["rv64gc", "rv64g", "rv64imafdc", "rv64imafdc_zicsr_zifencei"]);
const SUPPORTED_MABI = new Set(["lp64d"]);

function optionPresent(args: readonly string[], name: string): boolean {
  return args.some(argument => argument === name || argument.startsWith(`${name}=`));
}

function deriveTool(command: string, from: RegExp, replacement: string): string | null {
  const candidate = command.replace(from, replacement);
  return candidate === command ? null : candidate;
}

function compilerCandidates(kind: "cc" | "cxx", prefix: string | null = null): string[] {
  const suffix = kind === "cc" ? "gcc" : "g++";
  return [
    ...(prefix ? [`${prefix}${suffix}`] : []),
    `riscv64-unknown-linux-musl-${suffix}`,
    `riscv64-linux-musl-${suffix}`,
  ];
}

function converterPaths(home: string): string[] {
  return [
    join(home, "src", "tool", "elf2thx.ts"),
    join(home, "build", "tool", "elf2thx.js"),
    join(home, "build", "tool", "elf2thx.mjs"),
    join(home, "src", "tool", "elf2thx.js"),
  ];
}

function converterCandidates(options: CliOptions): string[] {
  const result: string[] = [];
  if (options.converter) result.push(absolute(options.converter, options.cwd));
  if (options.mikuosHome) {
    const home = absolute(options.mikuosHome, options.cwd);
    result.push(...converterPaths(home));
  }

  let cursor = options.cwd;
  for (let depth = 0; depth < 12; depth += 1) {
    result.push(...converterPaths(cursor));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return [...new Set(result.map(path => resolve(path)))];
}

async function resolveConverter(options: CliOptions): Promise<string> {
  const candidates = converterCandidates(options);
  for (const candidate of candidates) {
    if (await isRegularFile(candidate)) return candidate;
  }
  return fail(`could not find the current mikuOS ELF-to-THX converter. Set --mikuos-home or --converter.\nSearched:\n${candidates.map(path => `  ${path}`).join("\n")}`, 3);
}

export async function resolveTools(options: CliOptions, language: "c" | "c++", stage: Stage): Promise<ResolvedTools> {
  // Only final THX links need the converter; ELF and intermediate compiler stages remain independent of mikuOS.
  const compilerKind = language === "c++" ? "cxx" : "cc";
  const explicitCompiler = compilerKind === "cc" ? options.cc : options.cxx;
  const compiler = explicitCompiler ?? firstExistingCommand(compilerCandidates(compilerKind, options.toolchainPrefix));
  if (!compiler) {
    fail(`could not find a RISC-V musl ${compilerKind === "cc" ? "C" : "C++"} compiler. Set --${compilerKind}, THISTLECC_${compilerKind.toUpperCase()}, or --toolchain-prefix.`, 3);
  }
  if (!options.dryRun && !commandExists(compiler)) fail(`command not found: ${compiler}`, 127);

  const converter = stage === "link" && options.emit !== "elf" ? await resolveConverter(options) : null;

  const stripCandidate = options.stripCommand
    ?? deriveTool(compiler, compilerKind === "cc" ? /gcc(?:\.exe)?$/ : /g\+\+(?:\.exe)?$/, "strip")
    ?? firstExistingCommand([
      ...(options.toolchainPrefix ? [`${options.toolchainPrefix}strip`] : []),
      "riscv64-unknown-linux-musl-strip",
      "riscv64-linux-musl-strip",
    ]);

  const readelfCandidate = options.readelf
    ?? deriveTool(compiler, compilerKind === "cc" ? /gcc(?:\.exe)?$/ : /g\+\+(?:\.exe)?$/, "readelf")
    ?? firstExistingCommand([
      ...(options.toolchainPrefix ? [`${options.toolchainPrefix}readelf`] : []),
      "riscv64-unknown-linux-musl-readelf",
      "riscv64-linux-musl-readelf",
      "readelf",
    ]);

  return {
    compiler,
    compilerKind,
    converter,
    strip: stripCandidate,
    readelf: readelfCandidate,
  };
}

function argumentValue(args: readonly string[], name: string): string | null {
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const argument = args[index] ?? "";
    if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
  }
  return null;
}

function appendLinkDefaults(args: readonly string[], result: string[]): void {
  if (!args.includes("-fno-pie") && !args.includes("-fpie") && !args.includes("-fPIE")) result.push("-fno-pie");
  if (!args.includes("-static") && !args.includes("-dynamic")) result.push("-static");
  if (!args.includes("-no-pie") && !args.includes("-pie")) result.push("-no-pie");
  if (!args.some(argument => argument.includes("--no-relax"))) result.push("-Wl,--no-relax");
  if (!args.some(argument => argument.includes("--build-id"))) result.push("-Wl,--build-id=none");
}

function appendPrefixMaps(args: readonly string[], result: string[], cwd: string): void {
  const prefix = `${cwd}=.`;
  if (!args.some(argument => argument.startsWith("-ffile-prefix-map="))) result.push(`-ffile-prefix-map=${prefix}`);
  if (!args.some(argument => argument.startsWith("-fdebug-prefix-map="))) result.push(`-fdebug-prefix-map=${prefix}`);
  if (!args.some(argument => argument.startsWith("-fmacro-prefix-map="))) result.push(`-fmacro-prefix-map=${prefix}`);
}

function targetArguments(options: CliOptions, stage: Stage): string[] {
  const effectiveMarch = argumentValue(options.compilerArgs, "-march") ?? options.march;
  const effectiveMabi = argumentValue(options.compilerArgs, "-mabi") ?? options.mabi;
  if (!options.unsafeTarget && !SUPPORTED_MARCH.has(effectiveMarch)) fail(`unsupported mikuOS target architecture ${effectiveMarch}; use rv64gc or --unsafe-target`, 2);
  if (!options.unsafeTarget && !SUPPORTED_MABI.has(effectiveMabi)) fail(`unsupported mikuOS ABI ${effectiveMabi}; use lp64d or --unsafe-target`, 2);

  const args = options.compilerArgs;
  const result: string[] = [];
  if (!optionPresent(args, "-march")) result.push(`-march=${options.march}`);
  if (!optionPresent(args, "-mabi")) result.push(`-mabi=${options.mabi}`);
  if (!args.includes("-mno-relax") && !args.includes("-mrelax")) result.push("-mno-relax");
  if (options.sysroot && !optionPresent(args, "--sysroot")) result.push(`--sysroot=${absolute(options.sysroot, options.cwd)}`);

  if (stage === "link") appendLinkDefaults(args, result);

  if (options.reproducible) appendPrefixMaps(args, result, options.cwd);

  if (options.colour !== "auto" && !args.some(argument => argument.startsWith("-fdiagnostics-color"))) {
    result.push(`-fdiagnostics-color=${options.colour}`);
  }

  return result;
}

function validateLinkArguments(options: CliOptions, stage: Stage): void {
  if (stage !== "link") return;
  for (const argument of options.compilerArgs) {
    if (argument === "-shared" || argument === "-pie" || argument === "-dynamic" || argument.startsWith("-Wl,--dynamic-linker") || argument.startsWith("-Wl,-dynamic-linker")) {
      fail(`dynamic or position-independent executable mode is unsupported by mikuOS THX: ${argument}`);
    }
  }
}

function runtimeName(): string {
  const bunVersion = process.versions.bun ?? null;
  if (!bunVersion) return fail("Bun is required");
  return `Bun ${bunVersion}`;
}

async function compilerVersion(command: string, cwd: string): Promise<string | null> {
  const result = run(command, ["--version"], { ...defaultRunOptions(), cwd, capture: true, allowFailure: true });
  return result.status === 0 ? ((result.stdout.split(/\r?\n/, 1)[0] ?? "").trim() || null) : null;
}

async function manifestInputs(options: CliOptions): Promise<Array<{ path: string; sha256: string }>> {
  const result: Array<{ path: string; sha256: string }> = [];
  for (const input of inputArguments(options.compilerArgs)) {
    const path = absolute(input, options.cwd);
    if (await isRegularFile(path)) result.push({ path, sha256: await sha256File(path) });
  }
  return result;
}

interface ManifestBuild {
  options: CliOptions;
  stage: Stage;
  language: "c" | "c++";
  tools: ResolvedTools;
  compilerArguments: string[];
  converterArguments: string[] | null;
  outputs: Array<{ path: string; kind: string }>;
}

async function makeManifest(build: ManifestBuild): Promise<Manifest> {
  const { options, stage, language, tools, compilerArguments, converterArguments, outputs } = build;
  const outputRecords: Manifest["outputs"] = [];
  for (const output of outputs) {
    const metadata = await stat(output.path);
    outputRecords.push({ path: output.path, kind: output.kind, bytes: metadata.size, sha256: await sha256File(output.path) });
  }
  const epoch = sourceDateEpoch(process.env);
  const detectedCompilerVersion = await compilerVersion(tools.compiler, options.cwd);
  return {
    schema: "dev.kittycrow.thistlecc.manifest.v2",
    thistlecc: { version: VERSION, runtime: runtimeName() },
    target: {
      operatingSystem: "mikuOS",
      kernelSource: "Thistle",
      generatedKernel: "Teto",
      architecture: "Thistle64",
      isa: "RV64GC",
      abi: options.mabi,
      executableFormat: "THX2",
    },
    build: {
      stage,
      emit: options.emit,
      language,
      reproducible: options.reproducible,
      sourceDateEpoch: epoch,
      compiler: tools.compiler,
      compilerVersion: detectedCompilerVersion,
      converter: tools.converter,
      converterSha256: tools.converter != null ? await sha256File(tools.converter) : null,
      compilerArguments,
      converterArguments: converterArguments,
    },
    inputs: await manifestInputs(options),
    outputs: outputRecords,
  };
}

export async function doctor(options: CliOptions, language: "c" | "c++", stage: Stage): Promise<void> {
  const tools = await resolveTools(options, language, stage);
  const compilerProbe = run(tools.compiler, ["-dumpmachine"], { ...defaultRunOptions(), cwd: options.cwd, capture: true, allowFailure: true });
  const versionProbe = run(tools.compiler, ["--version"], { ...defaultRunOptions(), cwd: options.cwd, capture: true, allowFailure: true });
  const report = {
    thistlecc: VERSION,
    runtime: runtimeName(),
    cwd: options.cwd,
    target: { march: options.march, mabi: options.mabi, architecture: "Thistle64", isa: "RV64GC", format: "THX2" },
    compiler: {
      command: tools.compiler,
      kind: tools.compilerKind,
      machine: compilerProbe.stdout.trim() || null,
      version: (versionProbe.stdout.split(/\r?\n/, 1)[0] ?? "").trim() || null,
      healthy: compilerProbe.status === 0 && versionProbe.status === 0,
    },
    converter: tools.converter ?? null,
    strip: tools.strip ?? null,
    readelf: tools.readelf ?? null,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.compiler.healthy) fail("compiler diagnostic failed", 3);
}

interface ThxPublication {
  options: CliOptions;
  tools: ResolvedTools;
  elf: string;
  thx: string;
  output: string;
  finalElf: string;
  produced: Array<{ path: string; kind: string }>;
}

async function publishThx(publication: ThxPublication): Promise<string[]> {
  const { options, tools, elf, thx, output, finalElf, produced } = publication;
  if (!tools.converter) fail("internal error: converter was not resolved", 3);
  const args = [tools.converter, ...options.converterArgs, elf, thx];
  run(process.execPath, args, { ...defaultRunOptions(), cwd: options.cwd, verbose: options.verbose });
  await inspectThx(thx);
  await atomicCopy(thx, output, 0o755);
  produced.push({ path: output, kind: "thx2" });
  if (options.emit === "both" || options.keepElf) {
    await atomicCopy(elf, finalElf, 0o755);
    produced.push({ path: finalElf, kind: "elf64-riscv" });
  }
  return args;
}

async function stripElf(options: CliOptions, tools: ResolvedTools, elf: string): Promise<void> {
  if (!tools.strip || !commandExists(tools.strip)) fail("--strip requested but no RISC-V strip command was found", 3);
  run(tools.strip, ["--strip-all", elf], { ...defaultRunOptions(), cwd: options.cwd, verbose: options.verbose });
  await inspectElf(elf);
}

function compileIntermediate(options: CliOptions, tools: ResolvedTools, effectiveArgs: string[]): void {
  if (options.depfile) {
    const depfile = absolute(options.depfilePath ?? `${options.output ?? "dependencies"}.d`, options.cwd);
    effectiveArgs.push("-MMD", "-MF", depfile);
  }
  if (options.output) effectiveArgs.push("-o", absolute(options.output, options.cwd));
  run(tools.compiler, effectiveArgs, { ...defaultRunOptions(), cwd: options.cwd, verbose: options.verbose, dryRun: options.dryRun });
}

export async function compile(options: CliOptions, stage: Stage, language: "c" | "c++"): Promise<void> {
  // The temporary ELF is validated before conversion; publish outputs only after the requested format passes its checks.
  validateLinkArguments(options, stage);
  const tools = await resolveTools(options, language, stage);
  const hasInputs = inputArguments(options.compilerArgs).length > 0;
  if (options.printConfig) process.stdout.write(`${JSON.stringify({ options, stage, language, tools }, null, 2)}\n`);
  if (options.doctor) await doctor(options, language, stage);
  if (!hasInputs && (options.printConfig || options.doctor)) return;

  const targetArgs = targetArguments(options, stage);
  const effectiveArgs = [...targetArgs, ...options.compilerArgs];

  if (stage !== "link") { compileIntermediate(options, tools, effectiveArgs); return; }

  if (!options.output) fail("no output path was provided");
  const output = absolute(options.output, options.cwd);
  await ensureDirectory(dirname(output));

  const workRoot = options.keepWorkPath ? absolute(options.keepWorkPath, options.cwd) : dirname(output);
  await ensureDirectory(workRoot);
  const work = await mkdtemp(join(workRoot, ".thistlecc-"));
  const elf = join(work, `${basename(output)}.elf`);
  const thx = join(work, `${basename(output)}.thx.tmp`);
  const finalElf = absolute(options.keepElfPath ?? `${output}.elf`, options.cwd);
  const produced: Array<{ path: string; kind: string }> = [];

  if (options.depfile) {
    const depfile = absolute(options.depfilePath ?? `${output}.d`, options.cwd);
    effectiveArgs.push("-MMD", "-MF", depfile);
  }
  const compilerArguments = [...effectiveArgs, "-o", elf];

  try {
    run(tools.compiler, compilerArguments, { ...defaultRunOptions(), cwd: options.cwd, verbose: options.verbose, dryRun: options.dryRun });
    if (options.dryRun && options.emit !== "elf" && tools.converter) run(process.execPath, [tools.converter, ...options.converterArgs, elf, thx], { ...defaultRunOptions(), cwd: options.cwd, verbose: true, dryRun: true });
    if (options.dryRun) return;

    await inspectElf(elf);
    if (options.strip) await stripElf(options, tools, elf);

    let converterArguments: string[] | null = null;
    if (options.emit === "elf") {
      await atomicCopy(elf, output, 0o755);
      produced.push({ path: output, kind: "elf64-riscv" });
    } else {
      converterArguments = await publishThx({ options, tools, elf, thx, output, finalElf, produced });
    }

    if (options.manifest) {
      const manifestPath = absolute(options.manifestPath ?? `${output}.manifest.json`, options.cwd);
      const manifest = await makeManifest({ options, stage, language, tools, compilerArguments, converterArguments, outputs: produced });
      await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 0o644);
      produced.push({ path: manifestPath, kind: "thistlecc-manifest-v2" });
    }

    for (const item of produced) process.stdout.write(`${item.path}\n`);
  } finally {
    if (options.keepWork) {
      process.stderr.write(`thistlecc: kept work directory: ${work}\n`);
    } else {
      await rm(work, { recursive: true, force: true });
    }
  }
}
