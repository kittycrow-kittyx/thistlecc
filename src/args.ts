import { basename, extname, resolve } from "node:path";
import process from "node:process";
import type { CliOptions, Language, Stage, ThistleccConfig } from "./types.js";
import { fail } from "./util.js";

const CXX_EXTENSIONS = new Set([".cc", ".cp", ".cpp", ".cxx", ".c++", ".CPP", ".C", ".ii"]);
const C_EXTENSIONS = new Set([".c", ".i", ".s", ".S"]);
const LINK_INPUT_EXTENSIONS = new Set([".o", ".a"]);

function takeValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1] ?? null;
  if (value == null) fail(`${option} requires a value`);
  return value;
}

function optionalEquals(argument: string, name: string): string | null {
  return argument.startsWith(`${name}=`) ? argument.slice(name.length + 1) : null;
}

function stageFromArguments(args: readonly string[]): Stage {
  if (args.includes("-E")) return "preprocess";
  if (args.includes("-M") || args.includes("-MM")) return "dependencies";
  if (args.includes("-S")) return "assembly";
  if (args.includes("-c")) return "compile";
  if (args.includes("-r")) return "relocatable";
  return "link";
}

export function inferLanguage(args: readonly string[], requested: Language, invocation = process.argv[1] ?? "thistlecc"): "c" | "c++" {
  if (requested !== "auto") return requested;
  const executable = basename(invocation).toLowerCase();
  if (executable.includes("++") || executable.endsWith("cxx")) return "c++";

  let languageOverride: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (argument === "-x") languageOverride = args[index + 1] ?? null;
    if (argument.startsWith("-x") && argument !== "-x") languageOverride = argument.slice(2);
  }
  if (languageOverride && languageOverride.includes("++")) return "c++";
  if (languageOverride === "c" || languageOverride === "cpp-output") return "c";

  return args.some(argument => !argument.startsWith("-") && CXX_EXTENSIONS.has(extname(argument))) ? "c++" : "c";
}

export function inputArguments(args: readonly string[]): string[] {
  const result: string[] = [];
  const optionsWithValues = new Set(["-o", "-I", "-L", "-l", "-x", "-MF", "-MT", "-MQ", "-include", "-isystem", "-iquote", "-idirafter", "--sysroot"]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? null;
    if (argument == null) continue;
    if (optionsWithValues.has(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith("-")) continue;
    const extension = extname(argument);
    if (C_EXTENSIONS.has(extension) || CXX_EXTENSIONS.has(extension) || LINK_INPUT_EXTENSIONS.has(extension)) result.push(argument);
  }
  return result;
}

export function defaultOutput(args: readonly string[], stage: Stage, extension: "39" | "thx"): string | null {
  if (stage === "preprocess" || stage === "dependencies") return null;
  const inputs = inputArguments(args);
  if (stage !== "link" && inputs.length !== 1) return null;
  const first = inputs[0] ?? null;
  if (!first) return stage === "link" ? `a.${extension}` : null;
  const stem = basename(first, extname(first));
  if (stage === "compile") return `${stem}.o`;
  if (stage === "assembly") return `${stem}.s`;
  if (stage === "relocatable") return `${stem}.o`;
  return `${stem}.${extension}`;
}

export interface ParsedArguments {
  options: CliOptions;
  stage: Stage;
  language: "c" | "c++";
}

function defaultOptions(config: ThistleccConfig, cwd: string): CliOptions {
  return {
    cwd: resolve(cwd),
    noConfig: false,
    configPath: null,
    output: null,
    keepElfPath: null,
    manifestPath: null,
    depfilePath: null,
    keepWorkPath: null,
    mikuosHome: config.mikuosHome,
    converter: config.converter,
    cc: config.cc,
    cxx: config.cxx,
    stripCommand: config.strip,
    readelf: config.readelf,
    toolchainPrefix: config.toolchainPrefix,
    march: config.march ?? "rv64gc",
    mabi: config.mabi ?? "lp64d",
    sysroot: config.sysroot,
    language: "auto",
    outputExtension: config.outputExtension ?? "39",
    emit: "thx",
    keepElf: false,
    strip: false,
    manifest: false,
    depfile: false,
    reproducible: config.reproducible ?? true,
    colour: config.colour ?? "auto",
    verbose: false,
    dryRun: false,
    keepWork: false,
    doctor: false,
    printConfig: false,
    unsafeTarget: false,
    compilerArgs: [...(config.defaultArgs ?? [])],
    converterArgs: [...(config.converterArgs ?? [])],
  };
}

function applyFlag(argument: string, options: CliOptions): boolean {
  if (argument === "--help" || argument === "-h") fail("__HELP__", 0);
  if (argument === "--version") fail("__VERSION__", 0);
  if (argument === "--verbose" || argument === "-v") { options.verbose = true; return true; }
  if (argument === "--dry-run") { options.dryRun = true; options.verbose = true; return true; }
  if (argument === "--doctor" || argument === "--check") { options.doctor = true; return true; }
  if (argument === "--print-config") { options.printConfig = true; return true; }
  if (argument === "--no-config") { options.noConfig = true; return true; }
  if (argument === "--unsafe-target") { options.unsafeTarget = true; return true; }
  if (argument === "--reproducible") { options.reproducible = true; return true; }
  if (argument === "--no-reproducible") { options.reproducible = false; return true; }
  if (argument === "--strip") { options.strip = true; return true; }
  if (argument === "--keep-elf") { options.keepElf = true; options.emit = "both"; return true; }
  if (argument === "--keep-work") { options.keepWork = true; return true; }
  if (argument === "--manifest") { options.manifest = true; return true; }
  if (argument === "--depfile") { options.depfile = true; return true; }
  return false;
}

type StringOptionKey = "configPath" | "mikuosHome" | "converter" | "cc" | "cxx" | "stripCommand" | "readelf" | "toolchainPrefix" | "march" | "mabi" | "sysroot" | "cwd";

const stringOptions: Array<[string, StringOptionKey]> = [
  ["--config", "configPath"], ["--mikuos-home", "mikuosHome"], ["--thistle-home", "mikuosHome"],
  ["--converter", "converter"], ["--elf2thx", "converter"], ["--cc", "cc"], ["--cxx", "cxx"],
  ["--strip-command", "stripCommand"], ["--readelf", "readelf"], ["--toolchain-prefix", "toolchainPrefix"],
  ["--march", "march"], ["--mabi", "mabi"], ["--sysroot", "sysroot"], ["--cwd", "cwd"],

];

function applyStringOption(argv: readonly string[], index: number, argument: string, options: CliOptions): number | null {
  for (const [name, key] of stringOptions) {
    if (argument === name) { options[key] = takeValue(argv, index, name); return 1; }
    const value = optionalEquals(argument, name);
    if (value != null) { options[key] = value; return 0; }
  }
  return null;
}

const choices = new Set(["--language", "--emit", "--output-extension", "--colour", "--color"]);

function applyChoiceOption(argv: readonly string[], index: number, argument: string, options: CliOptions): number | null {
  const equals = argument.indexOf("=");
  const name = equals < 0 ? argument : argument.slice(0, equals);
  if (!choices.has(name)) return null;
  const value = equals < 0 ? takeValue(argv, index, argument) : argument.slice(equals + 1);
  switch (name) {
    case "--language":
      if (value !== "auto" && value !== "c" && value !== "c++") fail("--language must be auto, c or c++");
      options.language = value; break;
    case "--emit":
      if (value !== "thx" && value !== "elf" && value !== "both") fail("--emit must be thx, elf or both");
      options.emit = value; break;
    case "--output-extension":
      if (value !== "39" && value !== "thx") fail("--output-extension must be 39 or thx");
      options.outputExtension = value; break;
    case "--colour": case "--color":
      if (value !== "auto" && value !== "always" && value !== "never") fail("--colour must be auto, always or never");
      options.colour = value; break;
  }
  return equals < 0 ? 1 : 0;
}

function applyOutputOption(argv: readonly string[], index: number, argument: string, options: CliOptions): number | null {
  if (argument.startsWith("--keep-elf=")) { options.keepElf = true; options.emit = "both"; options.keepElfPath = argument.slice("--keep-elf=".length); return 0; }
  if (argument.startsWith("--keep-work=")) { options.keepWork = true; options.keepWorkPath = argument.slice("--keep-work=".length); return 0; }
  if (argument.startsWith("--manifest=")) { options.manifest = true; options.manifestPath = argument.slice("--manifest=".length); return 0; }
  if (argument.startsWith("--depfile=")) { options.depfile = true; options.depfilePath = argument.slice("--depfile=".length); return 0; }
  if (argument === "--converter-arg") { options.converterArgs.push(takeValue(argv, index, argument)); return 1; }
  if (argument.startsWith("--converter-arg=")) { options.converterArgs.push(argument.slice("--converter-arg=".length)); return 0; }

  if (argument === "-o") { options.output = takeValue(argv, index, argument); return 1; }
  if (argument.startsWith("-o") && argument.length > 2) { options.output = argument.slice(2); return 0; }
  return null;
}

export function parseArguments(argv: readonly string[], config: ThistleccConfig, cwd = process.cwd()): ParsedArguments {
  // Apply wrapper flags in command-line order; pass unrecognised flags to the host compiler.
  const options = defaultOptions(config, cwd);

  let passthrough = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? null;
    if (argument == null) continue;
    if (passthrough) {
      options.compilerArgs.push(argument);
      continue;
    }
    if (argument === "--") {
      passthrough = true;
      continue;
    }
    if (applyFlag(argument, options)) continue;

    const consumed = applyStringOption(argv, index, argument, options);
    if (consumed != null) { index += consumed; continue; }

    const choice = applyChoiceOption(argv, index, argument, options);
    if (choice != null) { index += choice; continue; }

    const extra = applyOutputOption(argv, index, argument, options);
    if (extra != null) { index += extra; continue; }

    options.compilerArgs.push(argument);
  }

  options.cwd = resolve(cwd, options.cwd);
  const stage = stageFromArguments(options.compilerArgs);
  const language = inferLanguage(options.compilerArgs, options.language);
  const inferredOutput = options.output ?? defaultOutput(options.compilerArgs, stage, options.outputExtension);
  if (inferredOutput != null) options.output = inferredOutput;

  if (stage !== "link" && options.emit !== "thx") fail("--emit is only meaningful for a final linked executable");
  if (stage !== "link" && options.keepElf) fail("--keep-elf is only meaningful for a final linked executable");
  if (options.strip && stage !== "link") fail("--strip requires a final linked executable");
  if (options.manifest && options.output == null) fail("--manifest requires a named output");
  if (options.depfile && (stage === "preprocess" || stage === "dependencies")) fail("--depfile cannot be combined with dependency/preprocessor-only output");

  return { options, stage, language };
}
