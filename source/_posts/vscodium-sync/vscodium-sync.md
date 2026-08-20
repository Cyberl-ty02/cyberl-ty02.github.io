---
title: VSCodium 与 Sync Settings 配置记录
comments: true
toc: true
donate: true
share: true
date: 2026-05-12 18:03:17
categories: 实用技巧
tags:
- 技巧
---

目前我重新把 [VSCodium](https://vscodium.com/) 作为日常编辑器，并使用 [Sync Settings](https://github.com/zokugun/vscode-sync-settings) 管理配置。

选择 VSCodium 主要是为了让编辑环境更安静一些。VS Code 的更新节奏对我来说偏快，有时一周会遇到一次或多次更新，容易打断正在进行的工作；部分不断加入的功能也会与现有插件重合，使设置和界面逐渐变得繁琐。相比之下，我更希望按自己的节奏更新编辑器，只保留实际需要的扩展。

VSCodium 默认使用 Open VSX 扩展源，少数依赖微软专有服务或授权的扩展可能无法直接使用。迁移前应先确认自己真正依赖的扩展是否可用。

## 当前配置

本文在 2026 年 7 月整理时，本机配置如下：

```text
VSCodium 1.126.04524
Sync Settings 0.21.2
同步方式：私有远程 Git 仓库
分支：main
Profile：main
同步前确认：开启
```

版本号只是当时环境的记录，不是必须照搬的要求。实际配置中没有启用定时上传、定时下载、外部文件同步或复杂的跨平台忽略规则。

当前同步仓库会保存这些资源：

```text
扩展列表
Windows 快捷键
用户设置
界面状态
```

空的 snippets 和 tasks 没有必要为了“看起来完整”而专门写入文章。等真正开始使用这些资源时，再让插件正常同步即可。

## 安装插件

可以在 VSCodium 的扩展面板中搜索 `Sync Settings`，确认发布者为 `zokugun`。也可以通过命令行安装：

```powershell
codium --install-extension zokugun.sync-settings
```

安装完成后，在命令面板中可以看到插件提供的命令：

```text
Sync Settings: Open the repository settings
Sync Settings: Upload (user -> repository)
Sync Settings: Download (repository -> user)
Sync Settings: View differences between actual and saved settings
```

## 准备私有 Git 仓库

配置文件可能包含扩展列表、终端设置、远程主机别名和本机路径，因此同步仓库应设为私有。新建仓库时可以同时创建一个 README，使 `main` 分支从一开始就存在。

本文使用 SSH 连接远程仓库。示例地址经过泛化：

```text
git@github.com:example-user/editor-settings.git
```

先在 VSCodium 内置终端确认系统 Git 能访问该仓库：

```bash
ssh -T git@github.com
git ls-remote git@github.com:example-user/editor-settings.git
```

Sync Settings 不会替系统管理 Git 凭据。如果这两个命令失败，应先处理 SSH key、主机信任或网络问题。

## 配置同步仓库

打开命令面板：

```text
Ctrl + Shift + P
```

运行：

```text
Sync Settings: Open the repository settings
```

将配置整理为：

```yaml
# 使用不包含真实姓名或设备编号的普通别名
hostname: "workstation"

profile: main

repository:
  type: git
  url: git@github.com:example-user/editor-settings.git
  branch: main
```

其中 `hostname` 是可选项，主要用于区分不同设备和生成提交信息。博客示例不应使用真实机器名。

远程仓库地址不会随着 profile 一起同步，因此每台新设备仍然需要单独完成这一步。

## 保持用户设置简单

当前与插件直接相关的用户设置只有：

```json
{
  "syncSettings.confirmSync": true
}
```

开启确认可以避免误操作。插件支持手动指定 `resources`、`ignoredSettings`、`additionalFiles` 和定时任务，但当前配置并不需要这些选项，所以不在用户设置中重复声明默认值。

尤其不建议一开始就配置自动上传。自动任务虽然省事，也可能在一台配置尚未整理好的设备上覆盖远程内容。

## 第一次同步

如果当前设备保存着准备作为基准的配置，执行：

```text
Sync Settings: Upload (user -> repository)
```

在新设备上完成仓库配置后，先执行：

```text
Sync Settings: View differences between actual and saved settings
```

确认方向无误，再执行：

```text
Sync Settings: Download (repository -> user)
```

第一次同步最需要留意方向：

```text
Upload：当前用户配置 -> 远程仓库
Download：远程仓库 -> 当前用户配置
```

如果远程仓库已经有完整配置，新设备不应先 Upload，否则可能把空白或默认配置写入远程。

## 常见问题

### Host key verification failed

这通常说明当前系统尚未信任 GitHub 主机密钥。先在 VSCodium 内置终端执行：

```bash
ssh -T git@github.com
```

核对提示中的指纹与 GitHub 官方文档一致后，再决定是否接受。不要在未核对指纹时直接确认。

### Permission denied publickey

这表示 GitHub 没有接受当前 SSH key。可以用下面的命令查看认证过程：

```bash
ssh -vT git@github.com
```

确认公钥已经添加到正确的 GitHub 账户，并检查 SSH 是否选择了预期的 key。

### 仓库初始化失败

先检查远程仓库和目标分支：

```bash
git ls-remote git@github.com:example-user/editor-settings.git
git ls-remote --heads git@github.com:example-user/editor-settings.git main
```

如果 Git 命令正常，可以先运行：

```text
Developer: Reload Window
```

插件仍然保留错误状态时，应先备份再处理它的本地缓存目录：

```text
Windows:
%APPDATA%\VSCodium\User\globalStorage\zokugun.sync-settings

Linux:
~/.config/VSCodium/User/globalStorage/zokugun.sync-settings
```

不要直接删除唯一的同步仓库或未经确认的本地配置。

## 同步前的隐私检查

私有仓库能减少意外公开，但不能替代内容审查。上传前应检查 `settings.json` 是否包含：

```text
真实用户名和绝对路径
服务器 IP、主机名或 SSH 别名
邮箱、账号和平台 handle
API key、token、密码或连接字符串
带有私有路径的自动批准命令
内部项目目录或工作区名称
```

这些内容有些可以保留在私人同步仓库中，但不应直接复制到公开博客、Issue 或截图里。真正的密钥即使只进入过一次 Git 历史，也应立即轮换。

## 小结

当前配置刻意保持简单：

```text
VSCodium
Zokugun Sync Settings
私有远程 Git 仓库
main 分支和 main profile
手动 Upload / Download
同步前确认
```

这套方式没有追求全自动，而是优先保证每次同步都能看清方向和差异。对我来说，编辑器是用来承载工作的工具；降低更新和重复功能带来的干扰，比不断增加配置更重要。
