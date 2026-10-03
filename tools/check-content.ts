const allowedCategories = new Set([
  "Linux 与 BSD",
  "开发工具",
  "Windows",
  "网站与博客",
  "随笔与摘录",
]);

const allowedTags = new Set([
  "Linux",
  "Gentoo",
  "Windows",
  "开发工具",
  "系统维护",
  "Python",
  "博客",
  "随笔",
]);

const privacyPatterns: ReadonlyArray<[RegExp, string]> = [
  [/回国|回到国内|出国后|旅居|现居(?:住)?(?:于|在)/u, "可能泄露居住或行程信息的措辞"],
  [/-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/u, "私钥内容"],
  [/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/u, "GitHub 凭据"],
  [/(?:sk-[A-Za-z0-9]{20,})/u, "疑似 API 密钥"],
  [/(?:\/home\/lty\/|C:\\Users\\lty\\)/u, "本机用户目录"],
  [/\bkl\b/u, "旧配置中的本机用户名"],
  [/(?:GeForce\s+RTX\s+\d{4}[^\n]*GPU)/iu, "过于具体的显卡型号"],
];

const problems: string[] = [];
const postGlob = new Bun.Glob("source/_posts/**/*.md");
let postCount = 0;

function scalar(frontMatter: string, key: string): string | undefined {
  const match = frontMatter.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, "mu"));
  return match?.[1]?.replace(/^['"]|['"]$/g, "");
}

function list(frontMatter: string, key: string): string[] {
  const lines = frontMatter.split("\n");
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start < 0) return [];

  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*-\s+(.+?)\s*$/u);
    if (!match) break;
    values.push(match[1]!.replace(/^['"]|['"]$/g, ""));
  }
  return values;
}

for await (const path of postGlob.scan({ cwd: process.cwd(), onlyFiles: true })) {
  postCount += 1;
  const contents = await Bun.file(path).text();
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u);

  if (!match) {
    problems.push(`${path}: 缺少有效的 YAML front matter`);
    continue;
  }

  const frontMatter = match[1]!;
  const title = scalar(frontMatter, "title");
  const category = scalar(frontMatter, "categories");
  const tags = list(frontMatter, "tags");

  if (!title) problems.push(`${path}: 缺少 title`);
  if (!scalar(frontMatter, "date")) problems.push(`${path}: 缺少 date`);
  if (scalar(frontMatter, "donate") !== "false") {
    problems.push(`${path}: donate 必须显式设为 false`);
  }
  if (!category || !allowedCategories.has(category)) {
    problems.push(`${path}: 分类不在约定集合中：${category ?? "<missing>"}`);
  }
  if (tags.length === 0 || tags.length > 2) {
    problems.push(`${path}: 标签数量必须为 1–2 个，当前为 ${tags.length}`);
  }
  for (const tag of tags) {
    if (!allowedTags.has(tag)) problems.push(`${path}: 标签不在约定集合中：${tag}`);
  }

  for (const [pattern, description] of privacyPatterns) {
    if (pattern.test(contents)) problems.push(`${path}: 检测到${description}`);
  }
}

const themeConfig = await Bun.file("_config.kratos-rebirth.yml").text();
if (!/^donate:\r?\n\s+enable:\s+false\s*$/mu.test(themeConfig)) {
  problems.push("_config.kratos-rebirth.yml: donate.enable 必须保持为 false");
}
if (/https:\/\/(?:unpkg|cdn\.jsdelivr)\.com\/@waline\/client/iu.test(themeConfig)) {
  problems.push("_config.kratos-rebirth.yml: Waline 应使用锁定版本的本地构建资源");
}

for (const staleLock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) {
  if (await Bun.file(staleLock).exists()) problems.push(`${staleLock}: 不应与 bun.lock 并存`);
}

if (problems.length > 0) {
  console.error(`内容检查失败（${problems.length} 项）：`);
  for (const problem of problems) console.error(`- ${problem}`);
  process.exit(1);
}

console.log(`内容检查通过：${postCount} 篇文章，分类、标签、捐赠开关与基础隐私规则均符合约定。`);
