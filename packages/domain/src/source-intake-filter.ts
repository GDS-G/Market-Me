import type { SmartSource } from "./index";

export type SourceIntakeFilter = Pick<SmartSource, "allowedMimeTypes" | "ignorePatterns">;
export interface SourceIntakeEntry { name: string; mimeType: string; isFolder: boolean }
export type SourceIntakeExclusion = "mime_type" | "ignored_path";
export interface SourceIntakeDecision {
  /** Folders remain eligible for traversal; this never means they create packages. */
  eligible: boolean;
  kind: "folder" | "file";
  exclusions: readonly SourceIntakeExclusion[];
}

function mimeMatches(allowed: readonly string[], mimeType: string): boolean {
  return allowed.length === 0 || allowed.some((pattern) => pattern === mimeType
    || pattern.endsWith("/*") && mimeType.startsWith(pattern.slice(0, -1)));
}

function globExpression(pattern: string): RegExp {
  // Preserve the existing remote-ingestion matcher. Changing pattern semantics is
  // a separate source-configuration change, not a side effect of adding a preview.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesGlob(pattern: string, value: string): boolean {
  // Historical '?' expressions keep their existing regex semantics. The dry-test
  // boundary rejects those legacy expressions. Ordinary * / ** patterns use a
  // non-backtracking matcher so filenames cannot cause exponential regex work.
  if (pattern.includes("?") || pattern.includes("\u0000")) return globExpression(pattern).test(value);
  const tokens: ("star" | "globstar" | RegExp)[] = [];
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!;
    if (char === "*") {
      if (pattern[index + 1] === "*") { tokens.push("globstar"); index++; }
      else tokens.push("star");
    } else tokens.push(new RegExp(`^${char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"));
  }
  let previous = new Uint8Array(value.length + 1); previous[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(value.length + 1);
    if (typeof token === "string") next[0] = previous[0]!;
    for (let index = 1; index <= value.length; index++) {
      const char = value[index - 1]!;
      next[index] = typeof token === "string"
        ? Number(Boolean(previous[index] || next[index - 1] && (token === "star" ? char !== "/" : !/[\n\r\u2028\u2029]/.test(char))))
        : Number(Boolean(previous[index - 1] && token.test(char)));
    }
    previous = next;
  }
  return Boolean(previous[value.length]);
}

export function classifySourceIntake(source: SourceIntakeFilter, entry: SourceIntakeEntry, displayPath: string): SourceIntakeDecision {
  if (entry.isFolder) return { eligible: true, kind: "folder", exclusions: [] };
  // The first failing gate is the explanation. Retain ingestion's short-circuit:
  // an excluded MIME type never evaluates a historical path expression.
  if (!mimeMatches(source.allowedMimeTypes, entry.mimeType)) return { eligible: false, kind: "file", exclusions: ["mime_type"] };
  const exclusions: SourceIntakeExclusion[] = [];
  const path = displayPath.replaceAll("\\", "/");
  if (source.ignorePatterns.some((pattern) => {
    const normalized = pattern.replaceAll("\\", "/");
    return matchesGlob(normalized, path) || matchesGlob(normalized, entry.name) || matchesGlob(normalized, `/${path.replace(/^\//, "")}`);
  })) exclusions.push("ignored_path");
  return { eligible: exclusions.length === 0, kind: "file", exclusions };
}
