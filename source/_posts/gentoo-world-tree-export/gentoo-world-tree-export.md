---
title: Gentoo world 文件导入导出
comments: false
toc: true
donate: true
share: true
date: 2026-02-21 17:00:49
categories: 实用技巧
tags:
- 技巧
---
在 Gentoo 中，**world** 文件包含用户明确要求安装的软件包。可以从 **world** 文件中提取软件包列表，再在另一台 Gentoo 机器上进行检查和安装。以下是具体步骤。

## 列出 world 文件中的软件包

```shell
# 这将显示 world 文件中的所有软件包。
cat /var/lib/portage/world
```

## 导出 world 文件中的软件包

```shell
# 这将把 world 文件中的软件包列表保存到 world_packages.txt 文件中。
cat /var/lib/portage/world > world_packages.txt
```

## 在另一台 Gentoo 机器上导入并安装软件包：

1. 将 world_packages.txt 文件复制到新机器上。
2. 在新机器上，使用 `emerge --pretend --verbose $(cat world_packages.txt)` 来模拟安装已列出的软件包：

```shell
# 这将显示将要安装的软件包列表，但并不实际执行安装
emerge --pretend --verbose $(cat world_packages.txt)

# 请注意，这样做的前提是 world 文件只包含你明确要安装的软件包，而没有包含它们的依赖关系。
emerge --ask --verbose --update --deep --newuse $(cat world_packages.txt)
```

以下为导出的 `world_packages.txt` 示例文件：

```bash
# 示例目录
app-admin/chezmoi-bin
app-admin/doas
app-admin/eclean-kernel
app-admin/sysklogd
app-editors/emacs
app-eselect/eselect-repository
app-misc/cpufetch
app-misc/fastfetch
app-misc/resolve-march-native
app-misc/sl
app-misc/yazi
app-portage/eix
app-portage/gentoolkit
dev-python/pyyaml
dev-python/uv
app-shells/thefuck
app-shells/zsh
app-text/typst
dev-build/ninja
dev-build/xmake
dev-db/postgresql
dev-java/openjdk-bin
dev-lang/rust-bin
dev-util/pixi
dev-util/pkgconf
llvm-core/lld
llvm-core/lldb
llvm-core/llvm
media-fonts/nerdfonts
media-fonts/noto-cjk
sys-apps/fd
sys-apps/pnpm
sys-apps/ripgrep
sys-boot/grub
sys-kernel/genkernel
sys-kernel/installkernel
sys-kernel/linux-firmware
sys-kernel/xanmod-kernel
sys-process/btop
sys-process/cronie
```

如果 **world** 文件包含了不想继续保留的软件包，可能需要手动编辑文件，只保留你明确要安装的软件包。执行实际安装前，建议先用 pretend 模式检查依赖关系和 USE 变化。
