---
title: Doom Emacs 安装、同步与清理
comments: true
toc: true
donate: false
share: true
date: 2025-01-07 11:42:15
categories: 开发工具
tags:
- Linux
- 开发工具
---

这篇文章最初只整理 Windows 下的 Doom Emacs 命令，后来曾因主力编辑器切换而归档。2026-10-13，Gentoo PC 与 WSL 已重新启用 Doom Emacs，因此本文恢复维护，并以当前 Linux 配置为主；旧 Windows 布局留在后文作为历史参考。

> **当前核验状态**
> 真机安装 `app-editors/emacs-31.1-r1`，Doom 框架位于 `~/.config/emacs`，私人配置位于 `~/.config/doom`；shell 的 `EDITOR`、`VISUAL` 和 `PATH` 均已切换到这套布局。`~/.emacs.d` 与 `~/.doom.d` 当前都不存在。

## 当前目录边界

```text
~/.config/emacs   Doom 框架、包、生成状态与 bin/doom
~/.config/doom    可审阅的私人配置
~/.local/share    可能存在的 Doom/Emacs 用户数据
~/.local/state    可能存在的 Emacs 运行状态
~/.cache/emacs    可重新生成的缓存
```

dotfiles 只维护 `~/.config/doom` 中的 `init.el`、`config.el`、`custom.el` 和 `packages.el`。框架 checkout 与生成状态属于每个账户，普通用户和 root 不共享可写目录；root 的配置也会复制为 root 自己拥有的文件，避免以管理员权限执行普通用户可改写的代码。

## 在 Gentoo 中部署

当前 world 与 `manifests/core.txt` 都选择 `app-editors/emacs`。安装 Emacs 后，在 dotfiles 根目录运行：

```bash
gentoo_setting/scripts/deploy-doom.sh
```

脚本会把已审核的私人配置部署到 `~/.config/doom`。如果 `~/.config/emacs` 尚不存在，它会浅克隆 Doom；如果路径已经存在但不是 Git checkout，脚本会拒绝覆盖。

需要为 root 建立完全独立的框架、包和状态时：

```bash
gentoo_setting/scripts/deploy-doom.sh --root
```

升级 Doom 自身及其管理的包后再同步：

```bash
gentoo_setting/scripts/deploy-doom.sh --upgrade
```

不要让 root 直接加载普通用户可写的 `~/.config/emacs` 或 `~/.config/doom`。

## 日常命令

修改 `init.el` 或 `packages.el` 后运行：

```bash
doom sync
```

排查配置与外部工具：

```bash
doom doctor
```

跟随 Doom 上游并更新其管理的包：

```bash
doom upgrade
```

当前配置使用 Doom One、Evil、Corfu、Vertico、Magit、Org、Markdown 与 shell 模块。终端编辑缓冲区继承终端背景，但 GUI frame 与 dashboard 保留主题背景；机器身份和本机私有路径不写进共享配置。

## 完整清理

下面的命令会永久删除文件。先关闭所有 Emacs/Doom 进程，并确认没有未保存的 buffer。框架和缓存可以重建，`~/.config/doom` 或旧的 `~/.doom.d` 却可能包含唯一的私人配置，不能在没有备份时删除。

先列出实际存在的目录：

```bash
ls -ld \
  ~/.config/emacs ~/.config/doom \
  ~/.emacs.d ~/.doom.d \
  ~/.cache/emacs \
  ~/.local/share/doom ~/.local/share/emacs \
  ~/.local/state/emacs \
  2>/dev/null
```

### 删除当前 Doom 主程序

当前布局的主程序目录是：

```bash
rm -rf -- ~/.config/emacs
```

如果使用的是旧布局，主程序才可能位于：

```bash
rm -rf -- ~/.emacs.d
```

### 删除可重新生成的数据与缓存

不同 Emacs/Doom 版本可能使用其中一部分目录；只删除上一步已经核对过的路径：

```bash
rm -rf -- ~/.cache/emacs
rm -rf -- ~/.local/share/doom
rm -rf -- ~/.local/share/emacs
rm -rf -- ~/.local/state/emacs
```

### 删除私人配置

如果希望以后恢复当前配置，先建立一份不与目标重名的备份：

```bash
test ! -e ~/doom-config-backup && \
  cp -a -- ~/.config/doom ~/doom-config-backup
```

确认备份可读后，才删除当前私人配置：

```bash
rm -rf -- ~/.config/doom
```

旧环境还可能使用 `~/.doom.d`；同样只有在确认已备份或不再需要时才清理：

```bash
rm -rf -- ~/.doom.d
```

删除这些目录不会从 Gentoo world 移除 Emacs。若还要卸载软件包，应先用 `emerge --deselect app-editors/emacs` 调整显式选择，再预览依赖清理；本文不建议自动执行真实 `depclean`。

## Windows 旧布局参考

早期 Windows 配置把 Doom 放在 `%APPDATA%\.emacs.d`，并为用户目录创建 junction：

```powershell
mklink /j "C:\Users\USER\.emacs.d" "C:\Users\USER\AppData\Roaming\.emacs.d"
git clone https://github.com/doomemacs/doomemacs `
  "C:\Users\USER\AppData\Roaming\.emacs.d"
```

然后在 PowerShell 中执行：

```powershell
cd "C:\Users\USER\AppData\Roaming\.emacs.d"
.\bin\doom install
.\bin\doom sync
.\bin\doom doctor
.\bin\doom upgrade
```

这部分不代表当前 Windows dotfiles：目前 Windows 仍保留独立 Neovim 配置，Gentoo 的 Doom 部署脚本不会操作 Windows 用户目录。

## 参考

- [Doom Emacs Getting Started](https://github.com/doomemacs/core/blob/master/docs/getting_started.org)
- [dotfiles：Doom Emacs configuration](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_config/doom/README.md)
- [dotfiles：deploy-doom.sh](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/scripts/deploy-doom.sh)
