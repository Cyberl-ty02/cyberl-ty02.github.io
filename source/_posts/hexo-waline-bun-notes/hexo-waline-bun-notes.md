---
title: Hexo 博客迁移 Waline 与 Bun 的踩坑记录
comments: true
toc: true
donate: true
share: true
date: 2026-06-23 12:00:00
categories: 实用技巧
tags:
- 技巧
- hexo
---
这次调整博客时，我同时更换了评论系统和前端包管理器：评论从 Gitalk 迁移到 Waline，构建工具则从 pnpm 统一到了 Bun。两件事看似互不相关，实际都牵涉到旧配置清理、数据迁移、浏览器缓存和 GitHub Actions，过程中遇到了不少容易重复踩到的小坑。

本文记录当时的现象、原因和最终处理方式，方便以后重新部署时回查。

## 从 Gitalk 迁移到 Waline

Gitalk 把评论保存在 GitHub Issues 中，优点是几乎不需要维护额外服务，但访客必须登录 GitHub 才能评论。对于希望允许匿名访客留言的博客，这个门槛还是偏高。

我最后选择了 Waline，并在 Zeabur 中部署 Waline 服务和 MongoDB。博客前端只需要连接公开的服务地址：

```javascript
const serverURL = 'https://评论服务.example.com/';
```

GitHub Issues 中的旧评论则通过脚本读取，再逐条写入 Waline。

### 导入评论时提示 Comment too fast

第一次批量导入时，第一条评论成功，第二条立即失败：

```text
Comment too fast!
```

这不是评论内容损坏，而是 Waline 的防刷限制生效了。人工评论之间通常会自然间隔一段时间，迁移脚本却会在几毫秒内连续提交，所以很容易触发频率限制。

处理时应在每次成功导入后主动等待，并对限流错误进行有限次数重试。例如：

```powershell
$maxRetries = 5

for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
    $response = Invoke-RestMethod `
        -Method Post `
        -Uri "$ServerUrl/api/comment" `
        -ContentType 'application/json; charset=utf-8' `
        -Body $body

    if (-not $response.errmsg) {
        Start-Sleep -Seconds 10
        break
    }

    if ($response.errmsg -ne 'Comment too fast!') {
        throw $response.errmsg
    }

    Start-Sleep -Seconds (10 * $attempt)
}
```

等待时间不必拘泥于某个固定值；如果服务端仍然限流，就继续增加间隔。迁移脚本还应记录已经成功导入的 GitHub 评论 ID，重新执行时跳过它们，否则第一次成功的评论可能被重复导入。

更稳妥的迁移顺序是：

```text
先导出 GitHub Issues 和评论
检查文章路径与评论的对应关系
用一两条评论试运行
确认中文、Markdown、时间和作者信息正常
开启延迟后执行完整导入
核对数量，再决定是否归档旧 Issues
```

旧 Issues 不必立刻删除。先保留一段时间作为只读备份，确认 Waline 中的评论完整、文章路径正确后，再选择关闭或归档。直接删除会失去最方便的原始数据来源，也不利于排查迁移遗漏。

### 中文评论导入后变成问号

迁移完成后，评论区可以显示，但部分中文内容变成了连续的 `???`。Waline 后台能正常浏览消息，说明前端组件本身已经工作，问题更可能发生在“读取导出文件 → PowerShell 组装请求 → 写入数据库”这一段。

迁移文件和请求体应始终明确使用 UTF-8：

```powershell
$items = Get-Content `
    -LiteralPath '.\gitalk-comments.json' `
    -Raw `
    -Encoding utf8 | ConvertFrom-Json

$body = $payload | ConvertTo-Json -Depth 10 -Compress
$bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
    -Method Post `
    -Uri "$ServerUrl/api/comment" `
    -ContentType 'application/json; charset=utf-8' `
    -Body $bodyBytes
```

需要注意，数据库里一旦已经写入 `???`，修改网页编码并不能恢复原文，因为原始字符在导入时就已经丢失。正确做法是删除这批错误导入的数据，从 GitHub Issues 或原始 JSON 重新读取，再用 UTF-8 导入。

### 评论区只显示一个白色窄框

更换评论系统后，Edge 中一度只显示一个白色窄框，而 Firefox 隐私窗口可以正常显示完整评论框。这类现象通常说明 HTML 容器已经生成，但 Waline 的样式或模块脚本没有正确加载，或者浏览器仍在使用旧缓存。

当前主题使用独立容器挂载 Waline：

```html
<div id="w-comments" class="kr-comments lazy-load" data-path="$PATH"></div>
```

同时注入 Waline 的样式和模块脚本：

```html
<link rel="stylesheet" href="https://unpkg.com/@waline/client@v3/dist/waline.css">
<link rel="stylesheet" href="/comments/waline.css?v=20260604-1">
<script defer type="module" src="/comments/waline.js?v=20260604-1"></script>
```

这里有三个关键点：

```text
Waline v3 前端脚本以 ES module 方式加载
主题的 lazy-load 和 PJAX 切页后都要重新初始化评论
修改本地 JS/CSS 后给 URL 增加版本参数，避免旧缓存继续生效
```

PJAX 切换文章时，旧实例也要先销毁：

```javascript
let waline;

const loadComments = async () => {
  waline?.destroy();

  const container = document.getElementById('w-comments');
  if (!container) return;

  waline = init({
    el: container,
    path: container.getAttribute('data-path'),
    serverURL,
  });
};

window.addEventListener('pjax:success', () => {
  window.loadComments = loadComments;
});
```

排查白框时，隐私窗口非常有价值：如果隐私窗口正常，普通窗口异常，应优先清理站点缓存、检查扩展拦截，并在开发者工具的 Network 和 Console 中确认 Waline 的 CSS、JS 与 API 请求是否成功，而不是急着修改数据库。

### 配置 Cloudflare Turnstile

为了降低匿名评论带来的垃圾信息，可以在 Cloudflare Turnstile 中为博客域名创建站点，再分别配置站点密钥和服务端密钥。

站点密钥会发送给浏览器，可以写在前端初始化参数中：

```javascript
waline = init({
  el: '#w-comments',
  serverURL,
  turnstileKey: '你的 Turnstile Site Key',
});
```

服务端密钥只能配置在 Waline 服务的环境变量中，不能提交到博客仓库，也不能放进前端 JavaScript：

```text
TURNSTILE_SECRET=你的 Turnstile Secret Key
```

如果服务端密钥曾出现在公开仓库、构建日志或其他无法控制访问范围的位置，应在 Cloudflare 后台轮换，而不是仅仅删除当前文件。Git 历史和缓存中仍可能保留旧值。

## 从 pnpm 切换到 Bun

评论系统稳定后，另一个问题来自 GitHub Actions。仓库已经通过 `packageManager` 声明使用 Bun：

```json
{
  "packageManager": "bun@1.3.14"
}
```

但旧工作流仍然执行：

```bash
pnpm install
```

于是 CI 直接失败：

```text
ERROR This project is configured to use bun
For help, run: pnpm help install
Error: Process completed with exit code 1.
```

这个错误不是依赖安装失败，而是仓库声明和 CI 使用了不同的包管理器。既然已经决定统一使用 Bun，就应同时调整锁文件、工作流和 Dependabot，而不是只生成一个 `bun.lock`。

### GitHub Actions 统一使用 Bun

最终工作流的核心步骤为：

```yaml
- name: Setup Bun
  uses: oven-sh/setup-bun@v2
  with:
    bun-version-file: package.json

- name: Install Hexo environment
  run: bun install --frozen-lockfile

- name: Clean Hexo cache
  run: bun run clean

- name: Hexo build site
  run: bun run build
```

其中：

```text
bun-version-file 让本地与 CI 使用 package.json 中声明的 Bun 版本
--frozen-lockfile 保证 CI 不会擅自改写 bun.lock
bun run clean 先清除 Hexo 缓存和旧的 public 目录
bun run build 使用 package.json 中已有的构建脚本
```

Dependabot 也应切换到 Bun：

```yaml
version: 2
updates:
  - package-ecosystem: bun
    directory: /
    schedule:
      interval: daily
```

### bun.lock 与 package.json 各自做什么

有了 `bun.lock` 以后，`package.json` 仍然不能删除。两者职责不同：

```text
package.json：声明项目、脚本、直接依赖和包管理器版本
bun.lock：锁定完整依赖树的实际版本，保证安装结果可复现
```

如果删掉 `package.json`，Bun 不知道要执行哪些脚本，也失去了直接依赖和项目元数据。所谓“纯 Bun 环境”应该理解为只保留 Bun 的锁文件和命令，而不是只留下一个 `bun.lock`。

完成迁移后，可以删除其他包管理器留下的文件：

```text
pnpm-lock.yaml
pnpm-workspace.yaml（项目确实不再使用 workspace 时）
package-lock.json
yarn.lock
```

但不要提交本地生成目录：

```text
node_modules/
public/
db.json
```

它们应由安装或 Hexo 构建过程重新生成，并写进 `.gitignore`。

### 本地与 CI 使用同一组验证命令

提交前，我现在会执行：

```bash
bun install --frozen-lockfile
bun run clean
bun run build
```

这组命令和 GitHub Actions 保持一致。若本地成功而 CI 失败，再检查 Bun 版本、环境变量和 Linux/Windows 差异；若两边使用的命令本身不同，排错会多出一层没有必要的变量。

## 清理旧系统残余

迁移完成不只是让新系统能运行，还要确认旧系统不会继续被加载。最终需要检查：

```text
主题配置中不再注入 Gitalk 的 CSS 和 JS
页面中不再生成 gitalk-container
仓库中不再保留 Gitalk OAuth 配置
CI 中不再安装 pnpm
仓库中只保留 bun.lock，不混用多个锁文件
README 和首页介绍与当前技术栈一致
```

可以用下面的命令快速搜索：

```bash
rg -n -i "gitalk|pnpm|package-lock|yarn.lock" .
```

搜索结果不一定都要删除，例如旧文章可能会提到迁移背景；但任何仍会被网页或 CI 实际执行的旧配置，都应继续清理。

## 小结

这次迁移留下的主要经验可以概括为：

```text
数据迁移要考虑限流、编码、幂等和回滚
评论框异常先区分前端资源、浏览器缓存和后端数据
Turnstile 站点密钥可以公开，服务端密钥必须留在服务端
切换包管理器要同时修改声明、锁文件、CI 和 Dependabot
package.json 与 bun.lock 互相配合，不能只留其中一个
```

Waline 和 Bun 本身并不难用，真正容易出问题的是迁移过程中同时存在两套配置。每次只改变一个环节，并让本地构建命令与 CI 完全一致，排错会轻松很多。
