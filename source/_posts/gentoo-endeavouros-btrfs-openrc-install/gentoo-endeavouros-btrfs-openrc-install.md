---
title: Gentoo 定制安装指南：从 EndeavourOS LiveCD 到 Btrfs、OpenRC、SonicDE 与 rEFInd
comments: true
toc: true
donate: true
share: true
date: 2026-08-18 20:00:00
categories: 实用技巧
tags:
- 技巧
sticky: 1
---

这篇文章整理我现在使用的 Gentoo 实体机安装路线：以 EndeavourOS LiveCD 作为安装环境，把 Gentoo 安装到 Btrfs 的 `@`、`@home` 子卷，使用 `genfstab` 生成挂载表，再通过 `arch-chroot` 进入新系统。目标系统采用 OpenRC、LLVM profile、Gentoo-Zh CJK distribution kernel、XLibre、SonicDE、NVIDIA，以及 shim + rEFInd Secure Boot 启动链。

它不是 Gentoo Handbook 的替代品。Handbook 负责解释 Gentoo 安装中长期稳定的规则；本文则把这些规则落实到我的磁盘布局和公开配置仓库。涉及版本、overlay 和 USE flag 的内容会随时间变化，实际安装时应同时打开 [Gentoo AMD64 Handbook](https://wiki.gentoo.org/wiki/Handbook:AMD64) 核对。

> **记录基线**
> 本文写于 2026-08-18。配置仓库基线为 `Cyberl-ty02/dotfiles` 的 `ec095d8`；当时运行内核为 `7.1.8-gentoo-cjk-dist`。这些版本是记录，不是要求读者固定安装的版本。

> **危险操作提醒**
> 分区、格式化、生成 fstab 和安装 EFI 启动项都可能造成数据损失或启动失败。命令中的设备名全部是占位示例。执行前必须用 `lsblk -f`、`findmnt` 和固件启动模式确认自己的目标，双系统环境尤其不能格式化已有 Windows ESP。

## 这套安装最后会得到什么

当前配置的目标不是最小 Gentoo，而是一台日常使用的 amd64 笔记本：

```text
LiveCD：EndeavourOS
架构：amd64 / x86_64
init：OpenRC
profile：default/linux/amd64/23.0/llvm
工具链：Clang/LLVM，少数包按 package.env 回退 GCC
文件系统：Btrfs，根子卷 @，家目录子卷 @home
内核：sys-kernel/gentoo-cjk-kernel（dist-kernel）
桌面：SonicDE + XLibre/X11
显卡：Intel modesetting + NVIDIA
音频：PipeWire / PulseAudio compatibility
网络：NetworkManager + iwd
启动：shim + rEFInd + 本地 MOK
```

完整的当前说明见 dotfiles 的 [`gentoo_setting/pc/README.md`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/README.md)，软件清单见 [`world_packages.txt`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/world_packages.txt)。这里不会把所有软件都解释一遍，而是着重保证第一次重启前已经具备能启动、联网和进入桌面的条件。

本文采用的实际执行顺序是：进入 chroot 后初始化 Portage、repository 和公开配置，生成 Secure Boot 密钥并安装 shim+rEFInd，引导链就绪后安装内核和 NVIDIA 模块，再安装 mold；随后执行 `emerge -ajvuDN @world`、安装 `world_packages.txt` 中的软件并复查旧文章涉及的额外项目，启用必要服务后才第一次重启。Fcitx、Zsh/Powerlevel10k、Doom Emacs 等用户态配置统一留到成功启动的新系统中完成。

## Stage 0：在 LiveCD 中准备目标系统

这一阶段只操作安装介质和挂载在 `/mnt/gentoo` 下的目标文件系统。完成标志是：分区与子卷已挂载、stage3 已解压、目标系统的 `fstab` 已生成，并且进入 chroot 所需的运行时挂载均已准备好。

### 安装前准备

#### 准备恢复条件

开始前至少准备：

- 一份确认可启动的 EndeavourOS LiveCD；
- 重要数据的独立备份；
- 当前 ESP 内容和固件启动项的备份或记录；
- 稳定网络和足够时间；
- 另一台能查阅 Handbook 的设备。

如果是 Windows 双系统，先在 Windows 中关闭快速启动和休眠，并确认 BitLocker/设备加密的恢复密钥可用。本文不负责缩小 Windows 分区；应先在熟悉的工具中留出未分配空间。

#### 进入 UEFI 模式并联网

用 UEFI 模式启动 EndeavourOS，然后检查：

```bash
test -d /sys/firmware/efi/efivars && echo 'UEFI mode'
lsblk -f
ip link
ping -c 3 distfiles.gentoo.org
timedatectl status
```

如果 LiveCD 已进入桌面，通常可直接通过 NetworkManager 连接网络。也可以使用：

```bash
nmtui
```

先校准时间再验证 stage3 签名，避免因为时钟错误制造 TLS 或签名问题：

```bash
sudo timedatectl set-ntp true
```

### 分区规划：一个 Btrfs 分区承载根和 home

本文采用与 Arch Linux 简明指南相同的核心思想：根目录与家目录共享一个 Btrfs 文件系统，通过独立子卷区分，而不是预先为 `/` 和 `/home` 切死容量。

示例布局如下：

```text
/dev/nvme111111n1p1   EFI System Partition   FAT32   挂载到 /boot
/dev/nvme111111n1p2   Linux swap             swap    可选
/dev/nvme111111n1p3   Gentoo                 Btrfs  包含 @ 与 @home
```

设备号仅用于展示。先检查现有磁盘：

```bash
lsblk -o NAME,SIZE,FSTYPE,FSVER,LABEL,UUID,MOUNTPOINTS
sudo fdisk -l
```

再打开分区工具：

```bash
sudo cfdisk /dev/nvme111111n1
```

我更愿意在交互式界面中逐项确认目标，而不是在安装指南里给出一条会直接重写分区表的脚本。新建或选择分区后，应再次运行 `lsblk` 检查，再进行格式化。

#### 格式化目标分区

以下仍是占位设备：

```bash
sudo mkfs.btrfs -L Gentoo /dev/nvme111111n1p3
sudo mkswap -L swap /dev/nvme111111n1p2
```

只有全新创建的 ESP 才格式化为 FAT32：

```bash
sudo mkfs.fat -F 32 -n EFI /dev/nvme111111n1p1
```

双系统中已有 ESP 时不要执行最后一条命令。格式化前后都应核对设备大小和文件系统，不能凭设备编号猜测。

#### 创建 Btrfs 子卷

先临时挂载顶层 Btrfs 文件系统：

```bash
sudo mount /dev/nvme111111n1p3 /mnt
sudo btrfs subvolume create /mnt/@
sudo btrfs subvolume create /mnt/@home
sudo btrfs subvolume list /mnt
sudo umount /mnt
```

然后按新系统的实际目录结构挂载。我的 Gentoo 救援记录一直使用 `/mnt/gentoo`，这里也保持一致：

```bash
sudo mkdir -p /mnt/gentoo
sudo mount -o subvol=/@,compress=zstd,noatime \
  /dev/nvme111111n1p3 /mnt/gentoo

sudo mkdir -p /mnt/gentoo/home /mnt/gentoo/boot
sudo mount -o subvol=/@home,compress=zstd,noatime \
  /dev/nvme111111n1p3 /mnt/gentoo/home
sudo mount /dev/nvme111111n1p1 /mnt/gentoo/boot
sudo swapon /dev/nvme111111n1p2
```

这里把 ESP 直接挂载到 `/boot`，因为当前 rEFInd 和内核文件布局就是这样设计的。如果希望 ESP 位于 `/boot/efi`，启动配置、installkernel 和后文脚本都要相应调整，不能混用。

挂载后立即复查：

```bash
findmnt -R /mnt/gentoo
lsblk -f
```

### 下载并验证 LLVM/OpenRC stage3

当前机器以 `stage3-amd64-llvm-openrc` 和 `default/linux/amd64/23.0/llvm` profile 为基础。进入 [Gentoo AMD64 autobuilds](https://distfiles.gentoo.org/releases/amd64/autobuilds/) 后，选择最新的 `current-stage3-amd64-llvm-openrc`，同时下载压缩包和对应的 `.DIGESTS` 或 `.asc` 文件。

不要把本文日期对应的 stage3 文件名写死。下载后在文件所在目录验证，例如：

```bash
sha512sum -c --ignore-missing \
  stage3-amd64-llvm-openrc-<timestamp>.tar.xz.DIGESTS
```

需要验证 Gentoo Release Engineering 签名时，应按 Handbook 当前给出的发布密钥和命令操作；不要从第三方文章复制多年未更新的 key ID。

验证成功后解压到 Btrfs 根子卷：

```bash
sudo tar xpvf stage3-amd64-llvm-openrc-<timestamp>.tar.xz \
  --xattrs-include='*.*' --numeric-owner \
  -C /mnt/gentoo
```

解压对象必须直接成为 `/mnt/gentoo/etc`、`/mnt/gentoo/usr` 等目录，不能多套一层 stage3 目录：

```bash
test -x /mnt/gentoo/bin/bash
ls -ld /mnt/gentoo/{etc,usr,var}
```

### 在 chroot 前保存配置仓库

EndeavourOS LiveCD 有 Git，适合在进入新系统前先把配置和清单放到目标根目录。这样即使 chroot 后浏览器不可用，仍能对照文件：

```bash
sudo git clone https://github.com/Cyberl-ty02/dotfiles.git \
  /mnt/gentoo/root/dotfiles
```

也可以只把 PC 配置和 world 清单复制到临时目录：

```bash
sudo mkdir -p /mnt/gentoo/root/gentoo-install-reference
sudo cp -a /mnt/gentoo/root/dotfiles/gentoo_setting/pc \
  /mnt/gentoo/root/gentoo-install-reference/
```

这里先“带进去”，不立即覆盖 `/etc/portage`。当前 [`make.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/make.conf) 包含 `-march=native`、并行度、mold、NVIDIA、Secure Boot 签名和许多桌面 USE flag；它适用于当前机器，但在 MOK 尚未生成、overlay 尚未同步时整套覆盖会让早期排错更困难。

如果不是同一台硬件，尤其要先重写 `COMMON_FLAGS`、`MAKEOPTS`、`VIDEO_CARDS` 和签名设置。不能把 `-march=native` 构建的系统直接当作可迁移二进制镜像。

### 用 genfstab 生成目标系统挂载表

EndeavourOS 的 `arch-install-scripts` 提供 `genfstab` 和 `arch-chroot`。先确认命令存在：

```bash
command -v genfstab
command -v arch-chroot
```

stage3 已经带有 `/etc/fstab` 模板。第一次生成前先备份并清空模板，然后按当前挂载状态追加：

```bash
sudo cp -a /mnt/gentoo/etc/fstab /mnt/gentoo/etc/fstab.stage3
sudo sh -c ': > /mnt/gentoo/etc/fstab'
sudo genfstab -U /mnt/gentoo | \
  sudo tee -a /mnt/gentoo/etc/fstab
```

这就是 `genfstab -U /mnt/gentoo >> /mnt/gentoo/etc/fstab` 的等价安全写法，同时能在屏幕上看到输出。重点不是“生成成功”，而是逐行复核：

```bash
sudo sed -n '1,200p' /mnt/gentoo/etc/fstab
```

至少确认：

```text
/      使用 @ 子卷
/home  使用 @home 子卷
/boot  指向正确 ESP
swap   指向正确交换分区（如果使用）
没有 LiveCD 自身的挂载项
没有重复条目
```

如果调整挂载后重新运行 `genfstab`，不要再次盲目追加，否则会得到重复条目。应先保留备份，再清空并重新生成。

## Stage 1：进入 chroot 并初始化 Portage

从这里开始，命令默认在 Gentoo chroot 内以 root 身份执行；只有明确带有 LiveCD 提示的命令才回到 EndeavourOS 环境。阶段目标是让 Portage 能够正确识别 profile、仓库和这台机器的包级配置。

### 使用 arch-chroot 进入 Gentoo

普通 `chroot` 前需要手工准备 `/proc`、`/sys`、`/dev` 和 `/run`。`arch-chroot` 会根据目标环境完成这些必要挂载，因此 EndeavourOS LiveCD 下可以直接使用：

```bash
sudo cp -L /etc/resolv.conf /mnt/gentoo/etc/resolv.conf
sudo arch-chroot /mnt/gentoo /bin/bash
```

进入后加载 Gentoo 环境并醒目标记提示符：

```bash
source /etc/profile
export PS1='(gentoo-chroot) '\$PS1
```

检查自己确实在目标系统内：

```bash
mountpoint /boot
findmnt /
findmnt /boot
cat /etc/gentoo-release
```

`arch-chroot` 只是帮助准备 chroot 所需的挂载，不会把 EndeavourOS 的包管理器或 init 系统“转换”为 Gentoo。进入后仍应使用 Portage 和 OpenRC。

### 初始化 Portage 与 profile

先获取 Gentoo repository：

```bash
emerge-webrsync
eselect news list
```

确认 stage3 自带的 profile：

```bash
eselect profile show
```

对本文基线应看到：

```text
default/linux/amd64/23.0/llvm
```

如果不是，先确认下载的 stage3 是否正确，而不是在一个刚解压的系统里贸然跨 init、ABI 或工具链切换 profile。

配置时区和 locale。博客本身采用 Asia/Shanghai，而当前交互环境所在时区不影响 Gentoo 目标系统的选择：

```bash
echo 'Asia/Shanghai' > /etc/timezone
emerge --config sys-libs/timezone-data

printf '%s\n' \
  'C.UTF8 UTF-8' \
  'en_US.UTF-8 UTF-8' \
  'zh_CN.UTF-8 UTF-8' >> /etc/locale.gen
locale-gen
eselect locale list
```

选择 locale 后更新环境：

```bash
env-update
source /etc/profile
```

再设置主机名、hosts 和 root 密码。示例主机名应换成自己的：

```bash
echo 'gentoo-laptop' > /etc/hostname
passwd
```

`/etc/hosts` 至少保留 localhost，并为选定主机名增加本地条目：

```text
127.0.0.1   localhost
::1         localhost
127.0.1.1   gentoo-laptop.localdomain gentoo-laptop
```

### 分阶段应用当前 Portage 配置

当前公开配置位于：

```text
/root/dotfiles/gentoo_setting/pc/portage
```

先备份 stage3 原配置：

```bash
cp -a /etc/portage /root/portage-stage3-backup
```

然后合并配置，但不要删除 stage3 可能新增的文件：

```bash
rsync -a /root/dotfiles/gentoo_setting/pc/portage/ /etc/portage/
```

此时必须人工阅读至少这些文件：

- [`make.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/make.conf)：CPU、并行度、显卡、全局 USE 和 Secure Boot；
- [`repos.conf/eselect-repo.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/repos.conf/eselect-repo.conf)：gentoo-zh、GURU、SonicDE、XLibre；
- [`package.accept_keywords/hardware`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.accept_keywords/hardware)：CJK 内核、NVIDIA 等逐包测试关键字；
- [`package.mask/kernel`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.mask/kernel)：选择 CJK kernel，避免同时拉入其他内核；
- [`package.use/secureboot`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/secureboot)：installkernel、dracut、rEFInd 与签名策略。

当前配置刻意使用包级 `~amd64` 和 overlay 规则，而不是全局切换到 `ACCEPT_KEYWORDS="~amd64"`。这能把测试分支的影响限制在明确选择的软件上。

当前 `make.conf` 的正式状态使用：

```conf
LDFLAGS="-fuse-ld=mold -Wl,-O1 -Wl,--as-needed -Wl,-z,pack-relative-relocs"
```

但新 stage3 此时还没有 `sys-devel/mold`。为了保持“先准备 Secure Boot/引导和内核，随后再安装 mold”的顺序，首次安装阶段应暂时启用文件中保留的非 mold 写法：

```conf
LDFLAGS="-Wl,-O1 -Wl,--as-needed -Wl,-z,pack-relative-relocs"
#LDFLAGS="-fuse-ld=mold -Wl,-O1 -Wl,--as-needed -Wl,-z,pack-relative-relocs"
```

等后文确认 mold 已安装，再交换这两行。否则 rEFInd、shim 或内核依赖在 mold 命令尚不存在时就可能因 linker 选择失败。

同步所有配置过的仓库：

```bash
emerge --sync
emaint sync -a
```

检查仓库和重要包来自哪里：

```bash
eselect repository list -i
emerge -pv sys-kernel/gentoo-cjk-kernel
emerge -pv sonicde-base/sonic-meta
emerge -pv x11-base/xlibre-server
```

不要把 overlay 中暂时不存在、被 mask 或只有测试关键字的包统称为“包消失了”。先用 `emerge -pv`、`eix` 和 repository 配置区分来源、关键字与 mask。

## Stage 2：建立可信启动链并安装内核

这一阶段按“签名材料 → shim/rEFInd → 内核与外部模块 → linker”的顺序执行。这样首次安装内核时，Portage 已经知道使用哪组密钥，启动文件的落点也已经明确；但 MOK 的最终登记仍必须在重启后的 MokManager 中由用户确认。

### 先准备 Secure Boot 本地密钥

完成 profile、Portage 文件和 repository 初始化后，我会立即准备 Secure Boot，再进行任何可能安装内核或外部内核模块的 emerge。当前 `make.conf` 为内核、NVIDIA 模块和 rEFInd 指定本地 MOK。私钥不在 Git 仓库里，必须在目标机器生成，并保持 root-only。

先把公开脚本复制到目标位置：

```bash
install -d -m 0700 /etc/kernel/secureboot
cp -a /root/dotfiles/gentoo_setting/pc/kernel/secureboot/. \
  /etc/kernel/secureboot/
```

确认 `openssl` 可用，并阅读 [`Secure Boot README`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/kernel/secureboot/README.md) 后生成 MOK：

```bash
command -v openssl
/etc/kernel/secureboot/generate_mok.sh
chmod 0600 /etc/kernel/secureboot/MOK.pem
```

私钥和含私钥的 PEM 文件绝不能提交到 dotfiles 或博客。MOK 的固件注册需要重启后通过 MokManager 完成；但在首次编译内核和 NVIDIA 模块前，签名文件本身应当已经存在。

如果暂时不打算启用 Secure Boot，就应先从本地 `make.conf`、`package.env/secureboot` 和相关 USE 中移除签名要求，而不是保留指向不存在密钥的路径。

此时只需要先生成签名材料，不必等待 MOK 注册完成。`mokutil --import`、MokManager 确认和 Secure Boot 最终验证仍放在 shim+rEFInd 安装完成之后；否则尚未安装 `mokutil` 或启动文件时无法完成整条信任链。

### 提前安装 shim + rEFInd 启动链

本次顺序是在 repository 和 MOK 初始化后，先把 Secure Boot 启动链准备完整，再安装内核。此时仍使用上一节临时的非 mold LDFLAGS。

先安装启动链工具：

```bash
emerge --ask sys-boot/refind sys-boot/shim \
  sys-boot/mokutil sys-boot/efibootmgr app-crypt/sbsigntools
```

再次确认 ESP 正确挂载：

```bash
findmnt /boot
grep -E '[[:space:]]/boot[[:space:]]' /etc/fstab
```

当前配置提供两种安装方法，首次安装建议选择一种并始终沿用，不能交替运行后再猜测 ESP 里哪个文件生效。

当前固定布局的文件语义如下：

```text
/boot/EFI/refind/BOOTX64.EFI   Gentoo 打包、Microsoft 签名的 shim
/boot/EFI/refind/mmx64.efi     MokManager
/boot/EFI/refind/grubx64.efi   使用本地 MOK 签名的 rEFInd payload
/boot/EFI/refind/refind.conf   rEFInd 自身配置
```

shim 约定寻找同目录下的 `grubx64.efi`。这里该兼容文件名装的是 rEFInd，并不表示系统安装或使用 GRUB。

使用 rEFInd 安装器：

```bash
refind-install --shim /usr/share/shim/BOOTX64.EFI
```

或者使用 dotfiles 的固定 `/boot/EFI/refind` 布局脚本：

```bash
command -v sbsign
/etc/kernel/secureboot/install_bootloader.sh
```

完整差异见 [`kernel/secureboot/README.md`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/kernel/secureboot/README.md)。执行后立即检查：

```bash
efibootmgr -v
find /boot/EFI -maxdepth 3 -type f -print
sbverify --list /boot/EFI/refind/grubx64.efi
```

此时内核尚未安装，`refind_linux.conf` 可以等版本化内核/initramfs 出现后再完成；但 shim、MokManager、签名后的 rEFInd payload 和固件入口已经可以先核实。

### 安装内核、固件和 NVIDIA

Gentoo Handbook 建议第一次启动优先使用 distribution kernel，以减少“系统配置错误”和“自定义内核漏选驱动”混在一起的概率。我的机器选择 Gentoo-Zh 的 CJK distribution kernel：

distribution kernel 通常依赖 initramfs 才能覆盖模块化的存储与文件系统驱动。当前 `package.use/secureboot` 已为 `sys-kernel/installkernel` 启用 `dracut` 和 `refind`；安装前仍要从 Portage 计划中确认这些 flag 生效：

```bash
emerge -pv sys-kernel/installkernel sys-kernel/gentoo-cjk-kernel
```

确认计划包含 initramfs 生成器后再安装：

```bash
emerge --ask sys-kernel/linux-firmware sys-kernel/gentoo-cjk-kernel
```

当前配置让 installkernel 生成版本化内核和 initramfs，并由 rEFInd 自动配对。安装后检查，而不是只看 emerge 返回值：

```bash
eselect kernel list
readlink -f /usr/src/linux
ls -l /boot/vmlinuz-* /boot/initramfs-*.img
ls -ld /lib/modules/*
```

安装 NVIDIA 驱动时，`dist-kernel`、`modules` 和 `modules-sign` 会把模块绑定到内核 subslot 并签名：

```bash
emerge --ask x11-drivers/nvidia-drivers
```

版本变化时 Portage 重建 NVIDIA 是正常的 subslot 行为。后续迁移与验证细节见：[Gentoo 从 XanMod 迁移到 CJKTTY 内核：dist-kernel、NVIDIA 与 Secure Boot 实战](/posts/gentoo-xanmod-to-cjk-kernel-migration/gentoo-xanmod-to-cjk-kernel-migration/)。

内核和 initramfs 出现后，再检查或创建 `refind_linux.conf`。从 LiveCD 生成的内容可能继承 LiveCD 的 `/proc/cmdline`，必须删除 `archiso*` 等介质参数，并核对 Btrfs UUID 与 `rootflags=subvol=/@`。稳定布局依靠：

```text
vmlinuz-<kernel-release>
initramfs-<kernel-release>.img
```

rEFInd 可自动配对版本化文件，kernel options 只保留通用 root/Btrfs 参数。然后发起 MOK 注册请求：

```bash
/etc/kernel/secureboot/import_mok.sh
```

注册要到首次重启的 MokManager 中完成；当前 chroot 阶段只创建请求。

因此，“`mokutil --import` 已成功返回”只表示固件变量中已有待处理请求，并不表示证书已经受信任。必须在 MokManager 中确认、再次启动 Gentoo，并结合 `mokutil --sb-state`、内核及 NVIDIA 模块的签名信息完成最终验证。

### 安装 mold 与基础维护工具

启动链和内核完成后，先用临时非 mold LDFLAGS 安装 linker 本身及后续维护工具：

```bash
emerge --ask sys-devel/mold app-portage/gentoolkit \
  app-eselect/eselect-repository dev-vcs/git \
  sys-fs/btrfs-progs sys-fs/genfstab
mold --version
```

确认 `mold --version` 成功后，再把 `/etc/portage/make.conf` 切回正式状态：

```conf
#LDFLAGS="-Wl,-O1 -Wl,--as-needed -Wl,-z,pack-relative-relocs"
LDFLAGS="-fuse-ld=mold -Wl,-O1 -Wl,--as-needed -Wl,-z,pack-relative-relocs"
```

这一步之后才执行完整 world 更新，能保证后续包看到的 linker 与公开配置一致。

## Stage 3：构建可首次启动的完整系统

可信启动链和内核就绪后，再把 stage3 更新为完整桌面系统。此阶段覆盖基础 world、机器清单、登录环境、安全工具和 OpenRC 服务；完成标志不是“所有 emerge 命令返回成功”，而是重启检查清单中的每个对象都能被实际验证。

### 更新 stage3 的 @world

先预览，再按我习惯使用的参数更新基础 world：

```bash
emerge -pajvuDN @world
emerge -ajvuDN @world
emerge --ask @preserved-rebuild
```

这里的顺序刻意放在 Secure Boot、引导、内核和 mold 之后。若 Portage 给出 slot conflict、USE change 或 mask，应先理解依赖含义，不要直接接受一大批未读的 autounmask 修改。

### 安装当前 world 软件

进入配置目录，先用 `--noreplace` 把清单加入 world 并安装：

```bash
cd /root/dotfiles/gentoo_setting/pc
xargs emerge --ask --verbose --noreplace < world_packages.txt
```

安装完成后再次对齐完整依赖图：

```bash
emerge -pajvuDN @world
emerge -ajvuDN @world
```

这份清单不仅有基础系统，还包括 SonicDE、KDE 应用、办公软件、开发工具、CUDA、输入法、邮件客户端和 PostgreSQL。第一次安装可能耗时很长，不应把所有失败都归因于 Gentoo 本身。更稳妥的做法是分三轮：

```text
第一轮：内核、固件、网络、日志、编辑器、启动链
第二轮：XLibre、NVIDIA、SonicDE、SDDM、字体、PipeWire
第三轮：开发工具、CUDA、办公、邮件和其他应用
```

完整清单适合复原这台机器，不等于所有 Gentoo 用户的推荐列表。特别是 CUDA、多个 Rust slot、PostgreSQL 和专有应用，都应根据实际需求删减。

#### 核对原博客中不在 world_packages.txt 的内容

在本文基线中，实时 `/var/lib/portage/world` 与仓库的 `world_packages.txt` 完全一致。可以在旧系统或恢复环境中自行核对：

```bash
sort -u /var/lib/portage/world > /tmp/gentoo-selected.txt
sort -u /root/dotfiles/gentoo_setting/pc/world_packages.txt \
  > /tmp/gentoo-tracked.txt
comm -3 /tmp/gentoo-selected.txt /tmp/gentoo-tracked.txt
```

本次核对没有输出，因此没有证据支持再添加一批“漏记的直接安装包”。`qlist -IC` 列出的其他大量软件多数是依赖，不应为了复刻旧机器而全部加入 world。

原博客中仍需单独执行、但不是缺失 Portage atom 的内容包括：

```text
Doom Emacs 本体与 ~/.config/doom 私人配置
PostgreSQL 数据目录初始化与 pg_hba.conf 调整
Fcitx/Rime 用户 profile 和 custom.yaml
zimfw、Powerlevel10k 与生成的 ~/.p10k.zsh
fontconfig 的 /etc/fonts/local.conf
MOK 注册和 rEFInd ESP 文件
```

其中 Portage 软件包本身已经在 `world_packages.txt` 中；用户层初始化统一放到首次成功启动之后。若未来旧博客出现新的明确 atom，应先用 `emerge -pv` 验证，再决定加入 world 清单。

#### 新装系统中的 XLibre

全新 stage3 通常还没有完整 X.Org Server，直接按当前依赖图安装即可。若是在已有 Gentoo 上从 X.Org 切到 XLibre，两者可能发生文件冲突，应使用 dotfiles README 中记录的迁移步骤，不能把“旧系统迁移命令”无条件套到新装系统。

当前组合的关系是：

```text
xlibre-server                 实际 X server
xorg-server::xlibre          满足旧包名依赖的 dummy
xwayland                      Wayland 应用兼容服务器，仍被 SonicDE 依赖
sonic-desktop / sonic-win     替换对应 Plasma 桌面核心
```

遇到 SonicDE 编译期 libinput target 问题时，可参考：[Gentoo SonicDE + XLibre 编译失败：追踪 kcm_mouse 缺失的 xorg-libinput 依赖](/posts/gentoo-sonicde-xlibre-libinput-build-fix/gentoo-sonicde-xlibre-libinput-build-fix/)。该修复已进入 overlay，不应在新版本中重复保留旧 user patch。

### 配置用户、doas 与桌面登录

创建普通用户并加入需要的组。用户名和组应按本机设备权限调整：

```bash
useradd -m -G wheel,audio,video,input,plugdev -s /bin/zsh user111111
passwd user111111
```

安装并配置 `doas`：

```bash
emerge --ask app-admin/doas
install -m 0600 /root/dotfiles/doas_dot_conf /etc/doas.conf
```

公开 `doas_dot_conf` 中含作者自己的用户名规则，复制后必须修改。也可以只保留更通用的 wheel 规则，再逐项增加最小权限。

SonicDE 使用 SDDM。检查 `/etc/conf.d/display-manager`：

```conf
CHECKVT=7
DISPLAYMANAGER="sddm"
```

字体 fallback 的当前文件可安装为：

```bash
install -D -m 0644 \
  /root/dotfiles/gentoo_setting/pc/desktop/fontconfig/local.conf \
  /etc/fonts/local.conf
```

桌面首次启动后的字体、托盘与 PipeWire 验证见：[Gentoo OpenRC 桌面排错：中文字体、KDE 托盘与 PipeWire](/posts/gentoo-openrc-desktop-troubleshooting/gentoo-openrc-desktop-troubleshooting/)。

### 配置 ClamAV、freshclam 与 clamd

当前机器安装了：

```text
app-antivirus/clamav-1.5.3
app-antivirus/clamtk-6.18-r1
```

但 `clamd` 和 `freshclam` 目前没有加入 OpenRC 启动级别。这是有意保留的区别：安装 ClamAV/ClamTk 供按需扫描，不等于必须常驻一个会占用明显内存的 clamd daemon。

#### 当前 Gentoo 文件路径

旧文章常写 `/etc/clamd.conf` 和 `/etc/freshclam.conf`；当前 Gentoo 包实际使用：

```text
/etc/clamav/clamd.conf
/etc/clamav/freshclam.conf
/etc/init.d/clamd
/etc/init.d/freshclam
```

先安装包并列出包真正提供的配置路径：

```bash
emerge --ask app-antivirus/clamav app-antivirus/clamtk
qlist -e app-antivirus/clamav | grep -E '/etc/|init.d'
```

不要把邮件网关教程中为 amavis 定制的 socket、用户和权限直接用于普通桌面。当前桌面配置使用 ClamAV 自己的 `clamav` 用户和本地 Unix socket。

#### clamd.conf

`/etc/clamav/clamd.conf` 中本机实际启用的关键项为：

```conf
LogFile /var/log/clamav/clamd.log
LogTime yes
PidFile /run/clamd.pid
DatabaseDirectory /var/lib/clamav
LocalSocket /run/clamav/clamd.sock
User clamav
```

这里不启用 TCP socket，避免无意中把扫描服务暴露到网络。OpenRC 脚本会创建 `/run/clamav`，但其 `pidfile` 默认是 `/run/clamd.pid`；修改 `PidFile` 时必须同步检查 `/etc/init.d/clamd` 的约定，否则服务可能启动后仍被 OpenRC 判断为失败。

#### freshclam.conf

本机 `/etc/clamav/freshclam.conf` 的有效项为：

```conf
DatabaseDirectory /var/lib/clamav
UpdateLogFile /var/log/clamav/freshclam.log
PidFile /run/freshclam.pid
DatabaseOwner clamav
DatabaseMirror database.clamav.net
ScriptedUpdates yes
NotifyClamd /etc/clamav/clamd.conf
```

`NotifyClamd` 让病毒库更新后通知 clamd 重载，路径必须指向当前 Gentoo 配置文件。无需凭地理位置随意填写第三方镜像；先使用 ClamAV 官方的 `database.clamav.net` 服务。

可以用 `clamconf` 查看非默认配置：

```bash
clamconf -n
```

第一次启动 clamd 前先取得病毒库：

```bash
freshclam
ls -lh /var/lib/clamav
```

如果决定常驻运行，再分别启用两个 OpenRC 服务：

```bash
rc-update add freshclam default
rc-update add clamd default
```

首次真实启动应在完成 Gentoo 启动并联网后进行：

```bash
doas rc-service freshclam start
doas rc-service clamd start
doas rc-service clamd status
clamdscan --ping=3
```

如果只需要偶尔扫描下载目录，可以不启用 daemon，更新病毒库后直接运行：

```bash
clamscan --recursive --infected ~/Downloads
```

本文不把 `clamd` 列入“桌面必须服务”。选择常驻还是按需扫描，应根据内存、扫描工作流和威胁模型决定。Gentoo Wiki 的 ClamAV 邮件网关示例可用于理解 socket、用户和 freshclam 的关系，但邮件服务器专用的 `amavis` 用户、目录与权限并不适合照抄到这里。

### 在首次重启前启用 OpenRC 服务

我的习惯是先把必要软件、配置和服务都准备好，再进行第一次 Gentoo 启动。`rc-update add` 在 chroot 中只创建启动级别关联，不要求服务此刻真的运行。

基础桌面需要：

```bash
rc-update add NetworkManager default
rc-update add dbus default
rc-update add elogind default
rc-update add display-manager default
rc-update add sysklogd default
rc-update add chronyd default
rc-update add cronie default
```

当前机器还启用了这些与硬件或桌面功能有关的服务：

```bash
rc-update add bluetooth default
rc-update add cupsd default
rc-update add firewalld default
rc-update add power-profiles-daemon default
rc-update add netmount default
```

PostgreSQL 不是启动桌面的必要条件。只有已经初始化对应版本的数据目录并确实需要开机启动时，才添加类似：

```bash
rc-update add postgresql-<slot> default
```

不要照抄文章中的 slot；当前机器后来使用 PostgreSQL 18，初始化过程见：[Gentoo OpenRC 的时间同步、时区切换与 PostgreSQL 18 初始化](/posts/gentoo-chrony-timezone-postgresql/gentoo-chrony-timezone-postgresql/)。

查看最终状态：

```bash
rc-update show
```

不要在 chroot 中通过 `rc-service ... start` 判断所有服务是否正常。chroot 仍共享 LiveCD 内核，缺少真实登录会话和完整启动顺序；最终验证应在新系统启动后完成。

### 第一次重启前的总检查

先更新一次完整依赖图：

```bash
emerge -pajvuDN @world
emerge -ajvuDN @world
emerge --ask @preserved-rebuild
emaint --check world
```

然后逐项确认：

```bash
findmnt /
findmnt /boot
cat /etc/fstab
eselect profile show
eselect kernel list
ls -l /boot/vmlinuz-* /boot/initramfs-*.img
find /lib/modules -mindepth 1 -maxdepth 1 -type d -print
rc-update show
efibootmgr -v
```

我会把成功标准写成具体对象，而不是“命令都运行过”：

```text
fstab 中 @、@home、ESP 与 swap 没有重复或指错
内核、initramfs、/lib/modules 的 release 一致
rEFInd 能看到正确的版本化内核文件
目标内核和 NVIDIA 模块已经签名
NetworkManager、日志、时间同步、dbus、elogind、display-manager 已加入 default
普通用户、密码与提权规则已经准备
world 更新没有未处理的 blocker
```

同步磁盘后退出：

```bash
sync
exit
sudo umount -R /mnt/gentoo
sudo swapoff /dev/nvme111111n1p2
sudo reboot
```

如果 `umount` 报 busy，不要强行断电；先检查仍停留在挂载树中的 shell、终端或文件管理器。

## Stage 4：首次启动后配置用户环境

以下工作都在已经成功启动的 Gentoo 中完成。先验证根文件系统、服务和 Secure Boot，再以普通用户配置输入法、shell 与编辑器；这样用户目录问题不会干扰首次启动故障的定位。

### 启动后的验证

第一次进入 Gentoo 后先验证底层，再处理主题和美化：

```bash
uname -r
cat /proc/cmdline
findmnt /
findmnt /home
findmnt /boot
rc-status
ip address
chronyc tracking
mokutil --sb-state
```

NVIDIA 机器继续检查：

```bash
modinfo -F signer nvidia
nvidia-smi
```

桌面会话中检查：

```bash
echo "$XDG_SESSION_TYPE"
wpctl status
fc-match 'sans-serif:lang=zh-cn'
```

如果新入口失败，先从保留的旧 EFI 入口或 LiveCD 回到系统，检查 `fstab`、`refind_linux.conf`、内核/initramfs 配对和签名。不要在第一次失败后立即删除旧启动文件或重装。

只有上述底层验证通过后，我才恢复输入法、shell 和编辑器等用户层配置。这样即使某个用户配置导致登录程序报错，也不会和内核、Secure Boot、网络或显示管理器问题混在一起。

### 配置 Fcitx 5 与 Rime

Fcitx 5、GTK/Qt bridge 和 Rime 软件包已经由 `world_packages.txt` 安装；这里处理的是普通用户会话配置，不需要回到 chroot：

```text
app-i18n/fcitx:5
app-i18n/fcitx-configtool:5
app-i18n/fcitx-gtk:5
app-i18n/fcitx-qt:5
app-i18n/fcitx-rime:5
```

当前目标是 XLibre/X11。以普通用户创建或检查 `~/.xprofile`：

```sh
export XMODIFIERS='@im=fcitx'
export GTK_IM_MODULE='fcitx'
export QT_IM_MODULE='fcitx'
```

这些变量不必写入 root 的构建环境。Fcitx 包已经提供：

```text
/etc/xdg/autostart/org.fcitx.Fcitx5.desktop
/etc/xdg/Xwayland-session.d/20-fcitx-x11
```

因此通常不需要再创建重复的用户 autostart。注销并重新登录后检查：

```bash
pgrep -a fcitx5
fcitx5-diagnose
fcitx5-configtool
```

当前用户 profile 使用 `keyboard-us + rime`，`~/.config/fcitx5/profile` 的核心结构为：

```ini
[Groups/0]
Name=默认
Default Layout=us
DefaultIM=rime

[Groups/0/Items/0]
Name=keyboard-us

[Groups/0/Items/1]
Name=rime
```

不要直接公开或整目录复制 `~/.local/share/fcitx5/rime`：其中可能包含输入历史、个人词库、设备信息、build 和 userdb。只迁移自己维护的 `*.custom.yaml`，然后在 Fcitx 菜单中重新部署。

ArchiceKylin 的 Rime 配置可以用于理解 schema、候选数量和重新部署，但其中 `pacman`/AUR 包名不能用于 Gentoo。若将来切换到原生 Wayland，也应重新检查 Fcitx 5 上游建议，而不是照搬这组 X11 环境变量。

### 配置 Zsh、zimfw 与 Powerlevel10k

Zsh 和 Nerd Font 已经在 world 清单中。先更改普通用户 shell，不必更改 root：

```bash
chsh -s /bin/zsh
```

按 ArchiceKylin 的 zimfw/P10k 路线，先下载并检查安装脚本：

```bash
curl -fsSL -o /tmp/zim-install.zsh \
  https://raw.githubusercontent.com/zimfw/install/master/install.zsh
less /tmp/zim-install.zsh
zsh /tmp/zim-install.zsh
```

当前公开 [`dot_zimrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zimrc) 启用了 environment、git、completion、syntax highlighting、history substring search、autosuggestions，并加入：

```zsh
zmodule romkatv/powerlevel10k
```

普通用户无法直接读取 `/root/dotfiles` 时，可从公开仓库下载该单一文件，或由 root 安装到用户家目录。示例中的用户名需替换：

```bash
doas install -o user111111 -g user111111 -m 0644 \
  /root/dotfiles/dot_zimrc /home/user111111/.zimrc
zimfw install
```

zimfw 生成的完整 `.zshrc` 中，本机还使用：

```zsh
ZSH_AUTOSUGGEST_MANUAL_REBIND=1
ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets)
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh
```

公开 [`dot_zshrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zshrc) 主要是代理辅助函数，不是完整 zimfw 初始化文件。审核后把函数合并到 zimfw 生成的 `.zshrc` 末尾，不要直接覆盖。

在 Konsole 中选择 Nerd Font 后运行：

```bash
p10k configure
```

本机 `.p10k.zsh` 是约 90 KiB 的向导生成文件，使用 Nerd Font v3、双行 rainbow prompt 和 transient prompt；它是个人终端偏好，不作为公共模板。重新登录后检查；当前尚未重新登录的 shell 不会因为 `chsh` 立即改变：

```bash
echo "$SHELL"
getent passwd "$(id -un)" | cut -d: -f7
zsh -i -c 'print -r -- $ZSH_VERSION'
test -d ~/.zim/modules/powerlevel10k
```

### 安装 Doom Emacs

Portage 的 `app-editors/emacs` 已在 world 清单中；Doom Emacs 本体是用户目录中的 Git checkout，不是另一个 Gentoo atom。当前 Linux 目录约定是：

```text
~/.config/emacs   Doom Emacs 本体
~/.config/doom    init.el、packages.el、config.el 等私人配置
~/.emacs.d        指向 ~/.config/emacs 的兼容符号链接
~/.local/share/doom  Doom 生成的数据、包和缓存
```

以普通用户确认 Emacs 与 Git：

```bash
emacs --version
git --version
```

如果决定全新安装，先确认旧目录不存在或已备份，再克隆：

```bash
git clone --depth 1 https://github.com/doomemacs/doomemacs \
  ~/.config/emacs
~/.config/emacs/bin/doom install
```

把自己的 Doom 配置恢复到 `~/.config/doom` 后：

```bash
~/.config/emacs/bin/doom sync
~/.config/emacs/bin/doom doctor
```

如果 `emacs --batch` 仍报告 `user-emacs-directory=~/.emacs.d/`，而 Doom 位于 `~/.config/emacs`，在确认旧 `.emacs.d` 已备份后建立兼容链接：

```bash
ln -s ~/.config/emacs ~/.emacs.d
```

修改 `init.el` 或 `packages.el` 后运行 `doom sync`；更新 Doom 使用 `doom upgrade`，不要直接把普通 Git 更新当作完整升级流程。Windows 专用 junction 命令不适用于这里。

### 从 LiveCD 查找、备份或移走旧用户配置

如果 `/home` 沿用旧 `@home` 子卷，首次登录前可能已经存在旧配置。不要用未经核对的递归删除命令。先从 LiveCD 挂载目标根和 home，设定实际用户名目录，再列出对象：

```bash
TARGET_USER_HOME=/mnt/gentoo/home/user111111

ls -ld \
  "$TARGET_USER_HOME/.xprofile" \
  "$TARGET_USER_HOME/.config/fcitx5" \
  "$TARGET_USER_HOME/.local/share/fcitx5" \
  "$TARGET_USER_HOME/.zshrc" \
  "$TARGET_USER_HOME/.zimrc" \
  "$TARGET_USER_HOME/.zim" \
  "$TARGET_USER_HOME/.p10k.zsh" \
  "$TARGET_USER_HOME/.emacs.d" \
  "$TARGET_USER_HOME/.config/emacs" \
  "$TARGET_USER_HOME/.config/doom" \
  "$TARGET_USER_HOME/.local/share/doom" \
  2>/dev/null
```

还可检查与桌面配置有关的：

```text
~/.config/autostart
~/.config/environment.d
~/.config/plasma-workspace/env
~/.config/fontconfig
~/.cache/fontconfig
~/.config/pipewire
~/.config/wireplumber
```

建议把确认要停用的对象移动到同一文件系统中的时间戳备份目录，而不是立即删除：

```bash
CONFIG_BACKUP_DIR="$TARGET_USER_HOME/config-backup-before-gentoo"
sudo mkdir -p "$CONFIG_BACKUP_DIR"
```

之后逐个使用明确路径移动，并记录原位置。Fcitx 的 userdb、Doom 的私人配置、`.p10k.zsh` 和 shell history 可能有保留价值；缓存和重新生成的数据则可在确认后放弃。本文刻意不提供一条批量 `rm -rf`，避免变量、用户名或挂载点写错时破坏整个 home。

## Stage 5：安装完成后的维护

以后更新系统前先同步并预览：

```bash
emerge --sync
emaint --check world
emerge --pretend --verbose --update --deep --newuse @world
```

确认依赖图后再执行更新。内核更新完成后核对版本化内核、initramfs、模块和签名；只有新内核实际启动成功，才使用 `eclean-kernel` 清理旧版本。

本机配置继续以 [Cyberl-ty02/dotfiles](https://github.com/Cyberl-ty02/dotfiles) 为准。恢复系统时可以把 [`world_packages.txt`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/world_packages.txt) 复制到新环境，但它应当作为可审阅的目标清单，而不是不经检查就执行的安装脚本。

## 参考资料

- [Gentoo AMD64 Handbook](https://wiki.gentoo.org/wiki/Handbook:AMD64)：stage3、Portage、profile、内核、系统工具和启动配置的规范主线。
- [Gentoo Handbook：配置内核](https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Kernel)：distribution kernel、initramfs 与 installkernel 的官方说明。
- [Gentoo Handbook：配置系统](https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/System)：主机名、网络和 OpenRC 系统配置。
- [Gentoo 下载与镜像](https://www.gentoo.org/downloads/)：安装介质和官方 stage3 入口。
- [Arch Linux 简明指南：基础安装](https://arch.icekylin.online/guide/rookie/basic-install.html)：本文借鉴其 Btrfs 子卷、按实际挂载生成 fstab，以及进入目标根目录前复查的思路；包管理和 Gentoo 配置仍以 Handbook 为准。
- [Arch Linux 简明指南：可选配置（基础篇）](https://arch.icekylin.online/guide/advanced/optional-cfg-1.html)：Fcitx/Rime 与 Zsh 使用思路；本文已将 Arch 包名和 systemd 命令替换为 Gentoo/OpenRC 实际配置。
- [Arch Linux 简明指南：系统美化（终端篇）](https://arch.icekylin.online/guide/advanced/beauty-3.html)：zimfw、Powerlevel10k、Nerd Font 与 `p10k configure` 的配置路线。
- [Gentoo Linux 安装及使用指南（bitbili.net）](https://bitbili.net/gentoo-linux-installation-and-usage-tutorial.html)：本文借鉴其验证并解压 stage3、在首次重启前完成软件和 OpenRC 服务配置的实践路线；其中版本化命令需按当前 Gentoo 状态重新核实。
- [Gentoo Wiki：Fcitx](https://wiki.gentoo.org/wiki/Fcitx)：X11 输入法环境变量、图形会话启动和配置工具说明。
- [Gentoo Wiki：ClamAV](https://wiki.gentoo.org/wiki/ClamAV)：ClamAV、freshclam、clamd 与病毒库维护的入口；当前 Gentoo 1.5.x 文件路径应以本机包内容为准。
- [Gentoo Wiki：Shim](https://wiki.gentoo.org/wiki/Shim) 与 [rEFInd](https://wiki.gentoo.org/wiki/REFInd)：Secure Boot pre-loader、MOK 注册和 rEFInd 安装参考。
- [ArchWiki：arch-chroot](https://man.archlinux.org/man/arch-chroot.8)：从 EndeavourOS LiveCD 进入 Gentoo 目标根目录时使用的工具说明。
- [ArchWiki：genfstab](https://man.archlinux.org/man/genfstab.8)：根据现有挂载树生成 fstab 的工具说明。
- [rEFInd 官方安装文档](https://www.rodsbooks.com/refind/installing.html) 与 [Secure Boot 文档](https://www.rodsbooks.com/refind/secureboot.html)：rEFInd 文件布局和签名链参考。
- [Cyberl-ty02/dotfiles 的 Gentoo PC 配置](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)：本文实际采用的 Portage、world、字体与 Secure Boot 配置。
