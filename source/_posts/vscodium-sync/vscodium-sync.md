---
title: VSCodium 跨平台配置：用 chezmoi 与扩展清单替代 Sync Settings
comments: true
toc: true
donate: false
share: true
date: 2026-05-12 18:03:17
categories: 开发工具
tags:
- 开发工具
- 系统维护
---

这篇文章最初记录用 Zokugun Sync Settings 和私有 Git 仓库同步 VSCodium。当前配置已经换成更容易审阅的方式：用户设置由 [dotfiles](https://github.com/Cyberl-ty02/dotfiles) 中的 chezmoi source 部署，扩展则拆成通用、Linux 和 Windows 清单。编辑器内的同步扩展不再是必要依赖。

> **更新说明（2026-10-04）**
> 真机目前运行 VSCodium `1.135.06055`，旧的 `zokugun.sync-settings` 与 `zokugun.cron-tasks` 均未安装。版本号只是核验快照；实际恢复以仓库中的设置与扩展清单为准。

## 为什么改为文件级管理

第三方同步插件能够快速复制设置，但也会引入另一套 profile、远程仓库和上传/下载方向。现在这些内容本来就由 dotfiles 管理，再让编辑器插件同步一次会产生两个事实来源。

当前边界更明确：

| 内容 | 管理位置 | 是否公开 |
| --- | --- | --- |
| Linux/WSL 用户设置 | `dot_config/private_VSCodium/User/settings.json` | 是，已清理身份与凭据 |
| Windows 用户设置 | `windows_setting/AppData/Roaming/VSCodium/User/settings.json` | 是，保留平台差异 |
| 通用扩展 | `vscodium/extensions-common.txt` | 是 |
| Linux/Windows 扩展 | `extensions-linux.txt`、`extensions-windows.txt` | 是 |
| 登录令牌、账号状态、工作区历史、machine ID | 不进入仓库 | 否 |

`private_` 是 chezmoi 的目标权限属性，表示部署后的 VSCodium 用户目录保持为 `0700`，并不意味着文件内容可以包含秘密。

## Linux 与 Gentoo：先预览再应用

克隆 dotfiles 后，先预览全部可迁移的用户配置：

```bash
cd /path/to/dotfiles
gentoo_setting/scripts/bootstrap-user.sh
```

确认目标路径和差异后，再交互式应用：

```bash
gentoo_setting/scripts/bootstrap-user.sh --apply
```

VSCodium 扩展使用独立脚本。默认只列出将要安装或移除的项目：

```bash
gentoo_setting/scripts/sync-vscodium.sh
```

确认后执行：

```bash
gentoo_setting/scripts/sync-vscodium.sh --apply
```

脚本只补齐清单中缺少的扩展，不会清除所有未列出的扩展；它会专门移除已经冗余的旧 Sync Settings 与 Cron Tasks 扩展。这样既能迁移到新模型，也不会把本机临时安装的其他扩展当成垃圾处理。

## Windows：保留平台差异

Windows 使用 `windows_setting/` 作为独立 chezmoi source，并由该目录的引导脚本部署设置。通用编辑器行为与 Gentoo 尽量一致，但终端 profile、Remote WSL 和 PowerShell 等平台项目留在 Windows 侧维护。

不要为了让两个 `settings.json` 字节一致而删除合理差异。跨平台同步的目标是共享格式化、语言、Git、主题、安全和遥测策略，而不是假装两个系统具有相同路径和命令。

## 修改设置后的回收流程

如果在图形界面中调整了设置，先查看目标文件，再决定是否回收到 dotfiles：

```bash
chezmoi diff
chezmoi re-add ~/.config/VSCodium/User/settings.json
git diff -- dot_config/private_VSCodium/User/settings.json
```

`re-add` 会修改仓库，因此不应在没有看过 `chezmoi diff` 时机械执行。Windows 侧也应先比较当前文件与 source，再只保留可迁移字段。

扩展清单可以从下面的输出中挑选，而不是把全部运行状态写进仓库：

```bash
codium --list-extensions | LC_ALL=C sort -u
```

## 验证与隐私边界

仓库提供的验证脚本会检查 JSON、清单排序、shell 语法和 chezmoi dry run：

```bash
gentoo_setting/scripts/verify.sh pc
# 或
gentoo_setting/scripts/verify.sh wsl
```

提交公开设置前仍应人工检查：

```text
真实用户名和绝对用户目录
服务器 IP、主机名或 SSH 别名
邮箱、账号和平台 handle
API key、token、密码或连接字符串
私有仓库、代理订阅和内部工作区名称
```

即使旧同步仓库是私有的，也不能把已暴露的凭据当作仍然安全。真正的密钥一旦进入不受控制的历史，应先吊销或轮换，再处理缓存和历史引用。

## 旧 Sync Settings 模型如何退场

迁移前应先确认 dotfiles 已经覆盖需要的设置与扩展，然后运行扩展同步脚本的预览。确认无误后，`--apply` 会卸载旧同步扩展。旧私有仓库可以保留一段时间作为只读回退，但不应继续与 chezmoi 双向写入。

如果只是阅读本文旧链接而来，可以把原模型概括为：编辑器插件直接连接私有 Git 仓库，人工选择 Upload 或 Download。它曾经可用，但已经不是当前配置，本文也不再建议为新设备重新建立这条同步链。

## 参考

- [dotfiles：VSCodium synchronization](https://github.com/Cyberl-ty02/dotfiles/blob/main/vscodium/README.md)
- [chezmoi apply](https://www.chezmoi.io/reference/commands/apply/)
- [chezmoi re-add](https://www.chezmoi.io/reference/commands/re-add/)
- [VSCodium 文档](https://docs.vscodium.com/)
