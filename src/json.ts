import type { JsonValue, JsonObject } from "./types.js";

// Decode the JSON grammar directly so an untyped host parser cannot bypass the binary boundary.
class JsonReader {
  private at = 0;
  constructor(private readonly source: string) {}
  private whitespace(): void {
    while (this.at < this.source.length && /[ \t\r\n]/.test(this.source.charAt(this.at))) this.at++;
  }
  private take(s: string): boolean {
    this.whitespace();
    if (!this.source.startsWith(s, this.at)) return false;
    this.at += s.length;
    return true;
  }
  private string(): string {
    this.whitespace();
    const match = /^"((?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*)"/.exec(this.source.slice(this.at));
    if (!match) throw new Error("invalid JSON string");
    this.at += match[0].length;
    const escapes: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
    return (match[1] ?? "").replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_match: string, code: string) => code.startsWith("u") ? String.fromCharCode(Number.parseInt(code.slice(1), 16)) : escapes[code] ?? "");
  }
  private object(): JsonObject {
    const value: JsonObject = {};
    if (this.take("}")) return value;
    do {
      const key = this.string();
      if (!this.take(":")) throw new Error("invalid JSON member");
      Object.defineProperty(value, key, { value: this.value(), enumerable: true, configurable: true, writable: true });
    } while (this.take(","));
    if (!this.take("}")) throw new Error("invalid JSON object");
    return value;
  }
  private array(): JsonValue[] {
    const value: JsonValue[] = [];
    if (this.take("]")) return value;
    do { value.push(this.value()); } while (this.take(","));
    if (!this.take("]")) throw new Error("invalid JSON array");
    return value;
  }
  private value(): JsonValue {
    this.whitespace();
    if (this.take("{")) return this.object();
    if (this.take("[")) return this.array();
    if (this.source.charAt(this.at) === '"') return this.string();
    if (this.take("true")) return true;
    if (this.take("false")) return false;
    if (this.take("null")) return null;
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.at));
    if (!match) throw new Error("invalid JSON value");
    this.at += match[0].length;
    return Number(match[0]);
  }
  parse(): JsonValue {
    const result = this.value();
    this.whitespace();
    if (this.at !== this.source.length) throw new Error("trailing JSON data");
    return result;
  }
}

export function parseJson(text: string): JsonValue { return new JsonReader(text).parse(); }

export function parseJsonObject(text: string): JsonObject {
  const value = parseJson(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected JSON object");
  return value;
}
