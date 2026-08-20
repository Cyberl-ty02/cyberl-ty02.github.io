---
title: Gentoo 内核迁移记录：XanMod、CJKTTY、NVIDIA 与 Secure Boot
comments: true
toc: true
donate: true
share: true
date: 2026-08-09 20:00:00
categories: 实用技巧
tags:
- 技巧
- Gentoo
- XanMod
- CJKTTY
- Secure Boot
---

这篇文章最初记录从 `sys-kernel/xanmod-kernel-7.1.6` 迁移到 Gentoo-Zh `sys-kernel/gentoo-cjk-kernel-7.1.7` 的过程；当时 `7.1.7-gentoo-cjk-dist`、NVIDIA、Secure Boot 和 Linux VT 中文显示均已实际验证。Gentoo-Zh 后来重新为 `sys-kernel/xanmod-kernel` 加入 CJKTTY，本机因此在 2026-08-20 开始切回 XanMod。本文保留第一次迁移的历史证据，同时补记反向迁移，避免把已经变化的包选择写成永久结论。

> **版本说明**
> 文中的 `7.1.7` 对应 2026-08-09 已完成的迁移；`xanmod-kernel-7.1.9` 对应 2026-08-20 的反向迁移，实际运行 release 为 `7.1.9-x64v3`。设备标识和 UUID 均已省略或使用占位值。

较早的 Btrfs 与 rEFInd 救援过程见：[Gentoo 在 Btrfs 与 rEFInd 环境下的启动修复记录](/posts/gentoo-refind-btrfs-rescue/gentoo-refind-btrfs-rescue/)。本文从系统已经稳定可启动的状态继续，重点记录换内核时如何保留回退路径并验证外围模块。

## 2026-08-20：切回带 CJKTTY 的 XanMod

这次回切不是放弃 CJKTTY。同步后的 Gentoo-Zh overlay 已提供 `sys-kernel/xanmod-kernel-7.1.9`，ebuild 描述明确包含 Gentoo patches 与 CJKTTY，继承 `cjktty` eclass，并在准备源码时调用 `cjktty_apply_patches`。其 `cjk` USE 会启用 16×16 CJK 字体；`cjk32` 还会加入约 8 MiB 的 32×32 字体数据，当前配置没有启用后者。

先以本机仓库和 Portage 计划核实，不能只依据文章中的版本号：

```bash
eix sys-kernel/xanmod-kernel
emerge -pv sys-kernel/xanmod-kernel
grep -R --line-number 'cjktty\|cjktty_apply_patches' \
  /var/db/repos/gentoo-zh/sys-kernel/xanmod-kernel
```

本次 `emerge -pv` 计划的关键部分为：

```text
sys-kernel/xanmod-kernel-7.1.9::gentoo-zh
USE="cjk clang initramfs modules-sign secureboot strip -cjk32 -savedconfig"
virtual/dist-kernel-7.1.9-r100::gentoo-zh
```

对应的公开配置把 XanMod 写入 world，并将签名与构建环境绑定到它：

```text
world_packages.txt:                 sys-kernel/xanmod-kernel
package.use/secureboot:             sys-kernel/xanmod-kernel cjk clang
package.env/secureboot:             sys-kernel/xanmod-kernel ... secureboot_key_access
```

安装或更新时先保留当前可启动的 CJK distribution kernel，不在构建过程中卸载它：

```bash
uname -r
eselect kernel list
emerge -pv sys-kernel/xanmod-kernel x11-drivers/nvidia-drivers
emerge --ask sys-kernel/xanmod-kernel
```

构建完成后仍不能立即把“已安装”写成“迁移成功”。先检查新内核、initramfs、模块树和签名，并确认 rEFInd 没有硬编码旧 release：

```bash
ls -l /boot/vmlinuz-* /boot/initramfs-*.img
ls -ld /lib/modules/*
eselect kernel list
XANMOD_RELEASE='replace-with-release-from-lib-modules'
XANMOD_IMAGE='/boot/vmlinuz-replace-with-exact-filename'
sbverify --list "${XANMOD_IMAGE}"
modinfo -k "${XANMOD_RELEASE}" -F signer nvidia
sed -n '1,120p' /boot/refind_linux.conf
```

将两个 `replace-with-...` 值分别替换为 `/lib/modules` 中实际生成的 release 和 `/boot` 中的精确文件名。重启后至少验证：

```bash
uname -r
mokutil --sb-state
nvidia-smi
modinfo -F signer nvidia
```

本次重启后的实际检查结果为：

```text
uname release：7.1.9-x64v3
Secure Boot：enabled
内核 PE 签名：存在
NVIDIA 模块：针对 7.1.9-x64v3 构建且带签名
NVIDIA 运行态：GeForce RTX 4060 Laptop GPU，驱动 610.57.04
rEFInd：没有旧 release 或 LiveCD 参数硬编码
CJKTTY 静态配置：CONFIG_FONT_CJK_16x16=y
```

Linux VT 中文显示仍应由用户切换到真实 VT 目视确认，因为图形会话和自动化检查不能替代 framebuffer console 的实际输出。当前旧 CJK kernel 已从包数据库和 `/boot` 清除，只保留 XanMod 的版本化内核与 initramfs；因此后续升级应先保留这份已知可启动的 XanMod，再测试下一版本，不能在新版本验证前重复清空回退文件。

以下章节保留 2026-08-09 从 XanMod 切到独立 CJK kernel 的原始过程，供比较和回退时参考。

## 2026-08-09 历史阶段：NVIDIA 重建不是故障

Portage 预览中出现了 distribution-kernel subslot 迁移：

```text
virtual/dist-kernel:0/7.1.6
→
virtual/dist-kernel:0/7.1.7
```

已安装的 `x11-drivers/nvidia-drivers` 启用了：

```text
dist-kernel
modules
modules-sign
```

它因此绑定旧的 `virtual/dist-kernel` subslot。当内核提供的 subslot 从 7.1.6 变化到 7.1.7 时，Portage 提议重建 NVIDIA 驱动，这是 slot operator dependency 正常触发的重建，不是 NVIDIA 已经损坏的证据。真正要确认的是新内核安装完成后，模块是否针对相同的 kernel release 构建并签名。

## 先给唯一可启动内核留下退路

迁移前机器上只有一个物理可启动内核。为了避免把“换包”变成一次不可回滚的启动实验，我采用了下面的顺序：

```text
用 quickpkg 备份 xanmod-kernel 包
备份旧 /boot 内核和 initramfs 文件
备份旧 /lib/modules 目录
备份 savedconfig
从 world 移除 XanMod
unmerge XanMod 包
暂时保留磁盘上的旧内核、initramfs 和 modules
安装 gentoo-cjk-kernel
重启前验证新内核文件、模块和签名
成功启动后才清理旧物理文件
```

之所以先从 Portage 状态中移除旧包、却暂时保留可启动文件，是为了让依赖解析干净地切换到新的 dist-kernel，同时继续保有 rEFInd 可加载的旧入口。它适合当时“只有一个 fallback”的实际条件，并不是 Gentoo 更换内核的唯一方法。

执行危险步骤前，应先用 `quickpkg`、`ls -l /boot`、`ls -l /lib/modules` 和 `eselect kernel list` 确认备份与目标。备份目录属于本机恢复策略，本文不公开具体路径。

## 安装后的包与内核对应关系

这次迁移确认的包状态为：

```text
sys-kernel/gentoo-cjk-kernel-7.1.7
virtual/dist-kernel-7.1.7-r100
x11-drivers/nvidia-drivers-610.57.04
```

内核源码链接对应：

```text
linux-7.1.7-gentoo-cjk-dist
```

Portage 配置可分别查看 [`package.accept_keywords/hardware`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.accept_keywords/hardware)、[`package.mask/kernel`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.mask/kernel) 与 [`package.use/secureboot`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/secureboot)。这些链接反映本次记录时的当前配置，不能替代另一台机器上的 `emerge -pv` 检查。

## rEFInd 的版本化文件配对

新内核在 `/boot` 中具有成对的版本化文件：

```text
vmlinuz-7.1.7-gentoo-cjk-dist
initramfs-7.1.7-gentoo-cjk-dist.img
```

rEFInd 可以按照版本化命名自动为内核匹配相应 initramfs。稳定配置中的 `refind_linux.conf` 因而只保留通用的 root/Btrfs 参数，不再硬编码某个内核版本。例如真实 UUID 应由本机查询，公开示例只写作：

```conf
"Boot Gentoo Linux" "root=UUID=11111111-1111-1111-1111-111111111111 rw rootfstype=btrfs rootflags=subvol=/@"
```

这种布局让后续版本更新不必重写一条固定版本的 `initrd=`。它是稳定系统中的后续整理，并不否定救援阶段显式指定 initramfs 的价值。

## Secure Boot 与模块签名检查

重启前先检查内核 PE 文件是否包含签名：

```bash
sbverify --list /boot/vmlinuz-7.1.7-gentoo-cjk-dist
```

本次输出确认签名存在，certificate 的 subject/issuer 对应机器本地的 MOK/Secure Boot 签名证书。这里只记录验证结果，不公开私钥、私钥路径或不必要的证书身份信息。

NVIDIA 模块的 signer 使用目标内核版本显式查询：

```bash
modinfo -k 7.1.7-gentoo-cjk-dist -F signer nvidia
```

启动后再确认固件状态：

```bash
mokutil --sb-state
```

最终结果为：

```text
SecureBoot enabled
```

本机将签名密钥读取权限限制在确实需要的包，当前规则见 [`package.env/secureboot`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.env/secureboot) 与 [`env/secureboot_key_access`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/env/secureboot_key_access)。公开仓库只保存规则和脚本，不保存私钥。

## NVIDIA 的启动后验证

进入新内核后，`nvidia-smi` 显示：

```text
NVIDIA-SMI 610.57.04
KMD Version: 610.57.04
```

RTX 4060 Laptop GPU 可见，X server 也已加载 NVIDIA 驱动。这里需要同时满足的并非“命令能运行”这么简单，而是：

```text
当前运行的是新内核
加载的是与用户态版本匹配的 NVIDIA kernel module
Secure Boot 没有拒绝该模块
X server 实际使用 NVIDIA 驱动
```

## CJKTTY 配置与 KXCJK1013 命名陷阱

检查内核配置时确认了这些选项：

```text
CONFIG_CONSOLE_TRANSLATIONS=y
CONFIG_VT_CONSOLE=y
CONFIG_FRAMEBUFFER_CONSOLE=y
CONFIG_FRAMEBUFFER_CONSOLE_DETECT_PRIMARY=y
CONFIG_FRAMEBUFFER_CONSOLE_DEFERRED_TAKEOVER=y
CONFIG_FONT_CJK_16x16=y
CONFIG_EFI_STUB=y
```

搜索配置时还会遇到一个很像 CJKTTY 的名字：

```text
CONFIG_KXCJK1013=m
```

它其实与中文控制台无关，而是 Kionix KXCJK-1013 加速度计驱动。对应模块位于：

```text
kernel/drivers/iio/accel/kxcjk-1013.ko
```

因此不能因为配置名称中出现 `CJK` 就把它当成字体或终端功能。对这次目标真正有意义的静态证据是 `CONFIG_FONT_CJK_16x16=y` 与 framebuffer console 相关选项，最终证据仍然是实际 VT 显示。

## 最终功能验证

重启后：

```bash
uname -r
```

返回：

```text
7.1.7-gentoo-cjk-dist
```

切换到真实 Linux VT 后，中文提示 `请输入密码` 能够直接显示，不再变成缺字方框。这一步才是 CJK 控制台支持的最终成功标准；只看 `.config` 不能替代实际输出验证。

## 2026-08-09 历史阶段：成功启动后再清理

只有在以下四项全部确认后，才用 `eclean-kernel` 清理旧 XanMod 内核文件：

```text
新内核能够启动
NVIDIA 正常工作
Secure Boot 仍为 enabled
CJKTTY 在真实 VT 中正常显示中文
```

包缓存和 distfile 缓存随后另行清理。删除 `/var/cache/distfiles/*` 或 `/var/cache/binpkgs/*` 不是移除旧内核的必要步骤，也不应当作为通用迁移命令。该历史阶段最终只保留 `gentoo-cjk-kernel`、`virtual/dist-kernel` 和 `7.1.7-gentoo-cjk-dist` 的模块树；这不是 2026-08-20 回切 XanMod 后的目标状态。

## 两次迁移中的 Portage 配置卫生

2026-08-09 切到独立 CJK kernel 后，曾从 `package.accept_keywords`、`package.env` 和 `package.use` 中移除 XanMod 项，并把签名密钥访问范围收窄到 `gentoo-cjk-kernel`。2026-08-20 的方向相反：当前公开配置重新把 `sys-kernel/xanmod-kernel` 写入 `world_packages.txt`，恢复其关键字、`cjk clang` USE 和签名环境，并 mask 不再选用的独立 CJK/官方 distribution kernel。相关文件应以 [`Cyberl-ty02/dotfiles`](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc) 的当前版本和本机 `emerge -pv` 结果为准。

旧 CJK kernel 在 XanMod 完成重启验证前仍是回退项，因此不应提前从包数据库、ESP 或 `/lib/modules` 删除。若旧 `virtual/dist-kernel` 精确 subslot 阻挡迁移，应先阅读 Portage 依赖计划，并准备不受 unmerge 影响的物理回退文件；不能仅为让 resolver 通过就删掉当前唯一可启动内核。Secure Boot 工具与公开示例集中在 [`kernel/secureboot`](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/kernel/secureboot)。

这部分只是迁移后的配置卫生：先验证新系统，再删除旧规则和回退文件，避免把“清理得很干净”放在“确认能够启动”之前。
