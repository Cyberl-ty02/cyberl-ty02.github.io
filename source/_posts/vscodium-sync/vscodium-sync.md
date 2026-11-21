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

脚本补齐清单中缺少的扩展，并定向移除 extensions-excluded.txt 中已被替换的旧组合及本机不适用的平台项。卸载扩展包可能连带移除成员，因此会重新读取有效索引，再补回明确选择的功能；安装时不让大包自动带回冲突依赖。未列入排除清单的其他本机扩展不会一概清除。

## Windows：保留平台差异

Windows 使用 `windows_setting/` 作为独立 chezmoi source，并由该目录的引导脚本部署设置。通用编辑器行为与 Gentoo 尽量一致，但终端 profile、Remote WSL 和 PowerShell 等平台项目留在 Windows 侧维护。

不要为了让两个 `settings.json` 字节一致而删除合理差异。跨平台同步的目标是共享格式化、语言、Git、主题、安全和遥测策略，而不是假装两个系统具有相同路径和命令。

扩展可以单独同步，无需执行完整 Windows bootstrap：

```powershell
.\vscodium\sync-extensions.ps1
.\vscodium\sync-extensions.ps1 -Apply
```

默认预览，确认后显式应用。Windows 源文件已同步，Windows 实机执行仍需在该系统验收。

## Java 21 与 IDE 组件

当前 Java 路线使用 Oracle Java、Maven for Java、Gradle for Java 和 Spring Initializr，所有 JVM 保持 Dragonwell Standard 21。新 Java 大包带来的 Red Hat 语言服务器要求 JDK25，因此不继续混装其 JDT 后端。Maven archetype、Gradle 项目生成和 Spring Initializr 提供更多模板，Kotlin 暂缓；各模板的实际项目依赖仍由项目自己的 wrapper 和构建文件决定。

Gentoo 的 Maven 由 Portage 安装，VSCodium Flatpak 通过包内 host-spawn 调用宿主 Maven，不混用宿主 musl 与 SDK 的库。已用合成项目验证模板生成、Java21 编译和 JUnit。Maven 的代理需要本机私有 ~/.m2/settings.xml，不能只依赖 shell 的 HTTP_PROXY；国内镜像优先配置与官方回退也留在本机，不上传代理、凭据或真实项目。

Python 采用 Pyright、Ruff、Black、debugpy、环境管理和 Jupyter，保留 Django/Jinja、docstring 等独立功能；重复的 Flake8/isort 与旧大包移除。Rust 使用 rust-analyzer 的原生测试视图，保留 TOML，替代旧测试适配器组合。共享配置明确 Java formatter 和 Rust 测试视图，避免依赖安装顺序决定行为。

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
