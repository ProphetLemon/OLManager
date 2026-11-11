import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(__dirname, "..");
const SCAN_ROOT = join(SRC_ROOT, "ui-v2");

// `_legacy` is v1 code that v2 still wraps (ported file by file); the shadcn primitives
// in `components/ui/` ship defaults that their callers override.
const EXCLUDED_DIRS = ["ui-v2/_legacy/", "ui-v2/components/ui/"];

// Game abbreviations that read the same in all eight locales (see common.ovr, players.colOvr).
const ALLOWED_WORDS = new Set(["OVR", "LP", "BO", "Bo"]);

const TRANSLATABLE_ATTRIBUTES = new Set(["title", "aria-label", "placeholder", "alt"]);
const WORD = /\p{L}{2,}/gu;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** The words of a literal that someone has to translate. */
export function untranslatedWords(text: string): string[] {
  return (text.match(WORD) ?? []).filter((word) => !ALLOWED_WORDS.has(word));
}

/** String pieces that a JSX child expression can render: `{"x"}`, `{a ? "x" : "y"}`, `{a ?? "x"}`, templates. */
function renderedStrings(node: ts.Expression): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return renderedStrings(node.expression);
  if (ts.isConditionalExpression(node)) return [...renderedStrings(node.whenTrue), ...renderedStrings(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(
      node.operatorToken.kind,
    )
  ) {
    return [...renderedStrings(node.left), ...renderedStrings(node.right)];
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.flatMap((span) => [span.literal.text, ...renderedStrings(span.expression)])];
  }
  return [];
}

export function findHardcodedText(source: string, fileName = "file.tsx"): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/g, " ").trim();
      if (untranslatedWords(text).length > 0) found.push(text);
    } else if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      for (const text of renderedStrings(node.expression)) {
        if (untranslatedWords(text).length > 0) found.push(text.trim());
      }
    } else if (
      ts.isJsxAttribute(node) &&
      TRANSLATABLE_ATTRIBUTES.has(node.name.getText()) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      untranslatedWords(node.initializer.text).length > 0
    ) {
      found.push(`${node.name.getText()}="${node.initializer.text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("hardcoded text guard", () => {
  it("flags literal words in JSX text, child expressions and accessible attributes", () => {
    const source = `
      export const A = () => (
        <div title="Close dialog" aria-label={t("x")} className="flex">
          <span>OVR</span>
          <span>{n} discovered</span>
          <span>{name ?? "Unknown League"}</span>
          <span>{t("common.all")}</span>
          <span>{"·"}</span>
        </div>
      );`;

    expect(findHardcodedText(source)).toEqual(['title="Close dialog"', "discovered", "Unknown League"]);
  });

  it("ignores class names, symbols, numbers and the allowed abbreviations", () => {
    const source = `
      export const B = () => (
        <p className="text-muted-foreground uppercase">
          {n}% · {m}/{k} LP OVR BO3 Bo5
        </p>
      );`;

    expect(findHardcodedText(source)).toEqual([]);
  });

  it("finds no user-facing literal in the native v2 code", () => {
    const offenders: string[] = [];
    for (const file of walk(SCAN_ROOT)) {
      const rel = relative(SRC_ROOT, file).split("\\").join("/");
      if (EXCLUDED_DIRS.some((dir) => rel.includes(dir))) continue;
      for (const text of findHardcodedText(readFileSync(file, "utf8"), file)) offenders.push(`${rel}: ${text}`);
    }

    expect(offenders).toEqual([]);
  });
});
