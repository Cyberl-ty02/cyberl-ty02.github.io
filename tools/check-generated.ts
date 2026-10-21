import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DEFAULT_COMMENT_PROVIDER } from "../frontend/comments/config.ts";
import {
  bundledRuntimeArtifacts,
  runtimeArtifacts,
  twikooLocaleNames,
  vendoredRuntimeArtifacts,
} from "./runtime-artifacts.ts";

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

function publicOutput(output: string): string | null {
  return output.startsWith("source/") ? `public/${output.slice("source/".length)}` : null;
}

for (const artifact of runtimeArtifacts) {
  const outputExists = await Bun.file(artifact.output).exists();
  if (!outputExists) {
    problems.push(`${artifact.output}: 缺少声明的生成物或第三方资源`);
  }
  const published = publicOutput(artifact.output);
  if (published && !(await Bun.file(published).exists())) {
    problems.push(`${published}: 生成站点缺少声明的运行资源`);
  } else if (published && outputExists) {
    const sourceBytes = Buffer.from(await Bun.file(artifact.output).arrayBuffer());
    const publishedBytes = Buffer.from(await Bun.file(published).arrayBuffer());
    if (!sourceBytes.equals(publishedBytes)) {
      problems.push(`${published}: 与受跟踪的生成物 ${artifact.output} 不一致`);
    }
  }
}

for (const artifact of bundledRuntimeArtifacts) {
  const file = Bun.file(artifact.output);
  if (!(await file.exists()) || artifact.format === "css") continue;
  const contents = await file.text();
  if (artifact.format === "esm" && !/\bexport\s*(?:\{|[A-Za-z_$])/u.test(contents)) {
    problems.push(`${artifact.output}: 预期为浏览器 ESM 生成物`);
  }
  if (artifact.format === "cjs" && !contents.includes("module.exports")) {
    problems.push(`${artifact.output}: 预期为 Hexo CommonJS 生成物`);
  }
}

for (const artifact of vendoredRuntimeArtifacts) {
  const source = Bun.file(artifact.source);
  const output = Bun.file(artifact.output);
  if (!(await source.exists()) || !(await output.exists())) continue;
  if (!Buffer.from(await source.arrayBuffer()).equals(Buffer.from(await output.arrayBuffer()))) {
    problems.push(`${artifact.output}: 第三方资源与 ${artifact.source} 不一致`);
  }
  if (!(await Bun.file(artifact.licenseOutput).exists())) {
    problems.push(`${artifact.output}: 缺少必要的第三方许可证`);
  }
}

const generatedLocales = new Set<string>();
for await (const locale of new Bun.Glob("*.js").scan({
  cwd: "source/comments/twikoo/locales",
  onlyFiles: true,
})) {
  generatedLocales.add(locale);
}
for (const locale of twikooLocaleNames) {
  if (!generatedLocales.has(locale)) {
    problems.push(`source/comments/twikoo/locales/${locale}: 缺少声明的 Twikoo locale`);
  }
}
for (const locale of generatedLocales) {
  if (!(twikooLocaleNames as readonly string[]).includes(locale)) {
    problems.push(`source/comments/twikoo/locales/${locale}: 未在生成物清单中声明`);
  }
}

for (const path of [
  "public/comments/waline.js",
  "public/comments/waline.css",
  "public/comments/waline-overrides.css",
]) {
  if (await Bun.file(path).exists()) problems.push(`${path}: 已退役的 Waline 资源不应继续生成`);
}

if (await home.exists()) {
  const html = await home.text();
  if (/https:\/\/(?:unpkg|cdn\.jsdelivr)\.com\/twikoo/iu.test(html)) {
    problems.push(`${homePath}: 仍从第三方 CDN 加载 Twikoo 客户端`);
  }
  for (const asset of [
    "/comments/comments.js?v=20261020-2",
    "/comments/comments.css?v=20261020-2",
  ]) {
    if (!html.includes(asset)) problems.push(`${homePath}: 未引用本地资源 ${asset}`);
  }
  if (/waline(?:-overrides)?\.(?:css|js)|cyblwalcom\.zeabur\.app/iu.test(html)) {
    problems.push(`${homePath}: 正式页面不应引用已退役的 Waline 资源或 endpoint`);
  }
  if (html.includes("/comments/twikoo/twikoo.min.js")) {
    problems.push(`${homePath}: Twikoo 未启用时不应直接注入其客户端`);
  }
}

const defaultProviderConfig = await Bun.file("frontend/comments/config.ts").text();
if (!defaultProviderConfig.includes("https://cybltwicom.netlify.app/.netlify/functions/twikoo")) {
  problems.push("frontend/comments/config.ts: 缺少公开 Twikoo endpoint");
}

const dispatcherPath = "public/comments/comments.js";
if (await Bun.file(dispatcherPath).exists()) {
  const generatedDispatcher = await Bun.file(dispatcherPath).text();
  if (!generatedDispatcher.includes(`comments-provider:${DEFAULT_COMMENT_PROVIDER}`)) {
    problems.push(`${dispatcherPath}: 普通构建标记与 DEFAULT_COMMENT_PROVIDER 不一致`);
  }
  if (/legacy-waline|waline\.js|cyblwalcom\.zeabur\.app/iu.test(generatedDispatcher)) {
    problems.push(`${dispatcherPath}: 不应包含已退役的 Waline 运行链`);
  }
  if (!generatedDispatcher.includes("/comments/twikoo.js?v=20261020-2")) {
    problems.push(`${dispatcherPath}: 缺少与页面缓存版本一致的 Twikoo 动态入口`);
  }

  try {
    const moduleUrl = `${pathToFileURL(resolve(dispatcherPath)).href}?check=${Date.now()}`;
    const generated = await import(moduleUrl) as {
      ACTIVE_COMMENT_PROVIDER?: string;
    };
    if (generated.ACTIVE_COMMENT_PROVIDER !== DEFAULT_COMMENT_PROVIDER) {
      problems.push(
        `${dispatcherPath}: 最终 JS 实际提供者 ${generated.ACTIVE_COMMENT_PROVIDER ?? "<missing>"} ` +
        `与 DEFAULT_COMMENT_PROVIDER ${DEFAULT_COMMENT_PROVIDER} 不一致`,
      );
    }
  } catch (error) {
    problems.push(`${dispatcherPath}: 无法导入并验证最终 Provider（${String(error)}）`);
  }
}

const samplePostPath =
  "public/posts/doom-emacs-windows/doom-emacs-windows/index.html";
const samplePost = Bun.file(samplePostPath);
if (await samplePost.exists()) {
  const html = await samplePost.text();
  if (!html.includes('id="comments-root"') || !html.includes("data-comments-container")) {
    problems.push(`${samplePostPath}: 缺少提供者中性的评论容器`);
  }
  if (!html.includes('data-path="/posts/doom-emacs-windows/doom-emacs-windows/"')) {
    problems.push(`${samplePostPath}: 评论路径没有保留目录式 permalink 与尾斜杠`);
  }
  if (!html.includes("comment-count waline-comment-count")) {
    problems.push(`${samplePostPath}: 评论计数器缺少上游主题兼容类名`);
  }
}

const generatedGlob = new Bun.Glob("public/**/*.{html,js,json}");
for await (const path of generatedGlob.scan({ cwd: process.cwd(), onlyFiles: true })) {
  if (path.startsWith("public/comments/twikoo/")) continue;
  const contents = await Bun.file(path).text();
  if (/mongodb(?:\+srv)?:\/\//iu.test(contents)) {
    problems.push(`${path}: 生成结果包含 MongoDB 连接字符串`);
  }
  if (/cyblwalcom\.zeabur\.app|(?:src|href)=["'][^"']*\/comments\/waline(?:-overrides)?\.(?:css|js)/iu.test(contents)) {
    problems.push(`${path}: 生成结果包含已退役的 Waline endpoint 或可加载资源引用`);
  }
}

const expectedRenderedText: ReadonlyArray<[string, string]> = [
  [
    "public/posts/gentoo-endeavouros-btrfs-openrc-install/gentoo-endeavouros-btrfs-openrc-install/index.html",
    "7.2.10-x64v3",
  ],
  [
    "public/posts/gentoo-sonicde-openrc-migration/gentoo-sonicde-openrc-migration/index.html",
    "Sonic Login Manager",
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
