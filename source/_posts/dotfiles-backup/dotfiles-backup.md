---
title: 配置文件备份
comments: true
toc: true
donate: false
share: true
date: 2025-01-07 11:43:31
categories: 开发工具
tags:
- 开发工具
- 系统维护
---

本文保留几份常用配置片段。当前维护中的完整配置以 [Cyberl-ty02/dotfiles](https://github.com/Cyberl-ty02/dotfiles) 仓库为准；下方每节标题直接指向对应文件。部分片段自 2025 年初写下后已经与当前配置不同，相关位置会明确标为历史或最小示例。

## [Doom Emacs](https://github.com/Cyberl-ty02/dotfiles/tree/main/dot_config/doom)

2026-10-13 核验时，Gentoo PC 运行 Emacs 31.1-r2，Doom 框架位于 `~/.config/emacs`，私人配置位于 `~/.config/doom`，shell 的 `EDITOR` 与 `VISUAL` 也已切换为 Emacs。仓库保留的 WSL world 与 `manifests/core.txt` 同样选择 `app-editors/emacs`，但 WSL 当前没有安装，这些文件只是以后重建的输入。

仓库只保存可审阅的 Doom 配置；框架 checkout、包、缓存和生成状态仍按账户隔离。普通用户可运行：

```bash
gentoo_setting/scripts/deploy-doom.sh
```

root 使用 `--root` 部署同一份已审核的私人配置内容，但文件由 root 自己拥有，框架、插件、缓存与生成状态也保持账户隔离。脚本使用官方 `doomemacs/core`，并在同步后逐个比较受管文件；需要跟随 Doom 上游时显式加入 `--upgrade`，普通同步不会在背后更新框架。

Windows 已部署并验证 Scoop Emacs 31.1。Doom 框架与生成状态位于 `%APPDATA%\.emacs.d`，`%APPDATA%\.config\doom` 联接到仓库的 `dot_config\doom`；PowerShell、Git Bash、Git 与 Yazi 通过 `~/.local/bin` 中的包装器调用它。`dot_config/nvim`、Windows Neovim 安装入口以及本机配置和缓存已经清理，不再作为迁移或回滚输入；这不等同于确认 Neovim 程序本体已经卸载。

## [chezmoi 用户配置层](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/README.md)

仓库根目录现在是 Gentoo PC 与 WSL 共用的 chezmoi source，管理 Doom 私人配置、Zsh、Git 通用选项和开发工具配置；Windows 使用 `windows_setting/` 作为独立 source。身份、SSH/GPG 私钥、Secure Boot 私钥、桌面会话和数据库运行状态都不进入仓库。

配置按作用域分层，而不是把整台机器的 `/etc` 与 home 混为一份备份：

| 层级 | 内容 | 共享边界 |
| --- | --- | --- |
| Gentoo PC 当前配置 | LLVM profile、SonicDE、NVIDIA、Secure Boot、binhost | 当前实体机角色，人工审核后部署 |
| WSL 保留配置 | WSL profile、独立 binhost、硬件 mask、world 与 `wsl.conf` | 当前未安装，只作未来重建输入，不覆盖 PC |
| Windows 已部署配置 | PowerShell loader、Doom 包装器、Terminal Fragment、Yazi 与 VSCodium 设置 | 由独立的 `windows_setting/` source 管理 |
| 角色清单 | core、development、desktop、nvidia、pc-host、wsl、optional | 用于预览和按需恢复 |
| 跨平台用户配置 | Doom、Git 通用选项与开发工具镜像 | 按平台选择性复用，不覆盖系统策略 |
| 每机生成状态 | Doom 框架、插件缓存、数据库、桌面会话和编辑器缓存 | 每个账户/机器独立，不入库 |

默认命令只做 dry run：

```bash
gentoo_setting/scripts/bootstrap-user.sh
```

阅读差异后再交互式应用：

```bash
gentoo_setting/scripts/bootstrap-user.sh --apply
```

VSCodium 设置也由这一层部署；扩展清单集中在 [`vscodium/`](https://github.com/Cyberl-ty02/dotfiles/tree/main/vscodium)，不再依赖编辑器内的第三方 Sync Settings 插件。

## [Gentoo 角色清单](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/manifests)

新系统不应默认一次安装整份 PC 或 WSL world。当前仓库将可选软件拆为 core、development、desktop、nvidia、pc-host、wsl 与 optional；每份清单都只用于显式预览和选择，不会自行修改系统。

```bash
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/core.txt
```

完整 `world_packages.txt` 仍用于审计或复原既有机器。2026-10-13 核验时，真机 world 与 PC 清单逐行一致，共 92 项；这只是当前快照，不代表另一台机器应复制相同数量。

## [开发工具镜像配置](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/development_mirrors)

2026-09-01 起，Bun/npm、pip/uv、Cargo、Go 与 Pixi 的用户级镜像说明集中在 `gentoo_setting/development_mirrors/`，实际 chezmoi 模板则位于仓库根目录；说明表与模板必须同时更新。这样可以复用开发工具配置，又不会把 PC 与 WSL 的 Portage 文件错误合并：两套系统使用不同 profile 和 binhost，仍分别保存在 `gentoo_setting/pc/portage/` 与 `gentoo_setting/wsl/portage/`。

目录中的 [README](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/development_mirrors/README.md) 记录了目标路径、部署方式和临时切回官方源的命令。公开备份时只保存 registry/index 地址，不应提交 npm token、PyPI 凭据、私有仓库地址或代理订阅。

Portage 主树目前首选 USTC Git，CERNET 是需注意 dumb HTTP/完整历史限制的备用；官方 Git 排在可能排队的 TUNA 之前。distfiles 按 USTC、华为、阿里、官方、TUNA 回退。LinuxMirrors 只用于参考镜像列表，不直接接管这套已分层并保留签名验证的配置。Portage、pip/uv、Cargo、Bun/npm 与 Git 使用不同协议和配置文件，不能用一个“全局换源”动作等同处理。

## Portage 文件维护规则

当前配置采用以下整理约定：

- 同级文件名按 `0-9`、`a-z` 排序，包条目按 `category/package` 排序；
- 同一 atom 的正 USE 在前、负 USE 在后，并保留在同一行；
- 注释跟随其解释的规则，不机械合并会改变覆盖顺序或 Portage 行为的条目；
- 精确版本限制只用于已经确认的过渡或兼容问题，不在全局启用 `~amd64` 或无边界的 `*/*`；
- 不把仍受依赖保护的多版本 Rust、Python、Fcitx 或工具链槽位一律视为残余；
- 真机 `/var/lib/portage/world` 是 PC `world_packages.txt` 的权威来源；真实清理前先运行 pretend 并审查候选，不自动执行全局 `depclean`。

`eix-sync` 还需要稳定解析 Portage Git 时间戳。PC 与 WSL 的 `eix-sync.conf` 都在命令内部设置 `LC_ALL=C.UTF-8`，使 `su`、`doas` 和直接 root 会话不依赖中文日期格式；这是一项针对当前 Portage 时间戳解析行为的兼容设置，后续仍应随着上游实现复核。

## [`doas.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/doas_dot_conf)

当前文件仍保留 wheel 组的 `persist`，并允许指定用户免密码执行重启与关机。早期片段还曾免密开放 `eix-sync`；当前配置已经把这一行注释，因此下面同步为现状：

```conf
# Do not require passwords for five minutes for all users in the wheel group
permit persist :wheel

# Allow a user to use the reboot command without a password
permit nopass user cmd reboot
permit nopass user cmd shutdown
# permit nopass user cmd eix-sync
```

用户名属于本机策略，复制前应改成自己的账户或使用更合适的规则。

## [`wsl.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/wsl/wsl.conf)

仓库仍维护未来 Gentoo OpenRC WSL 重建可使用的 [`/etc/wsl.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/wsl/wsl.conf)。当前没有安装 Gentoo WSL，因此下面是保留配置的语义，不是运行状态核验。它保持启动简单，不默认拉起完整 OpenRC，并明确配置 automount、interop、用户和网络行为：

```ini
[boot]
systemd = false
# command = /sbin/openrc default

[automount]
enabled = true
root = /mnt/
options = "metadata,umask=22,fmask=11"
mountFsTab = false

[interop]
enabled = true
appendWindowsPath = false

[user]
default = user

[network]
generateHosts = true
generateResolvConf = true
```

公开模板中的用户名仍应按本机情况修改。WSL/Gentoo 的通用说明可参考 [Gentoo Wiki 的 Gentoo in WSL 文档](https://wiki.gentoo.org/wiki/Gentoo_in_WSL)，各字段语义则见 [Microsoft WSL 配置文档](https://learn.microsoft.com/windows/wsl/wsl-config)。

## [`.zimrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zimrc)

最初文章只记录了 Powerlevel10k：

```zsh
zmodule romkatv/powerlevel10k
```

这行仍存在，但当前 [`.zimrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zimrc) 还加载 environment、git、completion、syntax highlighting、history substring search 和 autosuggestions 等模块。因此这里的单行内容只是历史最小片段，不等同于完整现行文件。

## [`.zshrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zshrc)

早期版本把地址和端口直接写进函数。当前 [`.zshrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zshrc) 允许通过参数或环境变量覆盖 host、HTTP 与 SOCKS 端口，并同时处理大小写代理变量：

```zsh
proxy() {
    local proxy_host="${1:-${PROXY_HOST:-127.0.0.1}}"
    local http_port="${2:-${PROXY_HTTP_PORT:-2080}}"
    local socks_port="${3:-${PROXY_SOCKS_PORT:-${http_port}}}"

    export http_proxy="http://${proxy_host}:${http_port}"
    export https_proxy="${http_proxy}"
    export all_proxy="socks5h://${proxy_host}:${socks_port}"
    export HTTP_PROXY="${http_proxy}"
    export HTTPS_PROXY="${https_proxy}"
    export ALL_PROXY="${all_proxy}"
    export no_proxy="${NO_PROXY:-localhost,127.0.0.1,::1}"
    export NO_PROXY="${no_proxy}"
}

nproxy() {
    unset http_proxy https_proxy all_proxy no_proxy
    unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
}
```

完整函数还包含状态提示，以仓库文件为准。代理地址与端口是本机选择，不应当被理解为通用默认值。
