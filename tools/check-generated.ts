const problems: string[] = [];
const homePath = "public/index.html";
const home = Bun.file(homePath);

if (!(await home.exists())) {
  problems.push(`${homePath}: 尚未生成站点，请先运行 bun run build:site`);
} else {
  const html = await home.text();
  if (!html.includes('href="https://github.com/Cyberl-ty02"')) {
    problems.push(`${homePath}: 页脚 GitHub 链接没有指向博客维护者主页`);
  }
  if (html.includes('id="kr-donate-modal"') || html.includes("krOpenDonateModal()")) {
    problems.push(`${homePath}: 生成首页仍包含捐赠入口或弹窗`);
  }
}

const articleGlob = new Bun.Glob("public/posts/**/*.html");
let articleCount = 0;
for await (const path of articleGlob.scan({ cwd: process.cwd(), onlyFiles: true })) {
  articleCount += 1;
  const html = await Bun.file(path).text();
  if (html.includes('id="kr-donate-modal"') || html.includes("krOpenDonateModal()")) {
    problems.push(`${path}: 生成页面仍包含捐赠入口或弹窗`);
  }
}

const runtimeAssets = [
  "public/comments/waline.js",
  "public/comments/waline.css",
  "public/comments/waline-overrides.css",
] as const;

for (const path of runtimeAssets) {
  if (!(await Bun.file(path).exists())) problems.push(`${path}: 缺少本地 Waline 构建资源`);
}

if (await home.exists()) {
  const html = await home.text();
  if (/https:\/\/(?:unpkg|cdn\.jsdelivr)\.com\/@waline\/client/iu.test(html)) {
    problems.push(`${homePath}: 仍从第三方 CDN 加载 Waline 客户端`);
  }
  for (const asset of [
    "/comments/waline.js?v=20260929-1",
    "/comments/waline.css?v=20260604-1",
    "/comments/waline-overrides.css?v=20260929-1",
  ]) {
    if (!html.includes(asset)) problems.push(`${homePath}: 未引用本地资源 ${asset}`);
  }
}

const expectedRenderedText: ReadonlyArray<[string, string]> = [
  [
    "public/posts/gentoo-endeavouros-btrfs-openrc-install/gentoo-endeavouros-btrfs-openrc-install/index.html",
    "7.2.6-x64v3",
  ],
  [
    "public/posts/hexo-waline-bun-notes/hexo-waline-bun-notes/index.html",
    "TypeScript 检查层",
  ],
];

for (const [path, expected] of expectedRenderedText) {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    problems.push(`${path}: 缺少预期文章页面`);
    continue;
  }
  if (!(await file.text()).includes(expected)) {
    problems.push(`${path}: 没有渲染预期文本：${expected}`);
  }
}

if (problems.length > 0) {
  console.error(`生成结果检查失败（${problems.length} 项）：`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`生成结果检查通过：已检查首页及 ${articleCount} 篇文章页面。`);
