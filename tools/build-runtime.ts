import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { resolveCommentBuildSelection } from "./comment-provider-build.ts";

interface BuildTarget {
  entrypoint: string;
  outdir: string;
  target: "browser" | "node";
  format: "esm" | "cjs";
  minify: boolean;
  external?: string[];
  define?: Record<string, string>;
  banner?: string;
}

const commentBuild = resolveCommentBuildSelection(process.argv.slice(2));

const targets: BuildTarget[] = [
  {
    entrypoint: "frontend/comments.ts",
    outdir: "source/comments",
    target: "browser",
    format: "esm",
    minify: true,
    define: commentBuild.define,
    banner: `/* comments-provider:${commentBuild.effectiveProvider} */`,
  },
  {
    entrypoint: "frontend/twikoo.ts",
    outdir: "source/comments",
    target: "browser",
    format: "esm",
    minify: true,
  },
  {
    entrypoint: "frontend/comments.css",
    outdir: "source/comments",
    target: "browser",
    format: "esm",
    minify: true,
  },
  {
    entrypoint: "plugins/date-from-git.ts",
    outdir: "scripts",
    target: "node",
    format: "cjs",
    minify: false,
    external: ["hexo-front-matter", "isomorphic-git", "moment"],
  },
];

for (const target of targets) {
  const result = await Bun.build({
    entrypoints: [target.entrypoint],
    outdir: target.outdir,
    target: target.target,
    format: target.format,
    minify: target.minify,
    external: target.external,
    define: target.define,
    banner: target.banner,
    naming: "[name].[ext]",
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`无法构建 ${target.entrypoint}`);
  }

  console.log(
    `${target.entrypoint} -> ${result.outputs.map((output) => output.path).join(", ")}`,
  );
}

const twikooSource = "node_modules/twikoo/dist";
const twikooOutput = "source/comments/twikoo";
await mkdir(join(twikooOutput, "locales"), { recursive: true });
await Bun.write(join(twikooOutput, "twikoo.min.js"), Bun.file(join(twikooSource, "twikoo.min.js")));
await Bun.write(join(twikooOutput, "LICENSE"), Bun.file("node_modules/twikoo/LICENSE"));

const localeGlob = new Bun.Glob("*.js");
for await (const locale of localeGlob.scan({
  cwd: join(twikooSource, "locales"),
  onlyFiles: true,
})) {
  await Bun.write(
    join(twikooOutput, "locales", basename(locale)),
    Bun.file(join(twikooSource, "locales", locale)),
  );
}

console.log(`${twikooSource} -> ${twikooOutput}`);
console.log(
  `comments provider -> ${commentBuild.effectiveProvider}` +
    (commentBuild.override ? " (explicit preview override)" : " (config default)"),
);
if (commentBuild.endpointOverride) {
  console.log("comments endpoint -> isolated loopback http://127.0.0.1:8081");
}
