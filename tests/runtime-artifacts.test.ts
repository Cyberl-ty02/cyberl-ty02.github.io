import { describe, expect, test } from "bun:test";

import {
  bundledRuntimeArtifacts,
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
        source: "plugins/date-from-git.ts",
        output: "scripts/date-from-git.js",
        target: "node",
        format: "cjs",
      },
    ]);
  });

  test("tracks the Twikoo client, every locale and the required license", () => {
    expect(twikooLocaleNames).toHaveLength(7);
    expect(vendoredRuntimeArtifacts).toHaveLength(9);
    expect(
      vendoredRuntimeArtifacts.filter((artifact) => artifact.format === "license"),
    ).toHaveLength(1);
    expect(
      vendoredRuntimeArtifacts.every(
        (artifact) => artifact.licenseOutput === "source/comments/twikoo/LICENSE",
      ),
    ).toBe(true);
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
