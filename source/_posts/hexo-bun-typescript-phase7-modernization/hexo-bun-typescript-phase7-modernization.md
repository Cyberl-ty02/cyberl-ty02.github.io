---
title: 从 Hexo 到 Bun + TypeScript：个人博客工程现代化与可复现构建实践
comments: true
toc: true
donate: false
share: true
date: 2026-10-27 00:00:00
updated: 2026-10-27 00:00:00
categories: 网站与博客
tags:
- 博客
- 开发工具
---
个人博客很容易落入一种尴尬状态：页面还能生成，旧命令也似乎还能跑，但没人能快速说清楚哪份代码是源文件、哪份是构建产物，CI 为什么和本机不同，以及删掉一个“看起来多余”的 JavaScript 会不会让 Hexo 悄悄失去插件。

我对这个 Hexo 博客做 Phase 7 整理时，目标并不是把静态站点包装成复杂应用，而是反过来减少维护变量：统一依赖和命令入口，为自有逻辑建立类型边界，让生成资源可以追溯，让 PR 验证与生产发布明确分开，并让下一次维护不依赖某段私人聊天记录。

这篇文章记录其中真正值得复用的设计取舍。评论数据迁移本身已经单独写在[从 Gitalk、Waline 到 Twikoo](/posts/gitalk-waline-twikoo-migration/gitalk-waline-twikoo-migration/)一文；更早的 pnpm/Bun 与 Waline 排错过程，则保留在[Hexo 博客迁移 Waline 与 Bun 的踩坑记录](/posts/hexo-waline-bun-notes/hexo-waline-bun-notes/)中。

<!-- more -->

## 为什么需要现代化

最初的问题并不是 Hexo 无法工作，而是几个边界逐渐混在了一起：

- 仓库已经声明 Bun，旧工作流却还可能沿用其他包管理器；
- 浏览器脚本、Hexo 插件和构建工具都叫“JavaScript”，实际运行环境却不同；
- 有些文件由构建生成但必须提交，有些目录只是缓存，两者容易被一起清理；
- 本地完整仓库能读取全部 Git 历史，CI 的浅克隆和 linked worktree 却未必具备同样布局；
- 评论系统独立于静态站点，前端还要处理 PJAX、路径和第三方资源许可；
- PR 验证与 Pages 生产发布共用一份工作流，如果条件写得含糊，就可能把“试一下”变成上线。

因此，这轮工作的衡量标准不是“用了多少新技术”，而是一个改动能否回答三个问题：源头在哪里、由什么合同验证、失败后边界是否清楚。

## Bun-first，但不排斥 Node

仓库最终采用的原则可以概括为：Bun-first、TypeScript-standard、Node-compatible、Upstream-friendly。

Bun 负责冻结安装、执行自有工具、运行测试和打包资源；TypeScript 为 `frontend/`、`plugins/`、`tools/` 与测试提供统一的源码和静态检查基线。但 Hexo 及 Kratos-Rebirth 仍使用上游发布的 JavaScript/EJS 接口，没有为了“全 TypeScript”维护一个私有主题 fork。

这也解释了为什么仓库同时存在 ESM 和 CommonJS：

```text
frontend/*.ts        --Bun browser/ESM--> source/comments/*.js
plugins/*.ts         --Bun node/CJS-----> scripts/*.js
tools/*.ts           --Bun runtime------> 构建与验证过程
```

浏览器评论代码以 ESM 发布；Hexo 会自动加载根目录 `scripts/` 下的 JavaScript，所以日期插件必须保留 Node-compatible CommonJS 入口。`plugins/date-from-git.ts` 是手写源，`scripts/date-from-git.js` 是生成文件，却也是正式运行接口。把后者仅仅视作“编译垃圾”删除，构建可能仍启动，文章日期行为却已经改变。

这种兼容层比重写 Hexo 加载机制更小，也更容易跟随上游。最初把自有工具集中到 Bun 与 TypeScript 的变化可以从 [统一自有工具链的提交](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/f702bcb62f3ebb91e6610ad6af94d46722988a56)追溯。

## 类型检查不只有一个“通过”

类型验证被拆成三种职责：

1. `bunx tsc --noEmit` 是正式 TypeScript CLI 门禁，使用仓库的严格 `tsconfig.json`；
2. `bun check --no-script --no-pretty` 提供 Bun-native 快速反馈；
3. 独立 parity 测试用合成错误样例比较 Bun 与 TypeScript 的诊断码和位置。

这里最重要的不是让三个命令看起来整齐，而是承认它们不等价。快速检查适合缩短反馈时间，不能因为“更快”就替代标准编译器；parity 证明一组选定诊断当前一致，也不代表两个实现对所有 TypeScript 程序永久等价。当前 `bun run check` 会执行 TypeScript CLI、正式测试和内容检查，fast check 与 parity 则仍是独立入口，也没有被描述成 PR Workflow 自动完成的步骤。

[迁移到 TypeScript 7](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/2cb50146f32b590608d41f7fa17474a8c7ee6cd8)与[增加 Bun 快速检查和诊断合同](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/8e22b0a3f01b7ab245342f4d3d507cf8694fafb2)被拆成两个提交，也是为了先确认标准工具链，再单独验证加速路径。

自动测试保护的也不只是函数返回值。评论 Provider、路径规范化、PJAX 生命周期、Markdown 消毒、Git 日期、浅克隆、worktree 清理和运行资源清单都属于合同。测试数量会随功能增长，真正稳定的是它们保护的行为，而不是某次日志里的数字。

## 生成资源也是供应链的一部分

评论前端包含两类资源：本站维护的 TypeScript/CSS，以及从锁定 Twikoo 包复制的客户端文件。`tools/runtime-artifacts.ts` 把两类资源放进同一份 manifest：当前包括四项自有生成物，以及 Twikoo 客户端、七个 locale 和 MIT LICENSE 等九项 vendored 文件。

这份清单解决了几个容易被忽视的问题：

- 构建器不再各自硬编码输入输出；
- 检查器可以确认 ESM、CommonJS 与 CSS 的目标格式；
- vendored 文件必须与锁定依赖内容一致；
- locale 不能因“我当前不用这种语言”而随手删除；
- 客户端与许可证一起发布，避免只复制 minified 文件而遗失许可信息。

Twikoo 默认 Provider 和 `disabled` 本地预览共用同一套 dispatcher。普通构建采用源码默认值；预览覆盖只在对应构建进程中注入，不能改变下一次正式构建。页面运行时再按需加载本地 Twikoo 客户端，不从公共 CDN 临时取一个无法由锁文件证明的版本。

从 [Twikoo Provider 上线](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/6376154c1b0cab895bd12c3400308fe961b3a340)到[退役 Waline 运行链](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/cc7accd975a9e68f698c72e3b639464a0bc2eaee)分成两步，目的同样是让切换和清理具有不同的回退边界。

## Git 日期、浅克隆与 linked worktree

文章没有显式 `date` 或 `updated` 时，本地插件会从 Git 历史恢复时间。普通 checkout 的 `.git` 是目录，`isomorphic-git` 可以直接读取对象库，并按 blob 身份跟踪内容未变、目标唯一的改名。若浅克隆只记录父提交 OID、却没有对应对象，插件只能把最老的可见提交当作边界；正式 CI 因此仍使用 `fetch-depth: 0` 获取完整历史。

detached linked worktree 又是另一种布局：工作目录中的 `.git` 是指向私有 gitdir 的文本文件，对象和引用通过 `commondir` 共享。与其假设库函数能把这种布局当普通仓库处理，兼容分支明确使用参数数组调用只读 Git CLI，并设置 `GIT_OPTIONAL_LOCKS=0`。缺少 Git CLI 时直接报出原因，而不是悄悄把当前时间写成文章历史。

仅让这一分支单元测试通过仍不够。[worktree 与运行资源兼容提交](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/6dbf0915bb738a2a05850ea006642750896909c2)建立了快照模型，随后 [Ubuntu CI 门禁](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/17ca2967bdf7f64da97caa82ee8f2342dd29fe02)在同一 HEAD 上创建真实 detached worktree，重新冻结安装并完整构建，然后比较：

```text
全部文章的生成路径与渲染日期
manifest 中运行资源的 SHA-256
临时 worktree 构建后的 Git 状态
```

它没有对整个 `public/` 做盲目的字节镜像。重复 clean build 中，`search/index.html`、`search-index.json` 与 `sitemap.xml` 可能出现已知的字节差异；稳定合同关注文章 URL、日期、受控运行资源和可解析的搜索/站点地图语义。这个边界不能被理解成“任何差异都可以忽略”：新出现的文件变化仍要先解释来源，不能为了绿灯放宽检查。

## CI 安全与发布隔离

可复现构建不仅是 `bun install --frozen-lockfile`。依赖从哪里解析、CI 拿到多少权限、哪种事件能部署，也属于同一个问题。

当前仓库级 `bunfig.toml` 使用 npm 官方 Registry，锁文件承担完整依赖图与完整性信息。这样 CI 不依赖维护者机器上的用户级镜像设置。第三方 GitHub Actions 则固定到完整 Commit SHA；普通 build job 只有 `contents: read`，checkout 不保留凭据。仅在 `push` 到 `main` 时，artifact 上传和 deploy job 才会启用 `pages: write` 与 `id-token: write`。

因此，临时分支的 Draft PR 可以真实运行 Ubuntu 安装、检查、构建和 linked-worktree 门禁，同时 artifact 与 deploy 必须保持 skipped。验证分支在 PR 关闭后删除，正式 `main` 是否发布则是另一份明确授权。

[Actions 固定与权限收敛](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/96f29de4f542d9079ad4fd6d4935b17a0baee33f)和[仓库 Registry 统一](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/43fd59466c1c863159444d1f120333e4144840d7)都经过独立验证。它们降低了供应链和误部署风险，但“当前检查通过”从不等于所有漏洞已经消失；依赖公告、上游修复和权限变化仍需持续审查。

## 从重构走向精简

现代化完成后，下一步不是继续堆工具，而是辨认哪些东西真的可以删。Hexo 旧 `deploy` script、空 deploy 配置和没有读取方的旧 plugin 列表，在调用关系和构建结果确认后才由[独立配置清理提交](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/cd624595a7e0b1bf7cd505f2d83ea63feb87a475)移除。

相反，下面这些项目虽然容易被误判为历史包袱，却仍承担正式职责：

- `scripts/date-from-git.js` 是 Hexo 能加载的 CJS 接口；
- `source/comments/` 是 Pages 实际发布的浏览器资源；
- Twikoo locale 与 LICENSE 是 vendored 客户端的一部分；
- 主题里的 `waline-comment-count` 等名字只是上游兼容 class，不能据此删除；
- lockfile、内容合同和历史文章分别承担复现、回归与背景说明。

维护知识也采用同样的分工：README 面向访客，根 `AGENTS.md` 给维护者提供 Source of Truth 和安全边界，测试表达可执行行为，Git 历史记录具体变化，博客文章解释为什么这样设计。这样做的目标不是建立文档体系，而是让新维护线程无需私人记忆也能找到入口。

## 经验、限制与下一步

这轮整理留下的经验并不局限于 Hexo：

1. 先画清运行环境，再决定模块格式；“统一语言”不等于“统一加载器”。
2. 快速检查、标准门禁和 parity 各自回答不同问题，不应互相冒充。
3. 生成文件是否提交，取决于部署接口与复现策略，而不是文件扩展名。
4. 处理 Git 历史时必须真实覆盖浅克隆和 worktree，不能只在日常 clone 中验证。
5. 删除配置前先找读取方；没有证据的“清爽”通常只是把故障推迟到发布时。
6. PR 构建和生产部署应由可审查的事件条件隔开，而不是依赖操作者记得不要点某个按钮。

它也仍有明确限制。现有合同能验证 Provider 选择、DOM 更新条件、PJAX 事件处理和生成资源，但没有取代真实浏览器中的长期交互测试；评论提交、登录和管理后台更不属于静态仓库验收。Quickstart 监测已经有自然 schedule 的成功记录，但尚未出现需要创建 `upstream-sync` Issue 的真实 `changed=true` 场景。Dependabot 有历史更新记录，不过切换到 Bun ecosystem 和统一 Registry 之后，仍需等待新的自然更新 PR 才能证明整条新路径。

下一步计划是从完全没有此前对话的维护线程出发，只读取仓库、Git 历史、README、`AGENTS.md` 和合同，观察它能否准确恢复边界并提出小而安全的修改。这个恢复测试在本文发布时尚未执行，因此不能写成已经完成的成果。

最终，这个博客并没有因为 Phase 7 变成一套平台。它仍是 Hexo、一个上游主题和一组静态文件；变化在于每层现在有了更清楚的来源、验证方法和停止边界。对个人项目来说，这种“足够可复现、足够可解释，但不过度建设”的状态，才是现代化真正要达到的结果。

## 参考实现与记录

- [项目维护入口 AGENTS.md](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/blob/main/AGENTS.md)
- [当前构建工作流](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/blob/main/.github/workflows/build.yml)
- [运行资源清单](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/blob/main/tools/runtime-artifacts.ts)
- [Git 日期插件源码](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/blob/main/plugins/date-from-git.ts)
- [linked-worktree 合同](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/blob/main/tools/check-linked-worktree.ts)
- [2026-10-27 生产构建记录](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/actions/runs/40380298550)
