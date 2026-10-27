import { describe, expect, test } from "bun:test";

import {
  bundledRuntimeArtifacts,
  katexFontExtensions,
  katexFontFamilies,
  runtimeArtifacts,
  twikooLocaleNames,
  vendoredRuntimeArtifacts,
} from "../tools/runtime-artifacts.ts";

describe("runtime artifact manifest", () => {
  test("declares unique first-party build outputs and their module boundaries", () => {
    expect(
      bundledRuntimeArtifacts.map(({ source, output, target, format }) => ({
        source,
        output,
        target,
        format,
      })),
    ).toEqual([
      {
        source: "frontend/comments.ts",
        output: "source/comments/comments.js",
        target: "browser",
        format: "esm",
      },
      {
        source: "frontend/twikoo.ts",
        output: "source/comments/twikoo.js",
        target: "browser",
        format: "esm",
      },
      {
        source: "frontend/comments.css",
        output: "source/comments/comments.css",
        target: "browser",
        format: "css",
      },
      {
        source: "frontend/katex-overrides.css",
        output: "source/katex/katex-overrides.css",
        target: "browser",
        format: "css",
      },
      {
        source: "plugins/date-from-git.ts",
        output: "scripts/date-from-git.js",
        target: "node",
        format: "cjs",
      },
      {
        source: "plugins/marked-katex.ts",
        output: "scripts/marked-katex.js",
        target: "node",
        format: "cjs",
      },
    ]);
  });

  test("tracks the Twikoo client, every locale and the required license", () => {
    expect(twikooLocaleNames).toHaveLength(7);
    expect(
      vendoredRuntimeArtifacts.filter((artifact) =>
        artifact.output.startsWith("source/comments/twikoo/")),
    ).toHaveLength(9);
    expect(
      vendoredRuntimeArtifacts.filter((artifact) => artifact.format === "license"),
    ).toHaveLength(2);
    expect(
      vendoredRuntimeArtifacts
        .filter((artifact) => artifact.output.startsWith("source/comments/twikoo/"))
        .every(
        (artifact) => artifact.licenseOutput === "source/comments/twikoo/LICENSE",
      ),
    ).toBe(true);
  });

  test("tracks every font referenced by the vendored KaTeX stylesheet", async () => {
    const css = await Bun.file("node_modules/katex/dist/katex.min.css").text();
    const referencedFonts = [...css.matchAll(/url\(fonts\/([^)]+)\)/gu)]
      .map((match) => match[1])
      .filter((font): font is string => font !== undefined);
    const declaredFonts = vendoredRuntimeArtifacts
      .filter((artifact) => artifact.format === "font")
      .map((artifact) => artifact.output.slice("source/katex/fonts/".length));

    expect(katexFontFamilies).toHaveLength(20);
    expect(katexFontExtensions).toEqual(["ttf", "woff", "woff2"]);
    expect(new Set(declaredFonts)).toEqual(new Set(referencedFonts));
    expect(
      vendoredRuntimeArtifacts
        .filter((artifact) => artifact.output.startsWith("source/katex/"))
        .every((artifact) => artifact.licenseOutput === "source/katex/LICENSE"),
    ).toBeTrue();
  });

  test("has no duplicate or retired Waline outputs", () => {
    const outputs = runtimeArtifacts.map((artifact) => artifact.output);
    expect(new Set(outputs).size).toBe(outputs.length);
    expect(outputs.some((output) => /waline/iu.test(output))).toBe(false);
  });

  test("keeps every required generated output under Git tracking", () => {
    const result = Bun.spawnSync(
      ["git", "ls-files", "--error-unmatch", "--", ...runtimeArtifacts.map(({ output }) => output)],
      { stderr: "pipe", stdout: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    expect(bundledRuntimeArtifacts.every(({ licenseOutput }) => licenseOutput === null)).toBe(
      true,
    );
  });
});
