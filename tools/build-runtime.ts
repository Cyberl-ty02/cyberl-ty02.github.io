import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveCommentBuildSelection } from "./comment-provider-build.ts";
import {
  bundledRuntimeArtifacts,
  vendoredRuntimeArtifacts,
} from "./runtime-artifacts.ts";

const commentBuild = resolveCommentBuildSelection(process.argv.slice(2));

for (const artifact of bundledRuntimeArtifacts) {
  const isCommentDispatcher = artifact.source === "frontend/comments.ts";
  const result = await Bun.build({
    entrypoints: [artifact.source],
    outdir: dirname(artifact.output),
    target: artifact.target,
    format: artifact.bunFormat,
    minify: artifact.minify,
    external: "external" in artifact ? [...artifact.external] : undefined,
    define: isCommentDispatcher ? commentBuild.define : undefined,
    banner: isCommentDispatcher
      ? `/* comments-provider:${commentBuild.effectiveProvider} */`
      : undefined,
    naming: "[name].[ext]",
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`无法构建 ${artifact.source}`);
  }

  const outputs = result.outputs.map((output) => resolve(output.path));
  const expectedOutput = resolve(artifact.output);
  if (outputs.length !== 1 || outputs[0] !== expectedOutput) {
    throw new Error(
      `${artifact.source}: expected ${artifact.output}, generated ${outputs.join(", ")}`,
    );
  }

  console.log(`${artifact.source} -> ${artifact.output}`);
}

for (const artifact of vendoredRuntimeArtifacts) {
  const source = Bun.file(artifact.source);
  if (!(await source.exists())) throw new Error(`${artifact.source}: vendored source is missing`);
  await mkdir(dirname(artifact.output), { recursive: true });
  await Bun.write(artifact.output, source);
  console.log(`${artifact.source} -> ${artifact.output}`);
}

console.log(
  `comments provider -> ${commentBuild.effectiveProvider}` +
    (commentBuild.override ? " (explicit preview override)" : " (config default)"),
);
if (commentBuild.endpointOverride) {
  console.log("comments endpoint -> isolated loopback http://127.0.0.1:8081");
}
