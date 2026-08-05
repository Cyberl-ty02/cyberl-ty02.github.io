---
title: Gentoo 在 Btrfs 与 rEFInd 环境下的启动修复记录
comments: true
toc: true
donate: true
share: true
date: 2026-08-05 19:00:00
categories: 实用技巧
tags:
- 技巧
---

最近在 Gentoo 真机环境中把启动链从 GRUB 调整为 shim + rEFInd，并从 LiveCD chroot 修复了一次 Btrfs 根子卷无法启动的问题。最容易忽略的坑不是内核或 rEFInd 本身，而是在 LiveCD 中运行 `mkrlconf` 时，把救援系统的启动参数写进了目标 Gentoo。

> **适用环境**
> Gentoo amd64、OpenRC、Btrfs 子卷、rEFInd、shim 与 dracut。

> **隐私说明**
> 文中的设备名、UUID、内核版本和路径均使用示例值，不能直接照抄。

本文只记录这次实际修复路线，不作为通用安装教程。对应的 Portage 与 Secure Boot 配置保存在 [dotfiles 的 Gentoo PC 配置目录](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)；可复用的示例启动参数见 [`refind_linux.conf.example`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/kernel/secureboot/refind_linux.conf.example)。

## 故障背景

当时的系统大致如下：

```text
Gentoo OpenRC
Btrfs 根子卷：/@
Btrfs 家目录子卷：/@home
shim + rEFInd 处理 Secure Boot 启动链
Windows 与 Gentoo 分别位于不同磁盘
```

从 LiveCD 进入 chroot 修复后，rEFInd 可以发现内核，但无法进入正确的 Gentoo 根系统。检查启动参数时，还能看到类似 `archisobasedir`、`archisosearchuuid` 的 LiveCD 痕迹。

排查时使用的匿名化设备示例如下：

```text
系统盘：/dev/nvme111111n1
EFI 分区：/dev/nvme111111n1p1
Gentoo 根分区：/dev/nvme111111n1p2
EFI UUID：1111-1111
根分区 UUID：11111111-1111-1111-1111-111111111111
```

## 关键根因：mkrlconf 读取了 LiveCD 参数

问题来自在 LiveCD 环境中运行：

```bash
mkrlconf
```

`mkrlconf` 会参考当前运行内核的 `/proc/cmdline`。即使已经 `chroot` 到 Gentoo，当前运行的内核仍然属于 LiveCD，所以它看到的可能是：

```text
archisobasedir=...
archisosearchuuid=...
cow_spacesize=...
copytoram=...
```

这些参数如果被写入 Gentoo 的 `refind_linux.conf`，rEFInd 随后就会按救援系统的条件寻找根文件系统。

```text
chroot 改变了进程看到的根目录
chroot 没有替换当前正在运行的内核
/proc/cmdline 仍然来自 LiveCD
```

因此，`mkrlconf` 并不能理解“现在正在 chroot 修复另一套 Gentoo”。在救援环境里自动生成启动配置前，必须先确认它使用的数据来源。

## 正确挂载 Btrfs 子卷与 chroot

先确认设备和子卷，再挂载目标系统。以下命令全部使用占位设备：

```bash
mount -o subvol=@ /dev/nvme111111n1p2 /mnt/gentoo
mount /dev/nvme111111n1p1 /mnt/gentoo/boot

mount --types proc /proc /mnt/gentoo/proc
mount --rbind /sys /mnt/gentoo/sys
mount --make-rslave /mnt/gentoo/sys
mount --rbind /dev /mnt/gentoo/dev
mount --make-rslave /mnt/gentoo/dev
mount --bind /run /mnt/gentoo/run

chroot /mnt/gentoo /bin/bash
source /etc/profile
```

进入后不要急着重建 initramfs 或启动配置，先核对挂载关系：

```bash
findmnt /
findmnt /boot
btrfs subvolume list /
ls -l /boot
ls -l /lib/modules
```

这里要确认 `/` 确实来自 `@` 子卷，ESP 也挂到了目标系统预期的 `/boot`。挂错根子卷时，即使命令执行成功，修改的也可能不是实际启动的系统。

## 手工修正 refind_linux.conf

这次没有继续在 LiveCD 中依赖 `mkrlconf`，而是按目标系统的根 UUID、Btrfs 子卷和 initramfs 文件名手工整理：

```conf
"Boot Gentoo Linux" "root=UUID=11111111-1111-1111-1111-111111111111 rw rootfstype=btrfs rootflags=subvol=/@ initrd=\initramfs-X.Y.Z-example.img"

"Boot Gentoo Linux (debug)" "root=UUID=11111111-1111-1111-1111-111111111111 rw rootfstype=btrfs rootflags=subvol=/@ initrd=\initramfs-X.Y.Z-example.img rd.debug rd.shell"

"Boot Gentoo Linux (single-user)" "root=UUID=11111111-1111-1111-1111-111111111111 rw rootfstype=btrfs rootflags=subvol=/@ initrd=\initramfs-X.Y.Z-example.img single"
```

这些字段分别表示：

```text
root=UUID=...          Btrfs 文件系统 UUID
rootflags=subvol=/@    作为系统根目录的 Btrfs 子卷
initrd=\...            rEFInd 所在文件系统中可识别的 initramfs 路径
```

`initrd` 的实际相对路径取决于内核、initramfs 和 rEFInd 能读取的文件系统布局，不能只复制示例。修正时还要删除所有 `archiso*`、`cow_spacesize`、`copytoram` 等 LiveCD 参数。

## shim、rEFInd 与 Secure Boot

当前配置使用 shim 进入已签名的 rEFInd，再由 rEFInd 加载内核。仓库中的 [`Secure Boot README`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/kernel/secureboot/README.md) 记录了文件检查和密钥注册流程；Portage 侧的开关见 [`package.use/secureboot`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/secureboot)。

Gentoo Wiki 的 [Shim](https://wiki.gentoo.org/wiki/Shim) 与 [rEFInd](https://wiki.gentoo.org/wiki/REFInd) 页面给出了一条较直接的安装路线。先启用 `sys-boot/refind[secureboot]`，并在 `make.conf` 中配置 `SECUREBOOT_SIGN_KEY` 与 `SECUREBOOT_SIGN_CERT`，让 Portage 签名 rEFInd 的 EFI 文件；随后安装所需软件：

```bash
doas emerge --ask sys-boot/refind sys-boot/shim sys-boot/mokutil sys-boot/efibootmgr
```

确认 ESP 已挂载到预期的 `/boot`，而且 `/etc/fstab` 中的记录正确：

```bash
findmnt /boot
grep -E '[[:space:]]/boot[[:space:]]' /etc/fstab
```

然后可以把 Gentoo 打包的 shim 路径交给 rEFInd 安装器：

```bash
doas refind-install --shim /usr/share/shim/BOOTX64.EFI
```

这里不是“先装 rEFInd，再随手复制一个 shim”。`refind-install --shim` 会按 shim 启动链准备 ESP 文件和 NVRAM 启动项。shim 通常会寻找同目录下名为 `grubx64.efi` 的下一阶段文件；通过这种方式安装时，该兼容文件名中实际放的是 rEFInd，并不表示系统仍然安装或使用 GRUB。

命令执行后必须阅读输出并核对：

```bash
doas efibootmgr -v
find /boot/EFI -maxdepth 3 -type f
find /boot -name refind_linux.conf -print
```

`refind-install` 还可能生成 `refind.conf` 和 `refind_linux.conf`。如果 `/boot` 没有正确挂载或没有出现在 `/etc/fstab` 中，安装器可能选择不同的 ESP 路径；如果从 LiveCD 执行，自动生成的 Linux 参数还可能继承当前救援系统的 `/proc/cmdline`。因此，本次场景中仍要手工复核上一节所述的 Btrfs UUID、子卷和 initramfs。

### 注册 MOK

shim 使用 Machine Owner Key 验证后续 EFI 文件。`sbsign` 和 Portage 使用的证书可以是 PEM，而 `mokutil --import` 需要 DER 格式的公开证书。仓库中的 [`generate_mok.sh`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/kernel/secureboot/generate_mok.sh) 会生成本地 PEM 密钥与 DER 格式的 `MOK.cer`，随后可提交注册请求：

```bash
doas mokutil --import /etc/kernel/secureboot/MOK.cer
```

这一步不会立即完成注册。重启后需要进入 MokManager，输入刚才设置的临时密码并确认导入，再次重启后才检查：

```bash
mokutil --sb-state
mokutil --test-key /etc/kernel/secureboot/MOK.cer
```

私钥 `MOK.pem` 必须保持仅 root 可读，不能提交到 dotfiles、博客或其他公开位置。

### 与仓库固定布局脚本的关系

dotfiles 中还保留了 [`install_bootloader.sh`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/kernel/secureboot/install_bootloader.sh)，用于维护当前机器既有的 `/boot/EFI/refind` 固定布局。它和 `refind-install --shim` 是两种安装路径：首次选择后应沿用同一种维护方式，不要在没有比较 ESP 文件与 NVRAM 项的情况下交替运行。

修复时可以先检查 ESP 内容：

```bash
find /boot/EFI -maxdepth 3 -type f
```

重点确认：

```text
shim 文件存在
MokManager 文件存在
rEFInd EFI 文件存在且签名符合当前 Secure Boot 信任链
rEFInd 文件系统驱动可读取内核所在分区
内核与 initramfs 文件名和配置一致
```

不要在没有恢复介质的情况下批量删除旧 EFI 文件或 NVRAM 启动项。先保留已知可启动的入口，确认新启动链工作后再清理。

## 更新内核后的维护方式

更新内核后，我会先核对内核、initramfs 与模块目录是否互相对应：

```bash
KVER="$(basename "$(readlink -f /usr/src/linux)" | sed 's/^linux-//')"

test -e "/boot/vmlinuz-${KVER}"
test -e "/boot/initramfs-${KVER}.img"
test -d "/lib/modules/${KVER}"
```

然后再手工或通过受控脚本更新 `refind_linux.conf`。如果只能从 LiveCD 维护，不应无检查地运行 `mkrlconf`。

## 验证与回滚

成功进入 Gentoo 后检查：

```bash
cat /proc/cmdline
findmnt /
findmnt /home
uname -r
ls /lib/modules/"$(uname -r)"
```

这次的成功标准是：

```text
/proc/cmdline 不再包含 LiveCD 参数
/ 来自 subvol=/@
/home 来自 subvol=/@home
当前内核版本存在对应的 /lib/modules 目录
Secure Boot 启用时仍能通过 shim + rEFInd 启动
```

如果新配置失败，应从保留的旧入口或 LiveCD 回到系统，重新检查 UUID、子卷名、initramfs 路径与签名，而不是立刻重装系统。

关于桌面、时间服务和工具链的后续整理，参见：

- [Gentoo OpenRC 桌面排错：中文字体、KDE 托盘与 PipeWire](/posts/gentoo-openrc-desktop-troubleshooting/)
- [Gentoo OpenRC 的时间同步、时区切换与 PostgreSQL 18 初始化](/posts/gentoo-chrony-timezone-postgresql/)
- [Gentoo 中 Firefox 与 CUDA 安装被旧 LLVM 构建失败阻塞的排查](/posts/gentoo-llvm-firefox-cuda-build-failure/)
