import { parseJson } from "./json.js";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import type { ConfigLoadResult, ThistleccConfig, JsonValue, JsonObject } from "./types.js";
import { fail, isRegularFile } from "./util.js";

export function emptyConfig(): ThistleccConfig {
  return { mikuosHome: null, converter: null, cc: null, cxx: null, strip: null, readelf: null, toolchainPrefix: null, march: null, mabi: null, sysroot: null, outputExtension: null, reproducible: null, colour: null, defaultArgs: null, converterArgs: null };
}

const CONFIG_NAMES = ["thistlecc.json", ".thistlecc.json"] as const;

function stringValue(record: JsonObject, key: keyof ThistleccConfig): string | null {
  const value = record[key] ?? null;
  if (!Object.hasOwn(record, key)) return null;
  if (typeof value !== "string" || value.length === 0) fail(`configuration key ${key} must be a non-empty string`, 3);
  return value;
}

function booleanValue(record: JsonObject, key: keyof ThistleccConfig): boolean | null {
  const value = record[key] ?? null;
  if (!Object.hasOwn(record, key)) return null;
  if (typeof value !== "boolean") fail(`configuration key ${key} must be a boolean`, 3);
  return value;
}

function stringArray(record: JsonObject, key: keyof ThistleccConfig): string[] | null {
  const value = record[key] ?? null;
  if (!Object.hasOwn(record, key)) return null;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    fail(`configuration key ${key} must be an array of strings`, 3);
  }
  return value.map(item => { if (typeof item !== "string") fail(`configuration key ${key} must be an array of strings`, 3); return item; });
}

function configRecord(text: string, path: string): JsonObject {
  let parsed: JsonValue = null;
  try {
    parsed = parseJson(text);
  } catch (error) {
    fail(`could not parse ${path}: ${error instanceof Error ? error.message : (typeof error === "string" ? error : "non-Error exception")}`, 3);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`${path} must contain a JSON object`, 3);
  const record = parsed;
  const allowed = new Set([
    "$schema", "mikuosHome", "converter", "cc", "cxx", "strip", "readelf",
    "toolchainPrefix", "march", "mabi", "sysroot", "outputExtension",
    "reproducible", "colour", "defaultArgs", "converterArgs",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) fail(`${path}: unknown configuration key ${key}`, 3);
  }
  if (Object.hasOwn(record, "$schema") && typeof (record.$schema ?? null) !== "string") fail(`${path}: $schema must be a string`, 3);
  return record;
}

type StringConfigKey = "mikuosHome" | "converter" | "cc" | "cxx" | "strip" | "readelf" | "toolchainPrefix" | "march" | "mabi" | "sysroot";

function parseConfig(text: string, path: string): ThistleccConfig {
  const record = configRecord(text, path);
  const outputExtension = stringValue(record, "outputExtension");
  if (outputExtension != null && outputExtension !== "39" && outputExtension !== "thx") {
    fail(`${path}: outputExtension must be "39" or "thx"`, 3);
  }
  const colour = stringValue(record, "colour");
  if (colour !== null && colour !== "auto" && colour !== "always" && colour !== "never") {
    fail(`${path}: colour must be auto, always or never`, 3);
  }

  const result = emptyConfig();
  const strings: StringConfigKey[] = [
    "mikuosHome", "converter", "cc", "cxx", "strip", "readelf",
    "toolchainPrefix", "march", "mabi", "sysroot",
  ];
  for (const key of strings) {
    const value = stringValue(record, key);
    if (value != null) result[key] = value;
  }
  if (outputExtension != null) result.outputExtension = outputExtension;
  const reproducible = booleanValue(record, "reproducible");
  if (reproducible != null) result.reproducible = reproducible;
  if (colour != null) result.colour = colour;
  const defaultArgs = stringArray(record, "defaultArgs");
  if (defaultArgs != null) result.defaultArgs = defaultArgs;
  const converterArgs = stringArray(record, "converterArgs");
  if (converterArgs != null) result.converterArgs = converterArgs;
  return result;
}

function configPathValue(value: string | null): string {
  if (!value) fail("--config requires a path");
  return value;
}

export function scanConfigArguments(argv: readonly string[]): { path: string | null; disabled: boolean } {
  let path: string | null = null;
  let disabled = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--no-config") disabled = true;
    if (argument === "--config") {
      path = configPathValue(argv[index + 1] ?? null);
      index += 1;
      continue;
    }
    if (argument.startsWith("--config=")) {
      path = argument.slice("--config=".length);
    }
  }
  return { path, disabled };
}

async function readExplicitConfig(path: string): Promise<ConfigLoadResult> {
  if (!(await isRegularFile(path))) fail(`configuration file not found: ${path}`, 3);
  return { path, value: parseConfig(await readFile(path, "utf8"), path) };
}

export async function loadConfig(cwd: string, explicitPath: string | null = null, disabled = false): Promise<ConfigLoadResult> {
  if (disabled) return { path: null, value: emptyConfig() };

  if (explicitPath) return readExplicitConfig(resolve(cwd, explicitPath));

  let cursor = resolve(cwd);
  while (true) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(cursor, name);
      if (await isRegularFile(candidate)) {
        return { path: candidate, value: parseConfig(await readFile(candidate, "utf8"), candidate) };
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }

  return { path: null, value: emptyConfig() };
}

export function environmentConfig(env: NodeJS.ProcessEnv = process.env): ThistleccConfig {
  const outputExtension = env.THISTLECC_OUTPUT_EXTENSION ?? null;
  if (outputExtension != null && outputExtension !== "39" && outputExtension !== "thx") {
    fail("THISTLECC_OUTPUT_EXTENSION must be 39 or thx", 3);
  }

  const result = emptyConfig();
  const assign = (key: StringConfigKey, value: string | null): void => {
    if (value != null && value.length > 0) result[key] = value;
  };
  assign("mikuosHome", env.MIKUOS_HOME ?? (env.THISTLE_HOME ?? null));
  assign("converter", env.THISTLECC_CONVERTER ?? (env.THISTLE_ELF2THX ?? null));
  assign("cc", env.THISTLECC_CC ?? (env.THISTLE_CC ?? null));
  assign("cxx", env.THISTLECC_CXX ?? (env.THISTLE_CXX ?? null));
  assign("strip", env.THISTLECC_STRIP ?? null);
  assign("readelf", env.THISTLECC_READELF ?? null);
  assign("toolchainPrefix", env.THISTLECC_TOOLCHAIN_PREFIX ?? null);
  assign("march", env.THISTLECC_MARCH ?? null);
  assign("mabi", env.THISTLECC_MABI ?? null);
  assign("sysroot", env.THISTLECC_SYSROOT ?? null);
  if (outputExtension != null) result.outputExtension = outputExtension;
  return result;
}

export function mergeConfig(...values: readonly ThistleccConfig[]): ThistleccConfig {
  const result = emptyConfig();
  for (const value of values) {
    for (const key of ["mikuosHome", "converter", "cc", "cxx", "strip", "readelf", "toolchainPrefix", "march", "mabi", "sysroot"] as const) result[key] = value[key] ?? result[key];
    result.outputExtension = value.outputExtension ?? result.outputExtension;
    result.reproducible = value.reproducible ?? result.reproducible;
    result.colour = value.colour ?? result.colour;
    result.defaultArgs = value.defaultArgs ?? result.defaultArgs;
    result.converterArgs = value.converterArgs ?? result.converterArgs;
  }
  return result;
}
