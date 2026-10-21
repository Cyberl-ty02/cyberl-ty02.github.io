---
title: 从 Gitalk、Waline 到 Twikoo：Hexo 博客评论迁移与数据修复实践
comments: true
toc: true
donate: false
share: true
date: 2026-10-22 00:00:00
updated: 2026-10-22 00:00:00
categories: 网站与博客
tags:
- 博客
- 开发工具
---
评论系统看起来只是文章末尾的一块输入框，真正迁移起来，却同时牵涉身份、正文格式、文章路径、时间戳、数据库权限和前端生命周期。这次我把博客从 Gitalk、Waline 迁到 Twikoo，最费时间的也不是替换一个初始化函数，而是回答一个更基本的问题：手里的数据，究竟能不能代表当年的讨论？

最终，我没有把 Waline 的 MongoDB 备份直接视作唯一真相。备份先被只读盘点和转换，在隔离数据库中通过了技术验收；但人工与最初的 GitHub Issue 对照后，仍发现内容关系不够准确。最后上线的六条历史评论，改为依据 GitHub Issue #8 的原始 Markdown、顺序以及 UTC 创建和编辑时间重新建立。

本文记录这条弯路，也记录迁移完成后如何用 TypeScript、Bun、事务、备份恢复和真实 linked worktree 测试，把“现在能显示”变成“以后还能维护”。文中的版本和外部服务状态核查于 2026-10-21。

<!-- more -->

## 三代评论系统留下的不同数据边界

博客最初使用 Gitalk。它把一篇文章的讨论放在 GitHub Issue 中，正文、作者和时间天然留在 GitHub；代价是访客通常需要 GitHub 身份才能参与。后来为了降低留言门槛，我迁到 Waline，并把后端部署在 Zeabur、数据存进 MongoDB。

那次迁移解决了匿名评论体验，却也把数据边界从“公开的 Issue”变成了“应用数据库中的一组集合”。当原 Zeabur Waline 项目不再可用、后端退役以后，我虽然保留了离线 MongoDB BSON 备份，但不能再把重新部署旧服务当作长期方案。

这里需要说得准确一些：触发迁移的是我所使用的原 Zeabur 项目已经停止使用，并不是要推导 Zeabur 整个平台的状态。新的目标也不是追求某个“永不关停”的免费服务，而是把各层职责拆开：

```text
GitHub Pages
  └─ Hexo 8.1.2 + Kratos-Rebirth 3.0.1
       └─ 本地打包的 Twikoo 2.0.15 客户端
            └─ Netlify Functions
                 └─ MongoDB Atlas / twikoo
```

静态博客仍由 GitHub Pages 托管；浏览器只知道公开的 Twikoo `envId`；MongoDB 连接串只存在于 Netlify 的服务端环境变量中。按照 [Twikoo 的 Netlify 部署说明](https://twikoo.js.org/backend.html#netlify-%E9%83%A8%E7%BD%B2)，前端使用的地址形如：

```text
https://<site>.netlify.app/.netlify/functions/twikoo
```

而 `MONGODB_URI` 不能进入仓库、静态 JavaScript 或构建日志。Atlas URI 还要显式指定 `twikoo` 数据库；Twikoo 文档也提醒，未指定数据库名时可能落到默认的 `test` 数据库，详见 [MongoDB Atlas 配置说明](https://twikoo.js.org/mongodb-atlas.html)。

## 先盘点备份，不要急着导入

离线备份中有三个集合：

| 集合 | 记录数 | 本次处理 |
| --- | ---: | --- |
| `Comment` | 6 | 只读分析并生成候选 |
| `Counter` | 24 | 仅统计，不迁移浏览量 |
| `Users` | 1 | 不迁移账户、密码或第三方身份 |

六条 `Comment` 当时都是已审核状态，`pid`、`rid` 均为 BSON `null`，涉及同一个文章 URL。创建时间字段是 BSON Date 类型的 `insertedAt`，并没有可直接依赖的 `createdAt`。这意味着转换器必须使用真实字段，而不能因为另一版 Waline 模型常见 `createdAt`，就用当前时间补一个看似合理的值。

更重要的是，评论记录还带有邮件、IP、User-Agent 等字段。迁移的默认策略是数据最小化：保留显示所需的昵称、正文、路径和时间；排除邮件、IP、UA、账户密码与 OAuth 信息。`mailMd5` 也没有被当作匿名化结果——一个可稳定关联用户的散列值，仍然可能构成个人信息线索。

盘点工具始终默认 dry-run，并做了几层保护：

- 校验 ZIP 路径、CRC、BSON 文档边界和输入 SHA-256；
- 统计字段名、BSON 类型、状态、空正文、异常时间和重复 ID；
- 拒绝危险解压路径和异常大的归档成员；
- 普通日志只写计数与错误类别，不打印正文、昵称、邮件、IP 或 UA；
- 真实候选文件只能写到仓库外、尚不存在的私有目录。

这一步得到的是“可以继续检查的输入”，不是“可以直接上线的数据”。原始 BSON 也从未直接写进 Twikoo 集合。

## 从 Markdown 到 Twikoo 记录

Waline 备份里的正文并不等同于 Twikoo 最终保存和显示的 HTML。转换器需要保留 Unicode、换行、链接、代码块和引用关系，同时拒绝脚本、事件属性及危险 URL。为此我对照 Twikoo 2.0.15 的评论提交、导入及 Markdown 渲染逻辑，用合成数据覆盖纯文本、Markdown、HTML、特殊字符和 XSS 样例，再生成经过消毒的候选 HTML。

候选映射大致如下：

| 来源 | 候选字段 | 处理原则 |
| --- | --- | --- |
| Waline `_id` | 候选 Twikoo `_id` | 为 Waline 转换演练生成稳定、唯一且可追溯的字符串 ID |
| `nick` | `nick` | 保留显示值，不写入普通日志 |
| `comment` | `comment` | Markdown 转换为已消毒 HTML |
| `url` | `url` | 规范化为站内路径 |
| `insertedAt` | `created` / `updated` | 保留 UTC 时刻，不用执行时间替代 |
| 审核状态 | 已验证的目标状态 | 不能确认的值进入人工清单 |
| `pid` / `rid` | 回复关系 | 先验证父记录存在；本批实际均为空 |

转换前的输入保持只读；转换后的 HTML 还要避免二次转义。换句话说，`<code>` 不能变成屏幕上的字面量 `&lt;code&gt;`，但用户输入的 `<script>` 也绝不能获得执行机会。

即便如此，“字段能映射”仍不代表“历史语义正确”。这个区别后来成为整次迁移最关键的一课。

上表只描述第一轮 Waline BSON 候选，并不是最终生产记录的身份来源。最终重建时，来源键改为 GitHub Issue #8 的六个评论 ID：每个 GitHub 评论 ID 只对应一个批准的 Twikoo ID，导入和回滚都使用同一份精确白名单，不靠昵称、时间或数组位置猜测。文章不公开六个目标 ID，但映射在私有审计中必须可以反向追溯到 GitHub API 记录。

## 评论路径比评论框更容易被忽略

旧配置曾经使用 `data-path` 与 `path_hasher: md5`。Twikoo 的计数接口则接收不带协议、域名和查询参数的 URL 列表；其官方 [`getCommentsCount`](https://twikoo.js.org/api.html#get-comments-count) 也明确以文章路径作为查询键。因此不能假设 Waline 的哈希 ID、Gitalk Issue 标签和 Twikoo 的 `path` 天然等价。

本站使用目录式 permalink。评论适配层把路径统一为以下规则：

```text
去掉协议、域名、查询参数和片段
合并重复斜杠
/index.html 还原为目录路径
普通目录补上尾斜杠
```

这批历史讨论最终只允许映射到：

```text
/posts/hello-world/hello-world/
```

首页计数也复用同一个规范化函数，并批量调用 `getCommentsCount`。无评论时显示 `0`，请求失败时显示不可用状态，而不是把评论数冒充为浏览量。旧 Waline `pageviewCount` 没有等价迁移，所以页面浏览量被单独隐藏。

## 为 Kratos-Rebirth 做一个可切换的 Provider

我没有直接在主题模板里散落 Twikoo 地址，而是在博客自有代码中保留一个评论 Provider 边界。上线后只剩两种模式：

```typescript
type CommentProviderName = "twikoo" | "disabled";

const DEFAULT_COMMENT_PROVIDER = "twikoo";
```

`disabled` 是应急关闭模式，不加载客户端，也不请求评论后端。Twikoo 没有配置完成时同样拒绝请求占位 URL。客户端文件和 locale 从锁定的 `twikoo@2.0.15` 包复制到本站静态资源中，避免页面运行时再依赖第三方 CDN；其 MIT `LICENSE` 也随资源一并保留。

主题的评论容器仍沿用 `data-path`，某些带有 `waline` 字样的 class 一度被保留为 Kratos-Rebirth 的兼容选择器。这种名字不能单独证明 Waline 仍在运行：判断标准应是生成页面是否加载旧 JS/CSS、是否请求旧 endpoint，以及旧 Provider 是否还能被选择。完成上线验收后，Waline 的 TypeScript 入口、生成的 JS/CSS 和 `@waline/client` 依赖才作为独立提交移除。

## PJAX 下真正棘手的是异步竞争

Kratos-Rebirth 使用 PJAX。首屏加载成功并不代表切换文章后还能正常工作，因为旧页面的异步请求可能晚于新页面返回，把旧评论挂到新容器上；重复绑定事件又会让一次导航触发多次初始化。

适配层的处理方式包括：

- 以 `WeakMap` 保证同一个 `window` 只安装一组监听器；
- 在 `pjax:before` 中递增 generation、取消当前视图并清理挂载；
- 每次加载创建 `AbortController`，过期请求即使返回也不能继续写 DOM；
- 为每次 Twikoo 挂载创建唯一节点 ID；
- 把 `twikoo.init()` 串行化，避免两个 Vue 实例相互卸载；
- 兼容主题既有的 `window.loadComments` 懒加载约定；
- 同时处理正常的 `success → complete` 和浏览器历史恢复时仅触发 `complete` 的情况。

Twikoo 2.0.15 没有供这类场景直接调用的公开 destroy/abort 接口，所以这里不能只写一行重复 `init()`。必须让旧异步任务失去继续挂载的资格。

## 隔离演练通过，不等于历史已经正确

真实候选先进入独立的 `twikoo_migration_test` 数据库。隔离用户只拥有测试库权限，后端只监听本机回环地址；它既不是生产 `twikoo`，也不是未配置 MongoDB 时会使用的 LokiJS 默认存储。

演练验证了六条记录的事务插入、回读、重复 ID 阻断、精确回滚和恢复；随后又通过真实前端检查时间、顺序、Markdown、链接、特殊字符、移动端、深色模式以及 PJAX 返回后的重新挂载。从数据库和前端的角度看，这批候选已经“能迁移”。

生产操作前还分别备份了 `comment` 与 `config`，记录文件哈希，并在匹配的 MongoDB 8.0.34 隔离实例中完成真实恢复验证（此前尝试的 9.0.4 环境因版本差异及恢复参数问题，没有构成有效验收）。这里有一个容易混淆的时间点：当时生产 `comment` 的基线是 **0 条**、`config` 为 **1 条**，所以恢复成功证明的是“导入前空评论状态 + 当时的管理员配置”，不是后来六条最终评论的成品备份。它们适合证明导入前基线可恢复，却不能单独承担最终历史评论的灾难恢复。

后来用于第一次 Waline 候选导入的私有 JSON 也不能当作最终六条评论的恢复材料：该候选已经被证实与 GitHub 原始讨论不符。最终重建采用了另一份基于 GitHub 官方数据、具有独立摘要的六条候选，并完成生产事务写入及回读校验；不过，**截至这次整理时能核对的归档，没有找到最终六条评论重建后的原生数据库备份及独立恢复演练记录**，因此不能声称它们已经完成。真正的长期恢复方案仍应独立保存最终候选与生成工具，补做当前评论集合的加密备份和隔离恢复测试。公开 Issue 可以核对原始正文与 UTC 时间，但不能代替当前数据库全量状态的备份。MongoDB 官方的 [Database Tools 文档](https://www.mongodb.com/docs/database-tools/mongodump/) 说明了 `mongodump` / `mongorestore` 的备份和恢复能力；生成归档与证明归档可恢复，是两件不同的事。

权限模型也经历过从建议到落地的收敛。最初方案建议为生产只读预检和一次性导入分别建立账户；实际生产最终使用一个专门服务评论系统、唯一角色为 `readWrite@twikoo` 的 Atlas 用户，没有继续增加多个生产账户。隔离演练账户仍只访问测试数据库。这个结果不是“所有步骤共享高权限”，而是把现有生产账户的作用域收窄到单一数据库，同时用目标库、集合、数量、ID 和事务保护约束操作。

生产导入器则固定目标库、集合、候选数量、路径和 ID 白名单，在写入前读取评论基线与 `config` 摘要，并在一个 MongoDB 事务中插入六条记录。MongoDB 事务要么提交全部改动，要么中止全部改动，适合避免批量插入停在半完成状态；但遇到网络中断导致提交结果未知时，正确做法仍是先只读查询最终状态，而不是自动重试。事务语义见 [MongoDB Transactions](https://www.mongodb.com/docs/manual/core/transactions/)。

首先暴露的问题是时间来源：Waline BSON 的六条 `insertedAt` 均落在 **2026 年 6 月 5 日（北京时间）**，而 GitHub Issue #8 的原始讨论发生在 **2025 年 11 月 12—14 日**。进一步人工逐条核对后，还发现第一次生产候选虽然字段合法、数量正确、页面也能显示，正文等内容却不能准确代表 GitHub 上的原始对话。也就是说，技术完整性检查通过了，来源完整性没有通过。

这批有问题的评论随后由我手工移除，并停止复用 Waline 候选。这个失败结果必须保留在记录里：它不是一次“六条评论无损迁移成功”，而是一次证明转换器可用、同时证明输入来源不够可靠的演练。

## 回到 GitHub Issue #8 重建原始讨论

Gitalk 的原始讨论仍保存在公开的 [GitHub Issue #8](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/issues/8)。Issue 的标签给出了文章路径，GitHub REST API 又能返回每条评论的原始 Markdown、稳定 ID、`created_at` 与 `updated_at`。官方文档说明 Issue 评论默认按 ID 升序返回，并支持 raw、text 和 rendered HTML 等媒体类型，见 [Issue comments REST API](https://docs.github.com/en/rest/issues/comments)。

我没有只按昵称、日期或列表位置猜测对应关系，而是同时核对作者、正文与引用结构、顺序、创建时间和编辑状态。API 的核查结果是六条评论、两位作者，其中两条有后续编辑；六条均能唯一对应，才生成新的重建计划。

最终记录保留 GitHub 的精确 UTC `created_at` 和可用的 `updated_at`。没有编辑证据的记录令 `updated = created`，有编辑记录的则使用 API 返回的更新时间。目标 `_id` 不沿用第一次 Waline 候选，而是把**固定的仓库和 Issue 标识、GitHub 评论 ID** 组合后计算 SHA-256，并截取前 24 个十六进制字符，形成可重复计算的映射；生产写入再对六条目标 ID 做白名单检查。这种做法确保记录身份稳定，不是把评论 ID 当作匿名化手段。重建只写这六条白名单记录，不修改管理员 `config`，也不把 GitHub 账户之外的邮件、IP、UA 或身份资料补进数据库。

这次重建后，六条评论再次经过数量、路径、顺序、时间、正文可见效果、评论计数、PJAX、移动端和深色模式验收。文章中不复述评论全文；公开 Issue 本身就是更合适的来源。

## 上线之后再退役旧运行链

评论迁移与静态站点改动分开发布。首先上线 Twikoo Provider 并确认正式站点能够只读加载六条历史评论；之后再用独立提交删除 Waline 的浏览器入口、生成的 JS/CSS、旧 Zeabur endpoint 和 `@waline/client`。这样一旦前端集成出错，问题边界不会和数据写入混在一起。

最终生产页面满足以下条件：

```text
默认 Provider 为 Twikoo
disabled 模式仍可紧急关闭评论
页面不加载 waline.js / waline.css
浏览器不再请求旧 Zeabur 服务
评论数来自 Twikoo，浏览量保持隐藏
GitHub Pages 的文章路径和部署方式不变
```

主要公开变更可以从仓库提交记录核对：

- [上线 Twikoo 前端适配](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/6376154c1b0cab895bd12c3400308fe961b3a340)
- [移除退役的 Waline 运行链](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/cc7accd975a9e68f698c72e3b639464a0bc2eaee)
- [增加 Git worktree 与生成物校验](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/6dbf0915bb738a2a05850ea006642750896909c2)
- [把 Ubuntu linked worktree 变成 CI 门禁](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/17ca2967bdf7f64da97caa82ee8f2342dd29fe02)
- [修补可升级的传递依赖](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/commit/27fea82aeafb5e630b9436ecab1a3dc599a56cac)

## Bun 与 TypeScript 只管理自己的边界

迁移期间，我把博客自有逻辑放进 TypeScript，但没有把 Hexo 或 Kratos-Rebirth 强行改造成私有 fork：

```text
frontend/*.ts       浏览器评论运行时与 Twikoo Provider
tools/*.ts          构建、内容检查和合同测试
plugins/*.ts        Hexo 插件源码
scripts/*.js        Hexo 实际加载的 CommonJS 生成入口
source/comments/*   浏览器 ESM、CSS 与 vendored Twikoo 资源
```

Hexo 会自动加载 `scripts/` 下的 JavaScript，因此日期插件保留 TypeScript 源码，再由 Bun 生成 Node CommonJS 入口；浏览器评论代码则生成 ESM。Bun 官方文档也把 `target` 和 `format` 作为不同的构建维度，详见 [Bun Bundler](https://bun.sh/docs/bundler)。这里保留 `.js` 不是技术债，而是运行环境的接口。

构建器维护一份 13 项运行资源清单：4 项自有生成物，以及 Twikoo 客户端、7 个 locale 和 MIT LICENSE 共 9 项第三方资源。检查器会验证源、输出路径、browser/node 目标、ESM/CJS 格式和许可证；缺少任一项都会失败。

常用检查命令保持简单：

```bash
bun install --frozen-lockfile
bun run check
bun run build
bun run tools/check-linked-worktree.ts
```

日期插件还暴露了一个容易被普通 clone 掩盖的问题：linked worktree 的 `.git` 是指向私有 gitdir 的文件，对象和引用又可能通过 `commondir` 共享。普通仓库继续使用 isomorphic-git；真实 linked worktree 则通过参数数组调用只读 Git CLI，并设置 `GIT_OPTIONAL_LOCKS=0`，不触碰 index、refs 或工作区。

CI 会在 Ubuntu Runner 上创建 detached linked worktree，在其中冻结安装、测试并构建，再比较普通 checkout 与 worktree 的全部文章 URL、日期、`updated` 和 13 项资源 SHA-256。文章数量是从主 checkout 动态读取的，不固定写死为 23，所以以后增加文章不会因为合同本身而失败；只有两边集合或内容不一致才会阻止 Pages artifact 上传。

在本文定稿所依据的生产基线中，[最后一次依赖补丁工作流](https://github.com/Cyberl-ty02/cyberl-ty02.github.io/actions/runs/39613494413) 使用仓库声明的 Bun 1.4.2 完成冻结安装，35 项测试、133 条断言通过；普通 checkout 与 linked worktree 的 23 篇文章路径和日期一致，13 项运行资源的 SHA-256 也一致。这里的数字只是当时的验收快照，不应被写成阻止以后新增文章的常量。

## 安全审计没有“清零”

迁移收尾时，Bun 审计最初报告 11 项公告（7 项 high、4 项 moderate）。通过最小 override，把 `brace-expansion` 更新到 2.1.7、`js-yaml` 更新到 4.3.2、`morgan` 更新到 1.12.1 后，公告减少到 2 项（1 项 high、1 项 moderate）。

剩余的是：

- `braces@3.0.3`：`GHSA-vfj7-8cjw-p6xm`，由 Hexo、sitemap、chokidar 等构建链引入；
- `sprintf-js@1.1.3`：`GHSA-hp3w-g68c-fv3c`，由 `hexo-i18n` 引入。

截至 2026-10-21，这两条依赖路径没有可直接采用的兼容修复版本。它们主要位于构建和本地服务链，本站生产端是静态文件，并不意味着风险为零，也不应该通过忽略审计结果制造“零漏洞”。后续要继续跟踪 Hexo 及父依赖的修复，而不是凭空指定不存在的安全版本。

当前工具链仍是 TypeScript 5.9.3。更深的 TypeScript 7 迁移属于未来独立阶段，本文没有把它写成已经完成的成果。

## 最后留下的几条原则

这次迁移最值得记住的不是某条导入命令，而是几条边界：

1. **可解析不等于可信。** BSON 能读、字段能映射、前端能显示，都不能证明历史讨论被准确保存。
2. **优先保留原始来源。** 如果当年的 GitHub Issue 仍在，它比经过多次转换的数据库快照更接近事实。
3. **路径必须显式建模。** 域名、查询参数、尾斜杠、`index.html` 和旧哈希策略都会让同一篇文章产生不同评论键。
4. **权限要按实际边界收窄。** 本次没有为每一步永久保留多个生产账户，而是让生产用户只拥有 `readWrite@twikoo`，隔离用户只访问测试库，再用工具层白名单限制一次性操作。
5. **备份恢复验证必须标明时间点。** 导入前空集合备份通过恢复验证，不代表它含有后来重建的六条评论；最终成品仍需要独立备份与隔离恢复测试，而不能只凭原始 Issue 或数据库里现有六条记录就宣称完成灾备。
6. **事务之外仍需状态核查。** 网络故障可能让客户端不知道提交结果，自动重试反而可能制造重复数据。
7. **前端生命周期也是数据正确性的一部分。** PJAX 的旧请求若挂到新页面，即使数据库完全正确，读者看到的仍是错误结果。
8. **旧系统分两步退役。** 先让新系统稳定运行，再删除旧代码与依赖，回退路径会清楚得多。

最终，评论系统只是换成了 Twikoo，迁移方法却比产品选择更长期：先确认事实来源，再缩小数据范围；先在隔离环境证明可恢复，再碰生产；最后把关键假设写成自动检查。下一次服务变化时，我至少不必再从一块“看起来能显示”的评论框开始猜。

## 参考资料与许可

- [Twikoo 2.0.15 发布记录](https://github.com/twikoojs/twikoo/releases/tag/2.0.15)
- [Twikoo API 文档](https://twikoo.js.org/api.html)
- [Twikoo Netlify 部署说明](https://twikoo.js.org/backend.html#netlify-%E9%83%A8%E7%BD%B2)
- [Twikoo MongoDB Atlas 配置](https://twikoo.js.org/mongodb-atlas.html)
- [GitHub Issue comments REST API](https://docs.github.com/en/rest/issues/comments)
- [MongoDB Database Tools：mongodump](https://www.mongodb.com/docs/database-tools/mongodump/)
- [MongoDB Transactions](https://www.mongodb.com/docs/manual/core/transactions/)
- [Bun Bundler 文档](https://bun.sh/docs/bundler)
- [Hexo 插件文档](https://hexo.io/docs/plugins)
- [Kratos-Rebirth 主题](https://github.com/Candinya/Kratos-Rebirth)

Twikoo 客户端及其文档基于 MIT License；本站随 vendored 客户端保留对应 LICENSE。Kratos-Rebirth 3.0.1 的包元数据显示其采用 GPL-3.0，主题仍作为上游依赖使用，本文没有复制或改写其源码。
