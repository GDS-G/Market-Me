import { describe, expect, it } from "vitest";
import { classifySourceIntake } from "./source-intake-filter";

const source = { allowedMimeTypes: ["image/*", "application/pdf"], ignorePatterns: ["**/Drafts/**", "~$*"] };
const file = { name: "launch.jpg", mimeType: "image/jpeg", isFolder: false };

describe("shared source-intake filter explanations", () => {
  it("retains folders for traversal without describing them as files/packages", () => {
    expect(classifySourceIntake(source, { ...file, isFolder: true, mimeType: "application/folder" }, "/Drafts"))
      .toEqual({ eligible: true, kind: "folder", exclusions: [] });
  });
  it.each(["image/jpeg", "image/png", "application/pdf"])("includes %s through existing MIME rules", (mimeType) => {
    expect(classifySourceIntake(source, { ...file, mimeType }, "/Launches/launch.jpg"))
      .toEqual({ eligible: true, kind: "file", exclusions: [] });
  });
  it("explains MIME exclusion and preserves the empty-filter all-types policy", () => {
    expect(classifySourceIntake(source, { ...file, mimeType: "video/mp4" }, "/Launches/launch.mp4").exclusions).toEqual(["mime_type"]);
    expect(classifySourceIntake({ ...source, allowedMimeTypes: [] }, { ...file, mimeType: "video/mp4" }, "/Launches/launch.mp4").eligible).toBe(true);
  });
  it.each(["/Launches/Drafts/launch.jpg", "Launches/Drafts/launch.jpg", "Drafts/launch.jpg", "C:\\Launches\\drafts\\launch.jpg"])("explains ignored path %s", (path) => {
    expect(classifySourceIntake(source, file, path)).toEqual({ eligible: false, kind: "file", exclusions: ["ignored_path"] });
  });
  it("checks temporary-file names independently from full paths", () => {
    expect(classifySourceIntake(source, { ...file, name: "~$launch.jpg" }, "/Launches/~$launch.jpg").exclusions).toEqual(["ignored_path"]);
  });
  it("explains the first failing gate and preserves MIME short-circuiting", () => {
    expect(classifySourceIntake(source, { ...file, mimeType: "video/mp4" }, "/Drafts/launch.mp4"))
      .toEqual({ eligible: false, kind: "file", exclusions: ["mime_type"] });
    expect(classifySourceIntake({ ...source, ignorePatterns: ["?"] }, { ...file, mimeType: "video/mp4" }, "/Drafts/launch.mp4").eligible).toBe(false);
  });
  it("keeps single-star scope inside one directory and double-star recursion distinct", () => {
    const single = { allowedMimeTypes: [], ignorePatterns: ["/Drafts/*"] };
    expect(classifySourceIntake(single, file, "/Drafts/launch.jpg").eligible).toBe(false);
    expect(classifySourceIntake(single, file, "/Drafts/Nested/launch.jpg").eligible).toBe(true);
    expect(classifySourceIntake({ ...single, ignorePatterns: ["/Drafts/**"] }, file, "/Drafts/Nested/launch.jpg").eligible).toBe(false);
  });
  it("escapes regex punctuation in existing filename patterns", () => {
    const exact = { allowedMimeTypes: [], ignorePatterns: ["launch[1].jpg"] };
    expect(classifySourceIntake(exact, { ...file, name: "launch[1].jpg" }, "/Launches/launch[1].jpg").eligible).toBe(false);
    expect(classifySourceIntake(exact, { ...file, name: "launch1.jpg" }, "/Launches/launch1.jpg").eligible).toBe(true);
  });
  it("does not mutate the captured source configuration or entry", () => {
    const frozen = Object.freeze({ allowedMimeTypes: Object.freeze(["image/*"]), ignorePatterns: Object.freeze(["~$*"]) });
    expect(classifySourceIntake(frozen, Object.freeze(file), "/Launches/launch.jpg").eligible).toBe(true);
    expect(frozen.ignorePatterns).toEqual(["~$*"]);
  });
  it("matches the historical regex for ordinary globs across punctuation, case, separators and line terminators", () => {
    const words = ["", "a", "A", "b", "/", "ab", "a/b", "a\nb", "a\r\n", "a\n", "[a]", "K", "k", "ſ", "s", "😀", "a\u2028", "a\u2029"];
    const atoms = ["", "a", "A", "/", "*", "**", "***", "[a]", "K", "k", "ſ", "s", ".", "😀", "\n"];
    for (const left of atoms) for (const right of atoms) for (const value of words) {
      const pattern = `${left}${right}`;
      const matcher = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*")}$`, "i");
      const expected = matcher.test(value) || matcher.test(`/${value.replace(/^\//, "")}`);
      expect(classifySourceIntake({ allowedMimeTypes: [], ignorePatterns: [pattern] }, { ...file, name: value }, value).eligible,
        JSON.stringify({ pattern, value })).toBe(!expected);
    }
  });
});
