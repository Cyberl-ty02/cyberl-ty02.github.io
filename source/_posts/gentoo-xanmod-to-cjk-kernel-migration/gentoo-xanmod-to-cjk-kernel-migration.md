---
title: Gentoo 从 XanMod 迁移到 CJKTTY 内核：dist-kernel、NVIDIA 与 Secure Boot 实战
comments: true
toc: true
donate: true
share: true
date: 2026-08-09 20:00:00
categories: 实用技巧
tags:
- 技巧
---

这次内核迁移把机器上唯一由包管理器安装的 `sys-kernel/xanmod-kernel-7.1.6` 替换为 Gentoo-Zh 提供的 `sys-kernel/gentoo-cjk-kernel-7.1.7`。最终启动的是 `7.1.7-gentoo-cjk-dist`，NVIDIA 模块、Secure Boot 和 Linux VT 中文显示都完成了实际验证。

> **版本说明**
> 文中的版本只对应 2026-08-09 记录的这次迁移，不表示其他时间或其他机器应选择同一版本。设备标识和 UUID 均已省略或使用占位值。

较早的 Btrfs 与 rEFInd 救援过程见：[Gentoo 在 Btrfs 与 rEFInd 环境下的启动修复记录](/posts/gentoo-refind-btrfs-rescue/gentoo-refind-btrfs-rescue/)。本文从系统已经稳定可启动的状态继续，重点记录换内核时如何保留回退路径并验证外围模块。

## 最初的 NVIDIA 重建不是故障

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

## 成功启动后再清理

只有在以下四项全部确认后，才用 `eclean-kernel` 清理旧 XanMod 内核文件：

```text
新内核能够启动
NVIDIA 正常工作
Secure Boot 仍为 enabled
CJKTTY 在真实 VT 中正常显示中文
```

包缓存和 distfile 缓存随后另行清理。删除 `/var/cache/distfiles/*` 或 `/var/cache/binpkgs/*` 不是移除旧内核的必要步骤，也不应当作为通用迁移命令。最终只保留 `gentoo-cjk-kernel`、`virtual/dist-kernel` 和 `7.1.7-gentoo-cjk-dist` 的模块树，不再保留旧 XanMod 文件。

## 收尾整理 Portage 配置

启动验证完成后，还应清除已经失效的 XanMod 专用规则：从 `package.accept_keywords`、`package.env` 和 `package.use` 中移除 XanMod 项，把签名密钥访问范围收窄到 `gentoo-cjk-kernel`，并同步 [`world_packages.txt`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/world_packages.txt) 与内核说明。当前 Secure Boot 工具与公开示例集中在 [`kernel/secureboot`](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/kernel/secureboot)。

这部分只是迁移后的配置卫生：先验证新系统，再删除旧规则和回退文件，避免把“清理得很干净”放在“确认能够启动”之前。
