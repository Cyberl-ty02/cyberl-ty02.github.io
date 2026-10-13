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
> 真机安装 `app-editors/emacs-31.1-r2`，Doom 框架位于 `~/.config/emacs`，私人配置位于 `~/.config/doom`；shell 的 `EDITOR`、`VISUAL` 和 `PATH` 均已切换到这套布局。框架 origin 已统一为官方 `https://github.com/doomemacs/core`，`~/.emacs.d` 与 `~/.doom.d` 当前都不存在。

## 当前目录边界

```text
~/.config/emacs   Doom 框架、包、生成状态与 bin/doom
~/.config/doom    可审阅的私人配置
~/.local/share    可能存在的 Doom/Emacs 用户数据
~/.local/state    可能存在的 Emacs 运行状态
~/.cache/emacs    可重新生成的缓存
```

dotfiles 只维护 `~/.config/doom` 中的 `init.el`、`config.el`、`custom.el`、`packages.el` 和说明文件。普通用户与 root 使用同一份经过审阅的私有配置内容，但部署后分别由各自账户拥有；Doom 框架、插件 checkout、缓存和生成状态也各自独立，root 不会执行普通用户可改写的目录。

这也解释了目录大小的差异。2026-10-13 的真机快照中，私有配置约 20 KiB，普通用户的 Doom 框架和插件约 424 MiB；前者适合进入 Git，后者数百 MiB 属于可重建状态，不应连同编译缓存一起同步。

## 在 Gentoo 中部署

当前 world 与 `manifests/core.txt` 都选择 `app-editors/emacs`。安装 Emacs 后，在 dotfiles 根目录运行：

```bash
gentoo_setting/scripts/deploy-doom.sh
```

脚本会把已审核的私人配置部署到 `~/.config/doom`。如果 `~/.config/emacs` 尚不存在，它会从 `doomemacs/core` 浅克隆 Doom；如果路径已经存在但不是 Git checkout，或 origin 是无法识别的个人 fork，脚本会拒绝覆盖。旧的 `doomemacs/doomemacs` 与 `hlissner/doom-emacs` origin 会迁移到当前官方地址。

需要为 root 建立完全独立的框架、包和状态时：

```bash
gentoo_setting/scripts/deploy-doom.sh --root
```

升级 Doom 自身及其管理的包后再同步：

```bash
gentoo_setting/scripts/deploy-doom.sh --upgrade
```

不要让 root 直接加载普通用户可写的 `~/.config/emacs` 或 `~/.config/doom`。

root 初次恢复时曾因为私有配置没有完整部署——包括缺少 `custom.el` 或同步未完成——导致启动页与普通用户不一致。当前脚本会复制并逐个比较全部受管文件，再运行 `doom sync --env`；这次问题已经通过重新部署解决，不应继续描述成 Doom 插件安装失败。自定义行为只放在私有配置层，不直接修改 `~/.config/emacs` 中的上游框架。

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

从 Neovim 保留下来的通用习惯——相对行号、分屏方向、回收站删除和少确认提示等——已经改写为 Emacs Lisp。Linux 目标配置不再依靠一份 Neovim 中间层维持映射关系。

### 如何理解 `doom doctor` 提示

`doom doctor` 会同时检查 Doom、启用模块和外部命令。Symbola 字体、Markdown 编译器、`shellcheck` 缺失或 `PATH changed` 一类提示，应按对应功能判断是否需要处理；它们不等同于 Doom 框架或插件没有安装。真正的同步检查仍包括：

```bash
git -C ~/.config/emacs remote get-url origin
doom sync --env
doom doctor
emacs --batch --eval \
  '(message "user-emacs-directory=%s" user-emacs-directory)'
```

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

## Windows 迁移边界

Windows 的目标是由 Scoop 安装 Emacs，并复用同一份 Doom 私有配置；具体 shim、Emacs Client 和 GUI 启动方式必须由能够访问 Windows 真机的线程验证。现有 Windows Neovim/LazyVim 文件只是迁移交接与回滚输入，不是最终跨平台方案；Linux 侧不会在 Windows 验收之前提前删除它们。

Windows 也应使用官方 `doomemacs/core`，但不能把 Linux 的框架、包 checkout 或缓存直接复制过去。Doom 官方 FAQ 同样建议跨机器同步私有配置而非整个框架目录，因为生成文件和字节码可能包含系统及路径差异。

## 参考

- [Doom Emacs Getting Started](https://github.com/doomemacs/core/blob/master/docs/getting_started.org)
- [Doom Emacs FAQ](https://github.com/doomemacs/core/blob/master/docs/faq.org)
- [dotfiles：Doom Emacs configuration](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_config/doom/README.md)
- [dotfiles：deploy-doom.sh](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/scripts/deploy-doom.sh)
