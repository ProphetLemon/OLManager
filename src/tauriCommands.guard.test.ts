import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname);
const LIB_RS = resolve(__dirname, "../src-tauri/src/lib.rs");

const TEST_FILE = /\.(test|spec)\.tsx?$|\.testing\.tsx?$|testKit\.tsx?$|^test-setup\.ts$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !TEST_FILE.test(entry)) out.push(full);
  }
  return out;
}

/** Drops `//` and block comments so a commented-out call or entry is not counted. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

/** Names inside `tauri::generate_handler![ ... ]`, path-qualified entries reduced to their last segment. */
export function registeredCommands(librs: string): Set<string> {
  const body = /generate_handler!\s*\[([\s\S]*?)\n\s*\]\)/.exec(stripComments(librs))?.[1];
  if (!body) throw new Error("generate_handler! block not found in lib.rs");
  const names = body
    .split(",")
    .map((entry) => entry.replace(/#\[[^\]]*\]/g, "").trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").pop() as string);
  return new Set(names);
}

export interface InvokeSite {
  file: string;
  line: number;
  name: string;
}

const INVOKE_CALL = /\binvoke\s*(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*("([A-Za-z0-9_]+)"|`[^`]*`|'[^']*'|([A-Za-z_$][\w$.]*)|)/g;

/**
 * Every command name a source file invokes. A literal gives its name; an identifier is resolved through
 * a `name: "a" | "b"` annotation in the same file; anything else is reported as `<dynamic: ...>` so
 * the guard fails instead of skipping it.
 */
export function invokedCommands(file: string, source: string): InvokeSite[] {
  const code = stripComments(source);
  const sites: InvokeSite[] = [];
  for (const match of code.matchAll(INVOKE_CALL)) {
    const line = code.slice(0, match.index).split("\n").length;
    const before = code.slice(Math.max(0, (match.index ?? 0) - 12), match.index);
    if (/function\s*$|\.\s*$/.test(before) && !/core\.\s*$/.test(before)) continue; // declarations such as `function invoke(`
    if (match[2]) {
      sites.push({ file, line, name: match[2] });
      continue;
    }
    const ident = match[3];
    if (!ident) {
      sites.push({ file, line, name: `<dynamic: ${match[1] || "?"}>` });
      continue;
    }
    const union = new RegExp(`\\b${ident}\\s*:\\s*((?:"[A-Za-z0-9_]+"\\s*\\|?\\s*)+)`).exec(code);
    if (!union) {
      sites.push({ file, line, name: `<dynamic: ${ident}>` });
      continue;
    }
    for (const literal of union[1].matchAll(/"([A-Za-z0-9_]+)"/g)) sites.push({ file, line, name: literal[1] });
  }
  return sites;
}

function allInvokeSites(): InvokeSite[] {
  return walk(SRC_ROOT).flatMap((file) => {
    const rel = relative(SRC_ROOT, file).split("\\").join("/");
    if (rel === "tauriCommands.guard.test.ts") return [];
    return invokedCommands(`src/${rel}`, readFileSync(file, "utf8"));
  });
}

describe("tauri command parser", () => {
  it("reads literal, generic and multi-line invoke calls", () => {
    const source = [
      'invoke("one");',
      'await invoke<Foo>("two", { a: 1 });',
      "invoke<Record<string, number>>(",
      '  "three",',
      "  { a },",
      ");",
      '// invoke("commented")',
    ].join("\n");
    expect(invokedCommands("x.ts", source).map((s) => s.name)).toEqual(["one", "two", "three"]);
  });

  it("resolves an identifier through its literal union and flags the rest as dynamic", () => {
    const resolved = invokedCommands("x.ts", 'async (command: "a_b" | "c_d") => invoke<X>(command, {})');
    expect(resolved.map((s) => s.name)).toEqual(["a_b", "c_d"]);
    const dynamic = invokedCommands("x.ts", "invoke(someName)");
    expect(dynamic[0].name).toBe("<dynamic: someName>");
  });

  it("reduces path-qualified handler entries and ignores comments", () => {
    const rs = "x\n.invoke_handler(tauri::generate_handler![\n  plain,\n  commands::world::export_it, // note\n  // gone,\n  other\n])";
    expect([...registeredCommands(rs)]).toEqual(["plain", "export_it", "other"]);
  });
});

describe("tauri command registry guard", () => {
  const registered = registeredCommands(readFileSync(LIB_RS, "utf8"));
  const sites = allInvokeSites();

  it("finds a plausible number of invoked and registered commands", () => {
    // A broken pattern would find nothing and pass vacuously; the app has well over 100 of each.
    expect(new Set(sites.map((s) => s.name)).size).toBeGreaterThan(100);
    expect(registered.size).toBeGreaterThan(100);
  });

  it("registers every command the frontend invokes, with no dynamic names", () => {
    const missing = sites
      .filter((site) => !registered.has(site.name))
      .map((site) => `${site.name} (${site.file}:${site.line})`);
    expect(missing).toEqual([]);
  });
});
