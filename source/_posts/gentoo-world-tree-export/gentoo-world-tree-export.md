---
title: gentoo-world-tree-export
comments: true
toc: true
donate: true
share: true
date: 2025-01-07 11:40:51
categories: 实用技巧
tags:
- 技巧
---

在 Gentoo 中，**world** 文件包含了用户明确要安装的软件包。你可以使用 *grep* 命令来从 **world** 文件中提取软件包列表。以下是具体步骤

## 列出world内的软件包：

```shell
# 这将显示 world 文件中的所有软件包。
cat /var/lib/portage/world
```

## 导出world内的软导件包到文件：

```shell
# 这将把 world 文件中的软件包列表保存到 world_packages.txt 文件中。
cat /var/lib/portage/world > world_packages.txt
```

## 在另一台 Gentoo 机器上导入并安装软件包：

1. 将 world_packages.txt 文件复制到新机器上。
2. 在新机器上，使用 emerge --pretend --verbose $(cat world_packages.txt) 来模拟安装已列出的软件包：

```shell
# 这将显示将要安装的软件包列表，但并不实际执行安装
emerge --pretend --verbose $(cat world_packages.txt)

# 请注意，这样做的前提是 world 文件只包含你明确要安装的软件包，而没有包含它们的依赖关系。
emerge --ask --verbose --update --deep --newuse $(cat world_packages.txt)
```

以下为导出来的world_packages.txt示例文件

```shell
# 示例目录
app-admin/chezmoi
app-admin/doas
app-admin/eclean-kernel
app-admin/syslog-ng
app-antivirus/clamav
app-antivirus/clamtk
app-backup/timeshift
app-editors/emacs
app-editors/nano
app-editors/vscode
app-eselect/eselect-repository
app-i18n/fcitx-configtool:5
app-i18n/fcitx-gtk:5
app-i18n/fcitx-qt:5
app-i18n/fcitx:5
app-laptop/laptop-mode-tools
app-misc/fastfetch
app-misc/github-desktop-bin
app-misc/sl
app-misc/wayland-utils
app-misc/yazi
app-office/wps-office
app-portage/eix
app-portage/gentoolkit
app-shells/zsh
app-text/aha
app-text/ghostscript-gpl
app-text/tree
app-text/typst
app-xemacs/emerge
dev-build/cmake
dev-build/ninja
dev-build/xmake
dev-java/openjdk
dev-lang/rust
dev-libs/openssl
dev-python/pkgconfig
dev-util/clinfo
dev-util/pkgconf
dev-util/vulkan-tools
dev-vcs/git
games-board/gnuchess
kde-apps/ark
kde-apps/bovo
kde-apps/dolphin
kde-apps/filelight
kde-apps/incidenceeditor
kde-apps/kde-apps-meta
kde-apps/kfind
kde-apps/kmahjongg
kde-apps/knights
kde-apps/konsole
kde-apps/kwalletmanager
kde-apps/yakuake
kde-plasma/discover
kde-plasma/plasma-firewall
kde-plasma/plasma-meta
kde-plasma/print-manager
mail-client/thunderbird
media-fonts/noto-cjk
media-gfx/flameshot
media-gfx/krita
media-gfx/plantuml
media-libs/freetype
media-sound/mpg123
media-sound/yesplaymusic-bin
net-firewall/firewalld
net-fs/samba
net-im/telegram-desktop-bin
net-im/tencent-qq
net-im/wemeet
net-misc/chrony
net-misc/networkmanager
net-misc/openssh
net-p2p/ktorrent
net-print/cups-meta
net-print/gutenprint
net-proxy/v2rayA
net-wireless/iwd
sys-apps/merge-usr
sys-apps/pnpm
sys-apps/proot
sys-apps/usb_modeswitch
sys-block/partitionmanager
sys-boot/grub
sys-boot/os-prober
sys-devel/clang
sys-fs/btrfs-progs
sys-kernel/dracut
sys-kernel/genkernel
sys-kernel/installkernel
sys-kernel/linux-firmware
sys-kernel/xanmod-kernel
sys-kernel/xanmod-rt-sources
sys-libs/compiler-rt-sanitizers
sys-process/btop
www-client/firefox
x11-apps/mesa-progs
x11-apps/xdpyinfo
x11-misc/sddm
```

如果 **world** 文件包含***依赖关系***，你可能**需要手动编辑文件**，只保留你明确要安装的软件包。确保在执行实际安装之前检查可能的依赖关系和其他变化。
