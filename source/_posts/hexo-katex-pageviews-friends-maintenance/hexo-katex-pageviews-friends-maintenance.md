---
title: 给 Hexo 博客补上数学公式、文章访问量与友链申请
comments: true
toc: true
donate: false
share: true
date: 2026-10-28 00:00:00
updated: 2026-10-28 00:00:00
categories: 网站与博客
tags:
- 博客
- 开发工具
---
完成 [Phase 7 工程整理](/posts/hexo-bun-typescript-phase7-modernization/hexo-bun-typescript-phase7-modernization/)以后，我没有继续把个人博客扩成一套平台，而是补了三个日常使用中真正缺少的小接口：正文与评论共用的数学公式、文章详情页访问量，以及不要求申请者手改 YAML 的友链入口。

它们分别落在渲染、运行时状态和公开协作三个边界上。实现时仍遵循同一条原则：Hexo 8 与 Kratos-Rebirth 负责站点和主题，Bun 与 TypeScript 只维护博客自有的薄适配层，能够复用上游接口就不 fork 上游。

<!-- more -->

## 为什么做这一轮小维护

博客已经可以稳定构建，但“能生成页面”和“日常好用”并不是同一件事。技术文章偶尔需要公式；Twikoo 已经保存评论，却没有把访问量接进当前主题；友链数据虽然公开，申请者仍需要理解仓库格式。这三个问题规模都不大，适合分别确认现有能力，再做最小整合。

我也刻意没有引入第二套统计服务、另一套公式引擎或自动审核机器人。新增系统越多，隐私边界、供应链和长期维护面就越大。

## 正文与 Twikoo 共用 KaTeX

正文由 Hexo 的 Markdown 渲染阶段处理，Twikoo 评论则在浏览器中异步出现。两者生命周期不同，但可以共享锁定的 `katex@0.19.0`：构建端通过 Hexo 插件生成正文 HTML，浏览器端把同一套 auto-render 配置桥接给 Twikoo。

KaTeX 的 CSS、字体和许可证都从锁文件对应的包复制到站内资源目录，并纳入运行资源 manifest。这样 Pages 不依赖临时 CDN，字体与样式版本也不会和 JavaScript 悄悄错位。评论仍由 Twikoo 自己完成 Markdown 消毒与挂载，本站只提供受限的公式渲染接口。

## Markdown 数学语法与美元符号

正文和评论都支持常见的 `$...$` 行内公式与 `$$...$$` 块级公式。例如，对于页面 $p$，可以将访问事件数写成：

$$
PV(p)=\sum_{i=1}^{n}\mathbf{1}\{v_i=p\}
$$

它只表示匹配到页面 $p$ 的访问事件之和，不是独立用户数量。另一方面，普通文字里的金额也必须保持原样，例如预算从 USD $5 增加到 $10，并不应该被当成一段公式。为此，正文扩展和评论桥接都会避开代码、链接等上下文，并保护有歧义的单个美元符号；复杂内容仍建议使用 `\(...\)` 或 `\[...\]` 明确边界。

## Twikoo 文章访问量：路径、PV 与 PJAX

本站使用 Twikoo 2.0.15 的公开 `getVisitorsCount()` 接口，只在正式域名的文章详情页调用。PV 是页面访问次数：刷新、重新进入或通过 PJAX 返回文章，都可以形成新的访问；它不等于 UV，也不识别某个具体访客。

固定版本后端的 `COUNTER_GET` 会先合并读取 `/path` 与 `/path/` 的既有计数，再对这次请求的规范路径递增。因此页面显示 API 返回的已确认 `time`，并检查 `updated` 写入证据，不在前端猜测性地加一。超时后也不会自动重试，因为请求结果不明时，重试可能把一次访问写成两次。

Kratos-Rebirth 的 `pjax:success` 与 `pjax:complete` 可能属于同一次导航。适配层为每次真实导航分配一个 View 边界，让 success/complete、评论懒加载和评论重试共用已有结果；新的导航才重新计数。访问量任务不依赖评论容器，所以 `comments: false` 的文章仍能统计。localhost、预览域名与 disabled Provider 则不会写入生产计数。

## GitHub Issue Form 与人工审核友链

友链申请现在可以从博客导航直接进入 [GitHub Issue Form](https://github.com/Cyberl-ty02/friends/issues/new?template=friend.yml)。表单收集站点名称、HTTPS 地址、简介、图片和互链页面，但提交只是一份待审核资料，不会自动改写博客。

两个仓库各自保留清楚的职责：Friends 仓库中的 `linklist.yml` 是审核与维护的权威数据；博客仓库保存已经批准的 YAML 与本地图片发布快照，构建时不动态读取另一个仓库。图片权利、链接有效性、重复项和内容适用性仍由人工判断，Issue Form 不承担安全扫描或自动准入。

## 最后得到的经验和局限

这轮维护再次证明，小功能也需要明确边界：公式要同时考虑构建期与异步 DOM；访问量要区分路径、请求和真实导航；公开表单要区分候选输入与正式数据。锁文件、运行资源 manifest、TypeScript 合同和 Ubuntu PR 构建负责可复现性，文章只解释长期有用的设计，不保存逐条执行日志。

现有自动测试覆盖公式渲染、Provider 选择、计数返回值、错误状态和 PJAX 去重，但不能证明所有浏览器、网络与后端长期都不会出错。访问量只是聚合 PV，友链仍需人工审核，评论提交和管理后台也不属于静态站点的日常发布验证。保持这些限制可见，比把小博客包装成“全自动系统”更容易维护。

延伸阅读：

- [从 Gitalk、Waline 到 Twikoo](/posts/gitalk-waline-twikoo-migration/gitalk-waline-twikoo-migration/)
- [Twikoo API](https://twikoo.js.org/api.html)
- [KaTeX Auto-render Extension](https://katex.org/docs/autorender.html)
- [Cyberl Blog 友链维护仓库](https://github.com/Cyberl-ty02/friends)
