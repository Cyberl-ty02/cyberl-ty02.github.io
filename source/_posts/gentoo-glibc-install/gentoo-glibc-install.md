---
title: Gentoo glibc 安装指南
permalink: /posts/gentoo-glibc/gentoo-glibc/
comments: true
toc: true
donate: false
share: true
date: 2026-08-18 20:00:00
categories: Linux 与 BSD
tags:
- Linux
- Gentoo
---

## 简介

这篇指南保留 Gentoo AMD64 的 glibc 安装路线，使用 LLVM、OpenRC、Btrfs 和 rEFInd。步骤按原实体机的安装经验整理。当前实体机使用 [Gentoo musl 安装指南](/posts/gentoo-musl/gentoo-musl/)；新装 glibc 请保留本篇所选 stage3 的 Portage 配置。

分区和格式化前，用 `lsblk -f` 与 `findmnt` 核对实际设备。双系统应保留 Windows 与其已有 ESP。命令中的设备、账户、UUID 和内核版本须按目标机器填写。

| 环境 | 操作 |
| --- | --- |
| LiveCD | 联网、分区、挂载、验证并解压 stage3 |
| 目标 chroot／root | Portage、内核与引导、账号和 OpenRC 服务 |
| 首次启动后的管理员 | 核对挂载、签名、硬件及系统服务 |
| 桌面普通用户 | 输入法、Shell、编辑器和应用配置 |

## 准备安装环境

本章在 EndeavourOS LiveCD 中执行，目标是确认恢复条件、UEFI、联网与时间。LiveCD 使用 systemd，因此这里出现 `timedatectl`；目标 Gentoo 仍使用 OpenRC。

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

## 准备磁盘

以下命令仍在 LiveCD 中执行。先确定目标，再格式化与挂载；已有系统迁移不要重新格式化。

### 规划 Btrfs 与 ESP

本文采用与 Arch Linux 简明指南相同的核心思想：根目录与家目录共享一个 Btrfs 文件系统，通过独立子卷区分，而不是预先为 `/` 和 `/home` 切死容量。

示例布局如下：

```text
/dev/<efi-partition>    EFI System Partition   FAT32   挂载到 /boot
/dev/<root-partition>   Gentoo                 Btrfs   包含 @ 与 @home
```

本文不再预留实体 swap 分区，而是在目标系统中使用 zram swap。它的逻辑容量可以通过配置文件调整，不必重新分区；压缩页按实际使用占用 RAM，也不会在启动时一次性占满配置的全部容量。代价是 zram 位于易失内存，不能保存休眠镜像：如果需要 suspend-to-disk，仍需另行准备足够大的持久 swap，并配置正确的 `resume` 参数。

设备号仅用于展示。先检查现有磁盘：

```bash
lsblk -o NAME,SIZE,FSTYPE,FSVER,LABEL,UUID,MOUNTPOINTS
sudo fdisk -l
```

再打开分区工具：

```bash
sudo cfdisk "/dev/<disk>"
```

我更愿意在交互式界面中逐项确认目标，而不是在安装指南里给出一条会直接重写分区表的脚本。新建或选择分区后，应再次运行 `lsblk` 检查，再进行格式化。

### 格式化目标分区

以下仍是占位设备：

```bash
sudo mkfs.btrfs -L Gentoo "/dev/<root-partition>"
```

只有全新创建的 ESP 才格式化为 FAT32：

```bash
sudo mkfs.fat -F 32 -n EFI "/dev/<efi-partition>"
```

双系统中已有 ESP 时不要执行最后一条命令。格式化前后都应核对设备大小和文件系统，不能凭设备编号猜测。

### 创建并挂载 Btrfs 子卷

先临时挂载顶层 Btrfs 文件系统：

```bash
sudo mount "/dev/<root-partition>" /mnt
sudo btrfs subvolume create /mnt/@
sudo btrfs subvolume create /mnt/@home
sudo btrfs subvolume list /mnt
sudo umount /mnt
```

然后按新系统的实际目录结构挂载。我的 Gentoo 救援记录一直使用 `/mnt/gentoo`，这里也保持一致：

```bash
sudo mkdir -p /mnt/gentoo
sudo mount -o subvol=/@,compress=zstd,noatime \
  "/dev/<root-partition>" /mnt/gentoo

sudo mkdir -p /mnt/gentoo/home /mnt/gentoo/boot
sudo mount -o subvol=/@home,compress=zstd,noatime \
  "/dev/<root-partition>" /mnt/gentoo/home
sudo mount "/dev/<efi-partition>" /mnt/gentoo/boot
```

这里把 ESP 直接挂载到 `/boot`，因为当前 rEFInd 和内核文件布局就是这样设计的。如果希望 ESP 位于 `/boot/efi`，启动配置、installkernel 和后文脚本都要相应调整，不能混用。

挂载后立即复查：

```bash
findmnt -R /mnt/gentoo
lsblk -f
```

## 安装 stage3

本章仍在 LiveCD 中执行，归档解压到已挂载的 `/mnt/gentoo`。

### 选择 LLVM／OpenRC 归档

#### 选择 stage3

从 [Gentoo 官方 glibc LLVM OpenRC 目录](https://distfiles.gentoo.org/releases/amd64/autobuilds/current-stage3-amd64-llvm-openrc/) 下载归档及同名的 `.asc`、`.DIGESTS`。替换实际时间戳后设置：

```bash
stage3='stage3-amd64-llvm-openrc-<timestamp>.tar.xz'
```

### 验证签名、校验和与解压

在 LiveCD 中验证所选归档，再以 root 权限保留属主和扩展属性解压。以下命令使用刚才选定的 `stage3` 变量，工作目录中应已有归档、同名 `.asc` 和 `.DIGESTS`。

先按 [Gentoo 发布签名说明](https://www.gentoo.org/downloads/signatures/) 从可信来源取得发行密钥并核对完整指纹。EndeavourOS 不是 Gentoo 官方介质，不能假定已有 Gentoo keyring；`Good signature` 也不能替代指纹核对。准备好密钥后：

```bash
gpg --verify "${stage3}.asc" "$stage3" || exit 1
gpg --verify "${stage3}.DIGESTS" || exit 1
```

官方 `.DIGESTS` 同时包含 BLAKE2B 和 SHA512。按 Handbook 计算归档摘要，再与已验签文件中 `# SHA512 HASH` 下同名归档的值逐字比对：

```bash
sha512sum "$stage3"
less "${stage3}.DIGESTS"
```

两种摘要长度相同，不能把整个混合 `.DIGESTS` 直接交给 `sha512sum -c`。这里使用官方说明中的计算与比对方式，不维护额外的摘要解析脚本。摘要不一致就停止，不继续解压。

签名、指纹和摘要检查均通过后才解压。以管理员权限保留数字属主、ACL 与扩展属性：

```bash
sudo tar xpvf "$stage3" --xattrs --xattrs-include='*.*' --acls --numeric-owner \
  -C /mnt/gentoo
```

解压结果应直接成为 `/mnt/gentoo/etc`、`/mnt/gentoo/usr` 等目录，不能多套一层：

```bash
test -x /mnt/gentoo/bin/bash
ls -ld /mnt/gentoo/{etc,usr,var}
```

### 在 chroot 前保存配置仓库

EndeavourOS LiveCD 有 Git，可以先把配置仓库带入目标根。先将配置仓库克隆到目标根。

#### 仅通用脚本参考

```bash
sudo git clone https://github.com/Cyberl-ty02/dotfiles.git \
  /mnt/gentoo/root/dotfiles
```

此 checkout 用于读取通用配置，例如 doas、Shell 和编辑器；Portage 使用本篇 stage3 自带的配置和目标机自己的包清单。

#### 检查目标配置

这一步只保存参考文件，尚不覆盖 `/etc/portage`。不同硬件应重写 `COMMON_FLAGS`、`MAKEOPTS`、`VIDEO_CARDS` 和签名路径，不把 `-march=native` 构建结果当作通用二进制镜像。

### 用 genfstab 生成目标系统挂载表

EndeavourOS 的 `arch-install-scripts` 提供 `genfstab` 和 `arch-chroot`。先确认命令存在：

```bash
command -v genfstab
command -v arch-chroot
```

保留 stage3 自带的示例。先单独生成挂载表，核对实际条目，再把它接在示例下方，中间隔三行空行：

```bash
sudo genfstab -U /mnt/gentoo > /tmp/gentoo-fstab.mounts
cat /tmp/gentoo-fstab.mounts
```

编辑 `/tmp/gentoo-fstab.mounts`，确认 `/` 和 `/home` 分别对应 `@` 和 `@home`，`/boot` 指向目标 ESP。删除重复条目和 LiveCD 遗留项。若希望普通用户可在 Dolphin 浏览 ESP，FAT 的选项可设为 `defaults,uid=0,gid=0,dmask=0022,fmask=0133,nosuid,nodev,noexec,noatime`，目录和文件分别为 0755、0644，写入仍由管理员控制。下例仅用于首次生成，重新生成时先备份并编辑实际条目：

```bash
sudo cp -an /mnt/gentoo/etc/fstab /mnt/gentoo/etc/fstab.stage3
sudo sh -c 'cat /mnt/gentoo/etc/fstab.stage3; printf "\n\n\n"; cat /tmp/gentoo-fstab.mounts' \
  | sudo tee /mnt/gentoo/etc/fstab
```

## 进入新系统并配置 Portage

从这里开始，命令默认在 Gentoo chroot 内以 root 身份执行；只有明确带有 LiveCD 提示的命令才回到 EndeavourOS 环境。阶段目标是让 Portage 能够正确识别 profile、仓库和这台机器的包级配置。

### 使用 arch-chroot 进入 Gentoo

普通 `chroot` 前需要手工准备 API 文件系统。`arch-chroot` 会准备 `/dev`、`/proc` 等挂载及 resolver 环境，且要求目标目录本身为挂载点；前文已实际挂载 `/mnt/gentoo`，不是仅创建一个普通目录。本文使用默认 root 模式，不使用 `-N` 非特权 namespace 模式来解压或建立正式系统：

```bash
sudo cp -L /etc/resolv.conf /mnt/gentoo/etc/resolv.conf
sudo arch-chroot /mnt/gentoo /bin/bash
```

进入后加载 Gentoo 环境并标记提示符：

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

先核对 stage3 的 profile，保留正常 Portage 用户和沙箱。

先获取 Gentoo repository：

```bash
emerge-webrsync
eselect news list
eselect news read
```

确认 stage3 自带的 profile：

```bash
eselect profile show
```

#### profile 与 locale

`eselect profile show` 应对应：

```text
default/linux/amd64/23.0/llvm
```

配置上海时区并生成所需 glibc locale；在 `/etc/locale.gen` 中只登记一次以下 locale，然后生成并选择中文环境：

```bash
ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
nano /etc/locale.gen  # 加入 en_US.UTF-8 UTF-8 和 zh_CN.UTF-8 UTF-8
locale-gen
eselect locale list
eselect locale set zh_CN.utf8
env-update
```

#### 更新环境与主机身份

若 profile 不符，先核对 stage3，不通过直接切换 profile 修正下载错误。配置后更新当前 shell；桌面和用户 D-Bus 需重新登录才继承语言：

```bash
unset LC_ALL
source /etc/profile
```

再设置主机名、hosts 和 root 密码。示例主机名应换成自己的：

```bash
echo '<host>' > /etc/hostname
passwd
```

`/etc/hosts` 至少保留 localhost，并为选定主机名增加本地条目：

```text
127.0.0.1   localhost
::1         localhost
127.0.1.1   <host>.localdomain <host>
```

### 初始化软件仓库

**目标 chroot／root。** `emerge-webrsync` 提供主树基础；SonicDE、XLibre 和 Gentoo-Zh 的配方需要对应仓库。先安装管理工具：

```bash
emerge --ask dev-vcs/git app-eselect/eselect-repository app-portage/portage-utils
eselect repository list
```

用 `eselect repository list` 核对仓库名。只按选定的硬件和桌面启用所需的 Gentoo-Zh、SonicDE 或 XLibre 仓库，再执行 `emerge --sync`。可以先用 Gentoo 主树装基础系统，等首次启动通过后再加桌面仓库。

### 核对 glibc Portage 配置

#### 使用独立配置

在目标根执行 `portageq envvar CHOST ELIBC`，应返回 `x86_64-pc-linux-gnu` 和 `glibc`。保留 stage3 的包级配置和工具链，按 Handbook 调整 CPU、并行度及显卡 USE。

## 配置内核与可信启动链

本章在目标 chroot 中，按“签名材料 → shim/rEFInd → 内核与外部模块”的顺序执行。先使用 stage3 原有链接器完成引导；使用 Clang 构建 GNU-EFI／rEFInd 时，检查配方是否要求 BFD。这样首次安装内核时，Portage 已经知道使用哪组密钥，启动文件的落点也已经明确；但 MOK 的最终登记仍必须在重启后的 MokManager 中由用户确认。

### 先理解 shim 与 rEFInd 的交汇点

这里采用 Gentoo Wiki 所述的 shim + rEFInd 链，而不是直接让固件信任每个 EFI 程序：

```text
UEFI 固件内置的 Microsoft 第三方 CA
  → BOOTX64.EFI（Microsoft 签名的 shim）
  → grubx64.efi（实际内容是本地 MOK 签名的 rEFInd）
  → 已签名的内核
  → 已签名的 NVIDIA 等外部内核模块
```

shim 会按约定加载同目录的 `grubx64.efi`。因此这个文件名只是 shim 的兼容接口，文件内容仍是 rEFInd；本方案既不安装也不生成 GRUB。MokManager 则让机器所有者在不替换固件出厂密钥的情况下登记自己的 Machine Owner Key（MOK）。

### 逐行生成中立的本地 MOK

完成 profile、Portage 文件和 repository 初始化后，先生成签名材料，再安装任何内核或外部模块。证书主题会出现在 EFI 签名或模块元数据中，因此不要照抄用户名、主机名或真名；这里使用中立的 `Gentoo Secure Boot MOK`。

```bash
install -d -m 0700 /etc/kernel/secureboot
umask 077
if test -e /etc/kernel/secureboot/MOK.pem; then
  printf '签名材料已存在，先核对来源；不重新生成。\n'
else
openssl req -new -nodes -utf8 -sha256 -x509 -days 3650 \
  -newkey rsa:4096 \
  -subj '/CN=Gentoo Secure Boot MOK/' \
  -outform PEM \
  -out /etc/kernel/secureboot/MOK.pem \
  -keyout /etc/kernel/secureboot/MOK.pem
chmod 0600 /etc/kernel/secureboot/MOK.pem
fi
openssl x509 \
  -in /etc/kernel/secureboot/MOK.pem \
  -outform DER \
  -out /etc/kernel/secureboot/MOK.cer
chmod 0644 /etc/kernel/secureboot/MOK.cer
openssl x509 \
  -in /etc/kernel/secureboot/MOK.pem \
  -noout -subject -issuer -dates -fingerprint -sha256
```

`MOK.pem` 同时包含私钥和证书，必须保持 root-only，不进入 dotfiles、博客或工单附件；确需备份时使用独立加密且受控的离线备份；`MOK.cer` 是供 MokManager 导入的 DER 公钥证书，可以公开，但没有必要提交。条件检查用于避免覆盖已有私钥：若文件已存在，先确认它是否仍是当前内核和模块所用的密钥；后续 DER 导出应基于这份已确认的证书，不重新生成密钥。

如果暂时不启用 Secure Boot，应从本地 `make.conf`、`package.env/` 与 `env/` 的签名例外和相关 USE 中一并移除签名要求，不能留下指向不存在私钥的配置。

### 让 Portage 统一完成签名

在自己的 `/etc/portage/make.conf` 设置本机生成的签名文件，再核对 Portage 实际读取到的值：

```conf
SECUREBOOT_SIGN_KEY="/etc/kernel/secureboot/MOK.pem"
SECUREBOOT_SIGN_CERT="/etc/kernel/secureboot/MOK.pem"
MODULES_SIGN_KEY="/etc/kernel/secureboot/MOK.pem"
MODULES_SIGN_CERT="/etc/kernel/secureboot/MOK.pem"
```

```bash
portageq envvar SECUREBOOT_SIGN_KEY
portageq envvar SECUREBOOT_SIGN_CERT
portageq envvar MODULES_SIGN_KEY
portageq envvar MODULES_SIGN_CERT
grep -R --line-number --fixed-strings 'secureboot' \
  /etc/portage/package.use /etc/portage/package.env
emerge -pv sys-boot/refind sys-boot/shim sys-kernel/installkernel
```

期望四个变量都指向 `/etc/kernel/secureboot/MOK.pem`，在本地 `package.use` 为 `sys-boot/refind` 启用 `secureboot` USE，installkernel 则启用本教程需要的 `dracut` 与 `refind`。若检查结果不同，先修正 Portage 配置；不要靠安装脚本在最后偷偷补签。

### 使用上游安装器配置 shim＋rEFInd

**目标 chroot／root。** 按 [Gentoo Shim 文档的 rEFInd 小节](https://wiki.gentoo.org/wiki/Shim#rEFInd) 使用包提供的安装器。先确认 GNU-EFI／rEFInd 的包级 BFD 与无用户态 LTO 例外，再安装：

```bash
emerge --ask sys-boot/refind sys-boot/shim \
  sys-boot/mokutil sys-boot/efibootmgr app-crypt/sbsigntools
```

安装前保存当前 ESP 与固件启动项记录，并核对 UEFI 模式、实际 ESP 挂载和 fstab。本文的 ESP 挂在 `/boot`；使用其他挂载点时以自己的布局及安装器输出为准：

```bash
test -d /sys/firmware/efi
findmnt --mountpoint /boot
grep -E '[[:space:]]/boot[[:space:]]' /etc/fstab
refind-install --help
```

确认签名配置生效、包内 EFI 程序已签名，且安装器能够识别目标 ESP 后，执行官方入口：

```bash
refind-install --shim /usr/share/shim/BOOTX64.EFI
```

安装器负责发现源文件、复制 rEFInd／shim／MokManager，以及准备对应固件项。逐项阅读输出：目标必须是自己的 ESP，固件项应先进入 shim，再由 shim 加载 rEFInd。Portage 负责包内 EFI 签名，MOK 登记仍按下一小节完成；这里不使用 `--localkeys` 另生成第二套密钥。

完成后先检查，暂不重启：

```bash
efibootmgr -v
find /boot/EFI -maxdepth 3 -type f -print
find /boot -name refind_linux.conf -print
```

对安装器实际写入的 rEFInd EFI 文件执行 `sbverify --list`，核对预期签名；目标文件名和目录以安装器输出为准。本机历史链路位于 `/boot/EFI/refind/`，其中 `grubx64.efi` 的内容是 rEFInd，这不要求新机手工复刻全部目录和复制动作。

尤其检查自动生成的 `refind_linux.conf`：chroot 共享 LiveCD 内核，其命令行可能含 `archiso*` 或其他介质参数。新系统应使用目标根 UUID、Btrfs 子卷及匹配内核／initramfs；不能把安装器退出成功当作这些参数已经正确。更换版本时先读当前 `refind-install` 文档及 Gentoo 配方，再按同一上游入口更新并复查。

### 提交 MOK 登记请求

安装 `mokutil` 和 MokManager 后，在 chroot 中提交 DER 证书并设置一次性密码：

```bash
mokutil --import /etc/kernel/secureboot/MOK.cer
mokutil --list-new
```

若 `mokutil` 只因该证书已在当前内核 keyring 中而拒绝创建请求，Gentoo Wiki 给出的针对性选项是：

```bash
mokutil --ignore-keyring --import /etc/kernel/secureboot/MOK.cer
mokutil --list-new
```

这仍只是写入待处理请求，不代表证书已经受信任。首次重启进入 MokManager 后依次选择 **Enroll MOK → Continue → Yes**，输入刚才的一次性密码并重启。不要在文章、终端截图或 shell history 中记录该密码。

### 已有系统与启动器升级

已有可启动系统先确认现行 ESP、固件项、MOK 与内核／模块的签名来源，再决定是否更新启动器。采用上游入口后，源路径和文件复制由包提供的安装器处理，博客不另维护 EFI 复制器、`efibootmgr --create` 模板或包装脚本生命周期。

本机现用固定布局及旧脚本只作为历史背景，不要求新机创建或调用它们，也不因改写指南就移动现用 EFI、删除备份或重新生成密钥。保留 `/etc/kernel/secureboot/MOK.pem`、公开证书及仍在生效的签名配置；是否整理旧脚本由对应机器的实际验收另行决定。

### 安装内核、固件和 NVIDIA

#### 内核与 NVIDIA

Gentoo Handbook 建议第一次启动优先使用 distribution kernel，以减少“系统配置错误”和“自定义内核漏选驱动”混在一起的概率。我的机器选择 Gentoo-Zh 的 XanMod distribution kernel，并通过 `cjk` USE 应用 CJKTTY 补丁。当前 overlay 的 ebuild 会继承 `cjktty` eclass；`cjk` 提供 16×16 CJK 字体，`cjk32` 再加入 32×32 字体，用于解决本机高分辨率控制台上中文过小的问题。字体资源进入内核后镜像增加数 MiB 属预期结果；低分辨率 framebuffer 通常不必照抄 `cjk32`。

distribution kernel 通常依赖 initramfs 才能覆盖模块化的存储与文件系统驱动。在 `/etc/portage/package.use` 的本地文件里为 `sys-kernel/installkernel` 设置 `dracut refind`，并为所选的内核启用配方支持的 `secureboot modules-sign`。在 Intel／AMD 核显或虚拟机上，可先用 `sys-kernel/gentoo-kernel` 替换下例的 XanMod；使用 Gentoo-Zh 的 XanMod 则先核对其当前 USE。

```bash
emerge -pv sys-kernel/installkernel sys-kernel/xanmod-kernel
```

确认计划包含 initramfs 生成器后再安装：

```bash
emerge --ask sys-kernel/linux-firmware sys-kernel/xanmod-kernel
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

版本变化时 Portage 重建 NVIDIA 是正常的 subslot 行为。XanMod、独立 CJK kernel、CJKTTY、回退内核与 Secure Boot 的双向迁移记录见：[Gentoo 内核迁移记录：XanMod、CJKTTY、NVIDIA 与 Secure Boot](/posts/gentoo-xanmod-to-cjk-kernel-migration/gentoo-xanmod-to-cjk-kernel-migration/)。

原 glibc 实机的启动记录包含 `7.2.10-x64v3`。新机应安装当前可用且与驱动匹配的版本；以后升级时保留已经启动验证的内核对。

内核和 initramfs 出现后，再检查或创建 `refind_linux.conf`。从 LiveCD 生成的内容可能继承 LiveCD 的 `/proc/cmdline`，必须删除 `archiso*` 等介质参数，并核对 Btrfs UUID 与 `rootflags=subvol=/@`。稳定布局依靠：

```text
vmlinuz-<kernel-release>
initramfs-<kernel-release>.img
```

rEFInd 可自动配对版本化文件，kernel options 只保留通用 root/Btrfs 参数。前文的 `mokutil --import` 已创建待处理请求，但只有在首次重启的 MokManager 中确认后，证书才真正进入信任链。

成功启动 Gentoo 后完成闭环检查：

```bash
mokutil --sb-state
mokutil --test-key /etc/kernel/secureboot/MOK.cer
sbverify --list /boot/EFI/refind/grubx64.efi
modinfo -F signer nvidia
dmesg | grep -Ei 'secure boot|integrity|verification|lockdown'
```

`mokutil --sb-state`、MOK 测试、EFI 签名和模块 signer 应相互印证。某一项失败时保留原固件启动项和 LiveCD，回到对应层排查，不要先删除已知可启动的 EFI 文件。

### 完成链接器与基础维护工具配置

#### 链接器选择

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

这一步之后再执行完整 world 更新。先确认所选包支持 mold；内核或 EFI 组件如需特定链接器，保留相应包级环境。

## 安装系统工具与桌面

可信启动链和内核就绪后，再把 stage3 更新为完整桌面系统。此阶段覆盖基础 world、机器清单、登录环境、安全工具和 OpenRC 服务；完成标志不是“所有 emerge 命令返回成功”，而是重启检查清单中的每个对象都能被实际验证。

### 更新 stage3 的 @world

先预览，再按我习惯使用的参数更新基础 world：

```bash
emerge -pajvuDN @world
emerge -ajvuDN @world
emerge --ask @preserved-rebuild
```

这里的顺序刻意放在 Secure Boot、引导、内核和 mold 之后。若 Portage 给出 slot conflict、USE change 或 mask，应先理解依赖含义，不要直接接受一大批未读的 autounmask 修改。

### 选择并安装桌面软件

#### 角色清单与 world

以下仅说明原 glibc 方案的角色划分；共享清单与 main 的 PC world 会继续更新，历史 glibc 重建应使用自己审核保存的清单。原方案先使用角色清单，每次都先预览。基础、实体机引导和桌面可以依次检查：

```bash
cd /root/dotfiles
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/core.txt
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/pc-host.txt
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/desktop.txt
```

确认各轮的 profile、overlay、USE、关键字和 license 变化后，再用 `emerge --ask` 安装选定的 atom。NVIDIA、development 与 optional 也分别预览；`optional.txt` 不应默认全部安装。

需要复原既有 glibc 系统时，用自己审核保存的清单：

```bash
xargs emerge --pretend --verbose --noreplace \
  < /path/to/reviewed-glibc-world.txt
xargs -a /path/to/reviewed-glibc-world.txt emerge --ask --verbose --noreplace
```

安装完成后再次对齐完整依赖图：

```bash
emerge -pajvuDN @world
emerge -ajvuDN @world
```

完整 world 不仅有基础系统，还包括 SonicDE、KDE 应用、办公软件、开发工具、CUDA、输入法、邮件客户端和 PostgreSQL。第一次安装可能耗时很长，不应把所有失败都归因于 Gentoo 本身。角色清单已经把原先建议的三轮进一步变成可执行边界：

```text
第一轮：内核、固件、网络、日志、编辑器、启动链
第二轮：XLibre、NVIDIA、SonicDE、Sonic Login Manager、字体、PipeWire
第三轮：开发工具、CUDA、办公、邮件和其他应用
```

这份历史清单只适合复原原方案，不等于所有 Gentoo 用户的推荐列表。特别是 CUDA、PostgreSQL 和专有应用，都应根据实际需求删减。

### 核对直接选择与用户配置

用 `qlist -IC` 查看已装包，直接选择则记录在 `/var/lib/portage/world`。Doom、Fcitx/Rime、Zsh、字体与数据库初始化都需要各自的用户或系统配置。旧清单的比较方法见[按角色恢复](/posts/gentoo-world-tree-export/gentoo-world-tree-export/)。

### 新装系统中的 XLibre

全新 stage3 通常还没有完整 X.Org Server，直接按当前依赖图安装即可。若是在已有 Gentoo 上从 X.Org 切到 XLibre，两者可能发生文件冲突，应使用 dotfiles README 中记录的迁移步骤，不能把“旧系统迁移命令”无条件套到新装系统。

当前组合的关系是：

```text
xlibre-server                 实际 X server
xorg-server::xlibre          满足旧包名依赖的 dummy
xwayland                      Wayland 应用兼容服务器，仍被 SonicDE 依赖
sonic-desktop-interface / sonic-win     替换对应 Plasma 桌面核心
```

遇到 SonicDE 编译期 libinput target 问题时，可参考：[Gentoo SonicDE + XLibre 编译失败：追踪 kcm_mouse 缺失的 xorg-libinput 依赖](/posts/gentoo-sonicde-xlibre-libinput-build-fix/gentoo-sonicde-xlibre-libinput-build-fix/)。该修复已进入 overlay，不应在新版本中重复保留旧 user patch。

### 配置用户、doas 与桌面登录

创建普通用户并加入需要的组。用户名和组应按本机设备权限调整：

```bash
command -v zsh
read -r -p '输入准备创建的普通账户名：' install_user
# 先核对名称；已有账户不要重复 useradd，应检查原 UID/GID 与 HOME。
if test -z "$install_user"; then
  printf '账户名不能为空。\n' >&2
elif getent passwd "$install_user" >/dev/null; then
  printf '账户已存在，先核对 UID/GID、HOME 和附加组，不重复创建。\n'
else
  useradd -m -G wheel,audio,video,input,plugdev -s "$(command -v zsh)" "$install_user" && \
    passwd "$install_user"
fi
```

安装并配置 `doas`：

```bash
emerge --ask app-admin/doas
install -m 0600 /root/dotfiles/doas_dot_conf /etc/doas.conf
```

公开 `doas_dot_conf` 可能含匿名模板账户规则，复制后必须按目标机器审核并修改。也可以只保留更通用的 wheel 规则，再逐项增加最小权限。

当前桌面使用 `sonicde-base/sonic-login-manager`，不再以 SDDM 或从 TTY 手工运行 SDDM 作为正常启动方式。Sonic Login Manager 自带 OpenRC 服务；该 OpenRC 服务可保留 `provide xdm display-manager`，且只启用 Sonic 登录器。不要无条件恢复旧版“删除 provide”的补丁；先检查其他登录器是否同时提供相同服务，再按现行配方和实际冲突处理。

```bash
emerge --ask sonicde-base/sonic-login-manager
rc-update add soniclogin default
rc-update del sddm default 2>/dev/null || true
rc-update show | grep -E 'soniclogin|sddm|display-manager'
```

安装后应通过一次完整冷启动验证 greeter 和 SonicDE 会话；不要把 chroot 或 TTY 中直接执行登录管理器的结果当成稳定启动验证。完整迁移边界见：[Gentoo OpenRC 迁移到 SonicDE 6.7.5：登录管理器、Portal 与应用边界](/posts/gentoo-sonicde-openrc-migration/gentoo-sonicde-openrc-migration/)。

#### 中文字体

安装适合桌面的中文字体，例如 `media-fonts/noto-cjk`，然后用 `fc-match 'sans-serif:lang=zh-cn'` 检查回退。有关字体、托盘和 PipeWire 的排错见[桌面问题记录](/posts/gentoo-openrc-desktop-troubleshooting/gentoo-openrc-desktop-troubleshooting/)。

### Portal、音量界面与 Flatpak 集成

旧 SonicDE 迁移文章中的 `plasma-pa` 是兼容包名，当前原生实现为 `sonicde-base/sonic-audio-applet-pulse`；服务端仍用 PipeWire。`XDG_CURRENT_DESKTOP=KDE` 是兼容标识，不能单凭这个值判断仍在运行旧 Plasma。

旧文为 Portal 临时直接选择的 `libei` 仅用于当时的排错；不要为复刻历史重新加入。按现行配方解依赖，再在真实普通用户会话检查：

```sh
printf '%s\n' "$XDG_SESSION_TYPE" "$XDG_CURRENT_DESKTOP"
pgrep -a xdg-desktop-portal
wpctl status
```

旧文的 `portals.conf` 是当时的显式路由示例，新装可以先使用后端的默认选择；先让已安装后端按会话选择，不为复制旧文而创建全局覆盖。文件选择器、通知、Secret Service 和屏幕共享分别验证，进程存在不代表各项接口已可用。

可使用 firewalld 及其图形界面管理规则。Flatpak 编辑器如需运行宿主工具，使用相应的宿主入口。

### 配置 ClamAV、freshclam 与 clamd

ClamAV／ClamTk 可以按需扫描，也可以运行 clamd；是否常驻应按内存和用途决定，安装软件并不自动等于启用服务。

#### 安装并核对配置路径

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

#### 配置 clamd

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

#### 配置 freshclam

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

#### 更新病毒库

第一次启动 clamd 前先取得病毒库；若 freshclam daemon 已运行，不并发手工更新：

```bash
freshclam
ls -lh /var/lib/clamav
```

#### OpenRC 服务

以下仍可在 chroot 中登记启动级别；实际启动留到新系统联网后。需要自动更新与常驻扫描时，分别启用两个服务：

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

#### 普通用户按需扫描

如果只需要偶尔扫描下载目录，可以不启用 daemon，更新病毒库后直接运行：

```bash
clamscan --recursive --infected ~/Downloads
```

本文不把 `clamd` 列入“桌面必须服务”。选择常驻还是按需扫描，应根据内存、扫描工作流和威胁模型决定。Gentoo Wiki 的 ClamAV 邮件网关示例可用于理解 socket、用户和 freshclam 的关系，但邮件服务器专用的 `amavis` 用户、目录与权限并不适合照抄到这里。

### 在首次重启前启用 OpenRC 服务

我的习惯是先把必要软件、配置和服务都准备好，再进行第一次 Gentoo 启动。`rc-update add` 在 chroot 中只创建启动级别关联，不要求服务此刻真的运行。

#### 原桌面服务组合

基础桌面需要：

```bash
rc-update add NetworkManager default
rc-update add dbus default
rc-update add elogind default
rc-update add soniclogin default
rc-update add sysklogd default
rc-update add chronyd default
rc-update add cronie default
```

按硬件和用途选择以下服务：

```bash
rc-update add bluetooth default
rc-update add cupsd default
rc-update add firewalld default
rc-update add power-profiles-daemon default
rc-update add netmount default
```

#### 按需服务与最终检查

PostgreSQL 不是启动桌面的必要条件。只有已经初始化对应版本的数据目录并确实需要开机启动时，才添加类似：

```bash
rc-update add 'postgresql-<slot>' default
```

不要照抄文章中的 slot；当前机器后来使用 PostgreSQL 18，初始化过程见：[Gentoo OpenRC 的时间同步、时区切换与 PostgreSQL 18 初始化](/posts/gentoo-chrony-timezone-postgresql/gentoo-chrony-timezone-postgresql/)。

查看最终状态：

```bash
rc-update show
```

不要在 chroot 中通过 `rc-service ... start` 判断所有服务是否正常。chroot 仍共享 LiveCD 内核，缺少真实登录会话和完整启动顺序；最终验证应在新系统启动后完成。

## 完成安装并首次启动

### 可选：PostgreSQL 初始化边界

需要 PostgreSQL 时，按[初始化说明](/posts/gentoo-chrony-timezone-postgresql/gentoo-chrony-timezone-postgresql/)选择 UTF-8 locale、版本和认证规则。已有集群先做逻辑备份，禁止对既有 PGDATA 重新执行 `initdb`。

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
findmnt --verify --verbose
eselect profile show
eselect kernel list
ls -l /boot/vmlinuz-* /boot/initramfs-*.img
find /lib/modules -mindepth 1 -maxdepth 1 -type d -print
rc-update show
efibootmgr -v
```

我会把成功标准写成具体对象，而不是“命令都运行过”：

```text
fstab 中 @、@home 与 ESP 没有重复或指错，也没有遗留实体 swap 条目
内核、initramfs、/lib/modules 的 release 一致
rEFInd 能看到正确的版本化内核文件
目标内核和 NVIDIA 模块已经签名
NetworkManager、日志、时间同步、dbus、elogind、soniclogin 位于本篇所示的 runlevel
普通用户、密码与提权规则已经准备
world 更新没有未处理的 blocker
```

### 退出 chroot 与重启

前两行在目标 chroot 中执行；`exit` 返回 LiveCD 后再卸载与重启：

```bash
sync
exit
sudo umount -R /mnt/gentoo
sudo reboot
```

如果 `umount` 报 busy，不要强行断电；先检查仍停留在挂载树中的 shell、终端或文件管理器。

## 首次登录后的配置

以下工作都在已经成功启动的 Gentoo 中完成。先验证根文件系统、服务和 Secure Boot，再补充 zram swap，最后以普通用户配置输入法、shell 与编辑器；这样首次启动问题、内存压力保护和用户目录问题可以分层定位。

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

NVIDIA 机器先检查模块：

```bash
modinfo -F signer nvidia
cat /sys/module/nvidia/version
lspci -k
```

#### 历史驱动工具

完整驱动包提供该工具时再运行：

```bash
nvidia-smi
```

#### 桌面会话

桌面会话中检查：

```bash
echo "$XDG_SESSION_TYPE"
wpctl status
fc-match 'sans-serif:lang=zh-cn'
```

如果新入口失败，先从保留的旧 EFI 入口或 LiveCD 回到系统，检查 `fstab`、`refind_linux.conf`、内核/initramfs 配对和签名。不要在第一次失败后立即删除旧启动文件或重装。

只有上述底层验证通过后，我才恢复输入法、shell 和编辑器等用户层配置。这样即使某个用户配置导致登录程序报错，也不会和内核、Secure Boot、网络或显示管理器问题混在一起。

### 可选：使用发行版服务配置 zram

zram 为短时内存压力提供压缩 swap，逻辑容量不等于立即预留的 RAM，也不是增加物理内存。它不保存关机后的数据，不能用作休眠镜像。是否需要及容量大小根据目标机器负载决定，示例仅设置 2GiB。

新机优先使用 Gentoo 主树的 `sys-block/zram-init`，由包提供 OpenRC 服务，配置以 [zram-init 上游说明](https://github.com/vaeth/zram-init) 和实际安装的 `/etc/conf.d/zram-init` 注释为准。先确认目标内核支持 zram 及所选压缩算法：

```bash
modinfo zram
command -v zramctl
emerge --pretend sys-block/zram-init
emerge --ask sys-block/zram-init
```

审核依赖、关键词后再安装；`modinfo` 针对模块，若 zram 编入内核，应检查目标内核配置。编辑包自带 `/etc/conf.d/zram-init`，只配置一个 swap 设备，合并以下字段：

```sh
num_devices=1
type0=swap
size0=2048
algo0=zstd
flag0=100
```

当前上游以 MB 配置 `size0`，`flag0` 表示 swap 优先级。`num_devices=1` 避免默认示例同时把 `/tmp` 等目录改成 zram；其余参数与单位仍按安装版本注释核对，不整文件覆盖。

首次启动后的管理员确认没有其他 zram 管理器占用设备后，再启动并检查：

```bash
rc-service zram-init start
zramctl
swapon --show
free -h
```

结果符合预期后登记下次启动；在 chroot 中只能登记，实际运行留到真机启动：

```bash
rc-update add zram-init default
```

已有系统不能让 `zram-init` 与旧 `local.d` 脚本同时管理相同设备。本机历史方案使用 `zramctl`＋OpenRC local，本文没有安装或切换该服务，也不把新机推荐写成实机已验收。改管之前先确认旧服务、swap 用量与可用 RAM，按包说明停止原管理者，再交接；内存不足时不强制 swapoff。

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

普通用户无法直接读取 `/root/dotfiles` 时，可从公开仓库下载该单一文件，或由 root 安装到用户家目录。以目标普通用户执行，账户、组和 HOME 从本机读取：

```bash
desktop_user=$(id -un)
desktop_group=$(id -gn)
desktop_home=$(getent passwd "$desktop_user" | cut -d: -f6)
test "$(id -u)" -ne 0 && test -d "$desktop_home" || exit 1
doas install -o "$desktop_user" -g "$desktop_group" -m 0644 \
  /root/dotfiles/dot_zimrc "$desktop_home/.zimrc"
zimfw install
```

zimfw 生成的完整 `.zshrc` 中，本机还使用：

```zsh
ZSH_AUTOSUGGEST_MANUAL_REBIND=1
ZSH_HIGHLIGHT_HIGHLIGHTERS=(main brackets)
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh
```

当前公开 [`dot_zshrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zshrc) 已包含 Powerlevel10k instant prompt、系统编辑器选择、Zim 初始化、补全与代理函数，不再只是代理片段。先比较自己已有的 `.zshrc`，保留其中需要的设置，再通过 chezmoi 或人工合并部署；不要把两套完整初始化重复追加。代理函数仅对调用 shell 生效，新机必须确认实际代理地址与监听端口。

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

### 恢复 Doom Emacs

#### 编辑器选择

原 glibc PC 选择 `app-editors/emacs`；WSL 当前未安装，这一选择只用于未来重建。Windows 已完成 Scoop Emacs 部署并复用同一组 Doom 私人配置，Neovim 过渡文件也已从 dotfiles 删除。Doom 的私人配置位于 dotfiles 的 [`dot_config/doom/`](https://github.com/Cyberl-ty02/dotfiles/tree/main/dot_config/doom)，Gentoo 框架本体则由部署脚本检出到 `~/.config/emacs`。

先在已经审核的 dotfiles checkout 中预览并应用普通用户配置：

```bash
cd /path/to/dotfiles
gentoo_setting/scripts/bootstrap-user.sh
gentoo_setting/scripts/bootstrap-user.sh --apply
gentoo_setting/scripts/deploy-doom.sh
```

`bootstrap-user.sh --apply` 会交互式应用 chezmoi 配置；部署脚本复制已审核的 Doom 私人配置、在目标不存在时克隆框架，并执行 `doom sync --env`。脚本遇到已存在但不是 Git checkout 的 `~/.config/emacs` 会停止，避免覆盖未知目录。只有明确需要更新框架时才使用：

```bash
gentoo_setting/scripts/deploy-doom.sh --upgrade
```

完成后验证实际目录和启动状态：

```bash
emacs --version
command -v doom
emacs --batch --eval \
  '(message "user-emacs-directory=%s" user-emacs-directory)'
doom doctor
```

这套布局使用 `~/.config/emacs` 作为 Doom 主程序目录、`~/.config/doom` 作为私人配置目录；旧布局中的 `~/.emacs.d` 和 `~/.doom.d` 均不需要兼容符号链接。若确实需要 root 的独立配置，可在审阅脚本后使用 `deploy-doom.sh --root`；不要让普通用户与 root 共用可写的包、缓存或状态目录。旧 glibc／Windows 布局的说明见：[Doom Emacs 安装、同步与清理](/posts/doom-emacs-windows/doom-emacs-windows/)。

### VSCodium 的宿主入口与认证

VSCodium、扩展及跨平台同步见[配置文章](/posts/vscodium-sync/vscodium-sync/)。

### 从 LiveCD 查找、备份或移走旧用户配置

已有系统迁移时，先保留自己的旧 `@home` 回退基线，使用独立写入的测试 home；用户身份、对话 SQLite/WAL、VSCodium 混合状态和服务数据需先分类，最终停写后再迁移。以下配置检查只针对已选定的目标树。

如果 `/home` 沿用旧 `@home` 子卷，首次登录前可能已经存在旧配置。不要用未经核对的递归删除命令。先从 LiveCD 挂载目标根和 home，设定实际用户名目录，再列出对象：

```bash
read -r -p '输入目标 Gentoo 的普通账户名：' target_account
target_home=$(awk -F: -v account="$target_account" \
  '$1 == account { print $6 }' /mnt/gentoo/etc/passwd)
case "$target_home" in
  /home/*) TARGET_USER_HOME="/mnt/gentoo$target_home" ;;
  *) printf '未找到正常 /home 目录，停止并人工核对。\n' >&2; exit 1 ;;
esac
test -d "$TARGET_USER_HOME" || exit 1

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

## 维护系统

以后更新系统前先同步并预览：

```bash
emerge --sync
emaint --check world
emerge --pretend --verbose --update --deep --newuse @world
```

确认依赖图后再执行更新。新内核实际启动且驱动、initramfs 与签名都通过后，再清理旧内核。

### Portage 国内镜像分工

这里没有把“镜像”视作一个可互换的地址，而是按 Portage 的不同数据层分别处理：

| 数据层 | 当前首选 | 仍然保留的验证或回退 |
| --- | --- | --- |
| Gentoo ebuild 主树 | USTC Git 浅克隆 | Gentoo Release Key 验证提交签名、拒绝超过三天的仓库时间戳；备用源按可达性临时选择，保留签名验证 |
| distfiles 源码包 | USTC → 华为 → 阿里 → TUNA → 官方 | 国内源优先，临时回官方也保留强哈希校验 |
| 官方 binhost | glibc LLVM 的 `x86-64_llvm` | `verify-signature = true`；来源必须匹配当前 LLVM profile |
| gentoo-zh | 南京大学 Git 镜像 | Git 提交与 ebuild 自身的校验链不因镜像而关闭 |
| GURU、SonicDE、XLibre | 各自上游 | 不为追求形式统一而改写没有对应镜像的仓库 |

[MirrorZ Gentoo 帮助页](https://help.mirrors.cernet.edu.cn/gentoo/) 也特别区分了 stage3、distfiles、binhost 与 Portage ebuild 主树。`mirrors.cernet.edu.cn` 是联合镜像的动态调度入口，不是 MirrorZ 自己存放所有内容的单一站点，后端高校节点可能变化。原文的联合入口取舍来自 2026-09-01 的测量；本篇按 glibc LLVM 的来源列出。镜像可达性会变化，不把旧测量当作永久排序。

PC 的核心配置形如：

```ini
# /etc/portage/repos.conf/gentoo.conf
[gentoo]
sync-openpgp-key-package = sec-keys/openpgp-keys-gentoo-release
sync-openpgp-key-path = /usr/share/openpgp-keys/gentoo-release.asc
sync-git-verify-commit-signature = yes
sync-git-verify-max-age-days = 3
sync-type = git
sync-uri = https://mirrors.ustc.edu.cn/gentoo.git
```

```bash
# /etc/portage/make.conf
GENTOO_MIRRORS="https://mirrors.ustc.edu.cn/gentoo https://repo.huaweicloud.com/gentoo https://mirrors.aliyun.com/gentoo https://mirrors.tuna.tsinghua.edu.cn/gentoo https://distfiles.gentoo.org"
```

#### binhost

```ini
# /etc/portage/binrepos.conf/gentoo.conf
[gentoo]
sync-uri = https://mirrors.cernet.edu.cn/gentoo/releases/amd64/binpackages/23.0/x86-64_llvm
priority = 1
verify-signature = true
```

#### 签名与镜像切换

复制这些片段时不能只改 URI：binhost 的 profile/ABI 必须与目标系统一致，Git 提交签名、Release Key 刷新与二进制包签名验证也应保留。WSL 使用 `x86-64` binhost、没有 PC 的华为 binhost，并保留兼容初始 stage3 的 wget 下载方式；因此两套 Portage 目录不能直接覆盖彼此。

如果 `/var/db/repos/gentoo` 仍是 rsync 树，不能只把 `sync-type` 改成 Git 后原地继续。先确认它不是 Git worktree，再把旧目录移动到带时间戳的备份位置，让 Portage 重新克隆：

```bash
if [ -d /var/db/repos/gentoo ] && \
  ! git -C /var/db/repos/gentoo rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  mv /var/db/repos/gentoo \
    "/var/db/repos/gentoo.rsync-backup-$(date +%Y%m%d-%H%M%S)"
fi
emerge --sync
```

如果怀疑 distfiles 镜像尚未同步，可以让单次抓取只走官方源：

```bash
GENTOO_MIRRORS=https://distfiles.gentoo.org emerge --fetchonly --ask CATEGORY/PACKAGE
```

主树同步异常时，先核验备用镜像可达性，必要时临时使用官方 Git，不把一次速度测量作为永久排序。若使用 CERNET 联合入口，因为部分后端只提供 Git dumb HTTP，还必须同时设置 `sync-depth = 0`，首次同步会下载完整历史。一次只保留一个生效的 `sync-uri`，不要堆叠多个 `[gentoo]` 段，也不要关闭提交签名或 Release Key 刷新。binhost 应切换到 [Gentoo 官方下载页](https://www.gentoo.org/downloads/) 为当前 profile 提供的对应地址，而不是关闭签名验证来绕过错误。

[LinuxMirrors](https://github.com/SuperManito/LinuxMirrors) 可以作为镜像地址参考，但当前没有让它接管 Portage 或用户级开发工具配置。其自动换源流程无法表达这里的 Git 签名、多级 distfiles 回退、PC/WSL binhost 差异和 overlay 边界，不能未经审阅直接覆盖现有小文件。

### 用户级开发工具镜像

Portage 之外的镜像配置已迁到 dotfiles 根，由 chezmoi 部署；[`development_mirrors/`](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/development_mirrors) 只保留说明，不再维护第二份文件。对应来源为 `dot_bunfig.toml`、`dot_npmrc`、`dot_cargo/config.toml`、`dot_config/pip/pip.conf`、`dot_config/uv/uv.toml`、`dot_config/go/env` 与 `dot_pixi/config.toml`。Bun/npm 使用 CERNET npm，pip/uv 使用 CERNET PyPI，Cargo 使用 CERNET crates.io 稀疏索引，Pixi 使用 CERNET Conda/PyPI。Python/uv 只设置一个默认 PyPI 索引，不叠加 `extra-index-url`，以降低同名依赖从非预期索引解析的 dependency-confusion 风险。

CERNET Go Proxy 在 2026-09-01 的本机测试中不兼容，因此 Go 采用保留校验数据库的分层回退：

```ini
GOPROXY=https://mirrors.huaweicloud.com/repository/goproxy/|https://mirrors.aliyun.com/goproxy/|https://proxy.golang.org|direct
GOSUMDB=sum.golang.org
```

竖线表示遇到任意错误都继续尝试下一项，适合处理镜像超时；其行为与只在 404/410 时回退的逗号不同，详见 [Go Modules Reference](https://go.dev/ref/mod)。调用参数或环境变量可临时回官方，项目级配置仍可能覆盖用户默认。各工具的目标文件、部署命令和临时切回官方源方法都记录在 [`development_mirrors/README.md`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/development_mirrors/README.md)。镜像配置只应包含公开索引地址，不要把 token、密码、私有 registry 或代理订阅复制进仓库。

## 参考资料

- [VSCodium 跨平台配置](/posts/vscodium-sync/vscodium-sync/)：当前 Java21、扩展与宿主桥接入口。

- [Gentoo AMD64 Handbook：完整安装篇](https://wiki.gentoo.org/wiki/Handbook:AMD64/Full/Installation)：本文章节组织的参照，profile 选择 glibc／LLVM／OpenRC。

- [Gentoo AMD64 Handbook](https://wiki.gentoo.org/wiki/Handbook:AMD64)：stage3、Portage、profile、内核、系统工具和启动配置的规范主线；更新本文前先核对对应章节。
- [Gentoo Handbook：配置内核](https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/Kernel)：distribution kernel、initramfs 与 installkernel 的官方说明。
- [Gentoo Handbook：配置系统](https://wiki.gentoo.org/wiki/Handbook:AMD64/Installation/System)：主机名、网络和 OpenRC 系统配置。
- [Gentoo 下载与镜像](https://www.gentoo.org/downloads/)：安装介质和官方 stage3 入口。
- [MirrorZ：Gentoo](https://help.mirrors.cernet.edu.cn/gentoo/) 与 [gentoo-zh](https://help.mirrors.cernet.edu.cn/gentoo-zh/)：CERNET 联合镜像中 distfiles、binhost 与 overlay 的使用边界。
- [Arch Linux 简明指南：基础安装](https://arch.icekylin.online/guide/rookie/basic-install.html)：本文借鉴其 Btrfs 子卷、按实际挂载生成 fstab，以及进入目标根目录前复查的思路；包管理和 Gentoo 配置仍以 Handbook 为准。
- [Arch Linux 简明指南：可选配置（基础篇）](https://arch.icekylin.online/guide/advanced/optional-cfg-1.html)：Fcitx/Rime 与 Zsh 使用思路；本文已将 Arch 包名和 systemd 命令替换为 Gentoo/OpenRC 实际配置。
- [Arch Linux 简明指南：系统美化（终端篇）](https://arch.icekylin.online/guide/advanced/beauty-3.html)：zimfw、Powerlevel10k、Nerd Font 与 `p10k configure` 的配置路线。
- [Gentoo Linux 安装及使用指南（bitbili.net）](https://bitbili.net/gentoo-linux-installation-and-usage-tutorial.html)：本文借鉴其验证并解压 stage3、在首次重启前完成软件和 OpenRC 服务配置的实践路线；其中版本化命令需按当前 Gentoo 状态重新核实。
- [Gentoo Wiki：Fcitx](https://wiki.gentoo.org/wiki/Fcitx)：X11 输入法环境变量、图形会话启动和配置工具说明。
- [Gentoo Wiki：ClamAV](https://wiki.gentoo.org/wiki/ClamAV)：ClamAV、freshclam、clamd 与病毒库维护的入口；当前 Gentoo 1.5.x 文件路径应以本机包内容为准。
- [Gentoo Wiki：Shim](https://wiki.gentoo.org/wiki/Shim) 与 [rEFInd](https://wiki.gentoo.org/wiki/REFInd)：Secure Boot pre-loader、MOK 注册和 rEFInd 安装参考。
- [Secure Boot on Gentoo with shim and GRUB](https://www.setphaserstostun.org/posts/secure-boot-on-gentoo-with-shim-grub/)：本文借鉴其合并 PEM、DER 证书转换、Portage 签名变量与 MOK 登记思路；GRUB 生成和引导命令未用于本文的 rEFInd 链。
- [Gentoo Wiki：Zram](https://wiki.gentoo.org/wiki/Zram) 与 [zram-init 上游说明](https://github.com/vaeth/zram-init)：内核能力、发行版 OpenRC 服务和配置参数；本机旧 local.d 方案只作历史记录。
- [ArchWiki：arch-chroot](https://man.archlinux.org/man/arch-chroot.8)：从 EndeavourOS LiveCD 进入 Gentoo 目标根目录时使用的工具说明。
- [ArchWiki：genfstab](https://man.archlinux.org/man/genfstab.8)：根据现有挂载树生成 fstab 的工具说明。
- [rEFInd 官方安装文档](https://www.rodsbooks.com/refind/installing.html) 与 [Secure Boot 文档](https://www.rodsbooks.com/refind/secureboot.html)：rEFInd 文件布局和签名链参考。
- [Cyberl-ty02/dotfiles 的 Gentoo PC 配置](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)：本文实际采用的 Portage、world、字体与 Secure Boot 配置。
