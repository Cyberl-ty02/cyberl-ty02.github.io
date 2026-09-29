interface BuildTarget {
  entrypoint: string;
  outdir: string;
  target: "browser" | "node";
  format: "esm" | "cjs";
  minify: boolean;
  external?: string[];
}

const targets: BuildTarget[] = [
  {
    entrypoint: "frontend/waline.ts",
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
