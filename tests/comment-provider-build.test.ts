import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_COMMENT_PROVIDER } from "../frontend/comments/config.ts";
import type { CommentProviderName } from "../frontend/comments/types.ts";
import { resolveCommentBuildSelection } from "../tools/comment-provider-build.ts";

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function buildAndReadProvider(
  override?: CommentProviderName,
  endpointOverride?: string,
): Promise<{ provider: CommentProviderName; endpoint: string | null; source: string }> {
  const args = [
    ...(override ? [`--comments=${override}`] : []),
    ...(endpointOverride ? [`--twikoo-endpoint=${endpointOverride}`] : []),
  ];
  const selection = resolveCommentBuildSelection(args);
  const outdir = await mkdtemp(join(tmpdir(), "cyberl-comments-provider-"));
  temporaryDirectories.push(outdir);

  const result = await Bun.build({
    entrypoints: ["frontend/comments.ts"],
    outdir,
    target: "browser",
    format: "esm",
    minify: true,
    define: selection.define,
    banner: `/* comments-provider:${selection.effectiveProvider} */`,
    naming: "[name].[ext]",
  });
  expect(result.success).toBeTrue();

  const output = result.outputs[0];
  if (!output) throw new Error("评论调度器没有生成输出文件");
  const source = await output.text();
  const moduleUrl = `${pathToFileURL(output.path).href}?case=${override ?? "default"}-${Date.now()}`;
  const generated = await import(moduleUrl) as {
    ACTIVE_COMMENT_PROVIDER: CommentProviderName;
    ACTIVE_TWIKOO_ENDPOINT: string | null;
  };
  return {
    provider: generated.ACTIVE_COMMENT_PROVIDER,
    endpoint: generated.ACTIVE_TWIKOO_ENDPOINT,
    source,
  };
}

describe("generated comment provider", () => {
  test("ordinary build reads DEFAULT_COMMENT_PROVIDER without a preview define", async () => {
    const selection = resolveCommentBuildSelection([]);
    expect(selection.override).toBeNull();
    expect(selection.define).toBeUndefined();
    expect(selection.effectiveProvider).toBe(DEFAULT_COMMENT_PROVIDER);

    const generated = await buildAndReadProvider();
    expect(generated.provider).toBe(DEFAULT_COMMENT_PROVIDER);
    expect(generated.source).toContain(`comments-provider:${DEFAULT_COMMENT_PROVIDER}`);
  });

  for (const provider of ["twikoo", "disabled"] as const) {
    test(`explicit ${provider} build exports the selected provider`, async () => {
      const generated = await buildAndReadProvider(provider);
      expect(generated.provider).toBe(provider);
      expect(generated.source).toContain(`comments-provider:${provider}`);
    });
  }

  test("an explicit disabled preview does not change the following ordinary build", async () => {
    expect((await buildAndReadProvider("disabled")).provider).toBe("disabled");
    expect((await buildAndReadProvider()).provider).toBe(DEFAULT_COMMENT_PROVIDER);
  });

  test("isolated preview embeds only the approved loopback endpoint", async () => {
    const isolated = await buildAndReadProvider("twikoo", "http://127.0.0.1:8081");
    expect(isolated.provider).toBe("twikoo");
    expect(isolated.endpoint).toBe("http://127.0.0.1:8081");
    expect(isolated.source).not.toContain("cybltwicom.netlify.app");

    const ordinary = await buildAndReadProvider();
    expect(ordinary.provider).toBe(DEFAULT_COMMENT_PROVIDER);
    expect(ordinary.endpoint).toBe("https://cybltwicom.netlify.app/.netlify/functions/twikoo");
  });

  test("rejects unsafe or mismatched endpoint preview arguments", () => {
    expect(() => resolveCommentBuildSelection([
      "--comments=twikoo",
      "--twikoo-endpoint=https://cybltwicom.netlify.app/.netlify/functions/twikoo",
    ])).toThrow("http://127.0.0.1:8081");
    expect(() => resolveCommentBuildSelection([
      "--comments=disabled",
      "--twikoo-endpoint=http://127.0.0.1:8081",
    ])).toThrow("twikoo provider");
    expect(() => resolveCommentBuildSelection([
      "--comments=twikoo",
      "--twikoo-endpoint=http://127.0.0.1:8081",
      "--twikoo-endpoint=http://127.0.0.1:8081",
    ])).toThrow("--twikoo-endpoint");
  });

  test("rejects duplicate or unknown preview arguments", () => {
    expect(() => resolveCommentBuildSelection(["--comments=legacy-waline"]))
      .toThrow("legacy-waline 已退役");
    expect(() => resolveCommentBuildSelection(["--comments=unknown"]))
      .toThrow("不支持的评论预览提供者");
    expect(() => resolveCommentBuildSelection([
      "--comments=twikoo",
      "--comments=disabled",
    ])).toThrow("只能指定一个");
  });

  test("generated production and disabled bundles contain no retired Waline chain", async () => {
    for (const provider of [undefined, "disabled"] as const) {
      const generated = await buildAndReadProvider(provider);
      expect(generated.source).not.toContain("legacy-waline");
      expect(generated.source).not.toContain("cyblwalcom.zeabur.app");
      expect(generated.source).not.toContain("/comments/waline.js");
    }
  });
});
