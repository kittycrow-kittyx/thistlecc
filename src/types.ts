export const VERSION = "2.1.1";

export type Language = "auto" | "c" | "c++";
export type Stage = "link" | "compile" | "assembly" | "preprocess" | "dependencies" | "relocatable";
export type EmitKind = "thx" | "elf" | "both";
export type ExtensionKind = "39" | "thx";
export type ColourMode = "auto" | "always" | "never";

export interface ThistleccConfig {
  mikuosHome: string | null;
  converter: string | null;
  cc: string | null;
  cxx: string | null;
  strip: string | null;
  readelf: string | null;
  toolchainPrefix: string | null;
  march: string | null;
  mabi: string | null;
  sysroot: string | null;
  outputExtension: ExtensionKind | null;
  reproducible: boolean | null;
  colour: ColourMode | null;
  defaultArgs: string[] | null;
  converterArgs: string[] | null;
}

export interface ConfigLoadResult {
  path: string | null;
  value: ThistleccConfig;
}

export interface CliOptions {
  cwd: string;
  configPath: string | null;
  noConfig: boolean;
  mikuosHome: string | null;
  converter: string | null;
  cc: string | null;
  cxx: string | null;
  stripCommand: string | null;
  readelf: string | null;
  toolchainPrefix: string | null;
  march: string;
  mabi: string;
  sysroot: string | null;
  language: Language;
  output: string | null;
  outputExtension: ExtensionKind;
  emit: EmitKind;
  keepElf: boolean;
  keepElfPath: string | null;
  strip: boolean;
  manifest: boolean;
  manifestPath: string | null;
  depfile: boolean;
  depfilePath: string | null;
  reproducible: boolean;
  colour: ColourMode;
  verbose: boolean;
  dryRun: boolean;
  keepWork: boolean;
  keepWorkPath: string | null;
  doctor: boolean;
  printConfig: boolean;
  unsafeTarget: boolean;
  compilerArgs: string[];
  converterArgs: string[];
}

export interface ResolvedTools {
  compiler: string;
  compilerKind: "cc" | "cxx";
  converter: string | null;
  strip: string | null;
  readelf: string | null;
}

export interface ElfSummary {
  machine: "riscv64";
  type: "executable";
  entry: string;
  programHeaders: number;
  hasInterpreter: boolean;
  hasDynamicSegment: boolean;
}

export interface ThxSummary {
  magic: "THX2";
  machine: "thistle64";
  version: 2;
  isa: "rv64gc";
  entry: number;
  payloadBytes: number;
  metadataBytes: number;
  checksum: string;
}

export interface Manifest {
  schema: "dev.kittycrow.thistlecc.manifest.v2";
  thistlecc: {
    version: string;
    runtime: string;
  };
  target: {
    operatingSystem: "mikuOS";
    kernelSource: "Thistle";
    generatedKernel: "Teto";
    architecture: "Thistle64";
    isa: "RV64GC";
    abi: string;
    executableFormat: "THX2";
  };
  build: {
    stage: Stage;
    emit: EmitKind;
    language: "c" | "c++";
    reproducible: boolean;
    sourceDateEpoch: string | null;
    compiler: string;
    compilerVersion: string | null;
    converter: string | null;
    converterSha256: string | null;
    compilerArguments: string[];
    converterArguments: string[] | null;
  };
  inputs: Array<{ path: string; sha256: string }>;
  outputs: Array<{ path: string; kind: string; bytes: number; sha256: string }>;
}

/** Values permitted by the JSON data grammar. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue; }
