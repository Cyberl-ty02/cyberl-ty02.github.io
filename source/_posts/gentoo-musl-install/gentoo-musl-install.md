---
title: Gentoo musl 安装指南
permalink: /posts/gentoo-musl/gentoo-musl/
comments: true
toc: true
donate: false
share: true
date: 2026-11-26 09:00:00
categories: Linux 与 BSD
tags:
- Linux
- Gentoo
sticky: 1
---

## 简介

这是我现在使用的 Gentoo AMD64 安装路线。用 EndeavourOS LiveCD 准备 Btrfs 的 `@` 和 `@home`，随后从官方 musl LLVM stage3 安装 OpenRC。桌面使用 SonicDE 与 XLibre，可信启动使用 shim 与 rEFInd。需要 glibc 原生环境时，走 [Gentoo glibc 安装指南](/posts/gentoo-glibc/gentoo-glibc/)。已有系统迁移及踩坑见[Gentoo musl 迁移复盘](/posts/gentoo-musl-llvm-pc-migration/gentoo-musl-llvm-pc-migration/)。

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

从 [Gentoo 官方 musl LLVM OpenRC 目录](https://distfiles.gentoo.org/releases/amd64/autobuilds/current-stage3-amd64-musl-llvm-openrc/) 下载归档和同名的 `.asc`、`.DIGESTS`，不要与普通 musl、glibc 或 systemd stage3 混用。替换实际时间戳后设置：

```bash
stage3='stage3-amd64-musl-llvm-openrc-<timestamp>.tar.xz'
```

本机曾使用的归档版本只是验收基线；新机器应重新核验当时的归档和发布签名。

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

#### main 配置

```bash
sudo git clone --branch main \
  https://github.com/Cyberl-ty02/dotfiles.git /mnt/gentoo/root/dotfiles
```

已验证脚本、必要配置和补丁索引在 `gentoo_setting/pc/`，main 为当前 musl 默认配置。先核对上游基线、CPU、设备与签名，再合并；不复制历史实验夹。

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
default/linux/amd64/23.0/musl/llvm
```

目标 chroot 内以 root 使用已验证脚本，先预览再配置：

```bash
cd /root/dotfiles/gentoo_setting/pc
bash scripts/configure-locale.sh --dry-run
bash scripts/configure-locale.sh --lang zh_CN.UTF-8 --timezone Asia/Shanghai
```

需要英文登录环境时，改为 `--lang en_US.UTF-8`，仍可保留上海时区。musl 不执行 `locale-gen`，不复制 glibc locale archive。脚本保留原配置备份；日期、货币、排序与编码转换仍须按应用检查，详见迁移文章。

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

musl 当前配置的仓库节位于 `gentoo_setting/pc/portage/repos.conf/`。逐节审阅名称、location、URI、优先级和签名选项后，合并到目标 `/etc/portage/repos.conf/`；不要与 eselect 生成的同名节重复。日常源优先国内：Gentoo 主树用 USTC、Gentoo-Zh 用南京大学，其余没有已验证国内镜像的 overlay 保留上游。

若主树仍由 rsync／webrsync 建立，不能只改 `sync-type = git` 后原地使用。按文末镜像小节先核对并备份旧树，再同步。仓库全部可用后才检查配方补丁：

```bash
emerge --sync
portageq get_repos /
```

已有系统同步前先保存仓库中的本地差异；同步后重新预检，不把已安装包数据库当作配方仍然存在的证据。

### 分阶段应用当前 Portage 配置

#### 逐项合并当前配置

保持官方 stage3 的正常 Portage 用户与沙箱，先初始化上一小节的仓库，再检查配置和补丁。不要把测试夹中的 root 编译设置带入新机。

```bash
portageq envvar ELIBC
portageq envvar FEATURES
id portage
cp -a /etc/portage /root/portage-stage3-backup
cd /root/dotfiles/gentoo_setting/pc
python3 scripts/restore-repository-patches.py
# 全部预检通过、确认目标仓库后才写入：
python3 scripts/restore-repository-patches.py --apply
```

确认 `ELIBC=musl`、`portageq envvar CHOST` 为 `x86_64-pc-linux-musl`，并核对 sandbox、userpriv、usersandbox 等默认功能。先审阅 make.conf 的 CPU、并行度、VIDEO_CARDS、USE、签名路径和 package.*；新机密钥必须自行生成。把审阅通过的 `package.*`、`env/` 和所需 `sets/` 逐文件并入 `/etc/portage`。先保留 stage3 的链接器与优化参数；可以用 `diff -ru /etc/portage portage` 审查差异。涉及仅在特定硬件使用的规则时，只合并本机需要的条目。源码用户补丁按[补丁组索引](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets)说明放入 `/etc/portage/patches/`；恢复脚本只处理仓库配方，不会自动部署全部源码补丁。

官方 stage3 仍用可用的 LLVM linker 引导。当前配置默认 mold／ThinLTO，因此先在未切换全局设置时正常安装 mold，并在内核章节之后补齐同槽 LLVMgold，再启用全局 mold／ThinLTO。此时可先合并设备、签名和包级规则：

```bash
emerge --pretend sys-devel/mold
emerge --ask sys-devel/mold
mold --version
```

完整桌面与正常沙箱安装已经通过。曾出现的 GLib／HarfBuzz／Pillow 引导环、Rust 宿主脚本和线程栈问题及其移除条件，在[Gentoo musl 迁移复盘](/posts/gentoo-musl-llvm-pc-migration/gentoo-musl-llvm-pc-migration/)及各补丁组说明中；临时 Pillow truetype 开关必须恢复。仓库同步可能覆盖配方差异，之后重新预检，不把补丁强行套入新代码。

##### Portage 的 xmake 优先入口

这一步统一常见 GNU Make／Ninja 的调用入口，保留上游构建图与后端，不把 Qt、CMake
或 Kbuild 改写成 xmake.lua，也不替换 `/usr/bin/make`。它是可撤销的使用偏好，不能
据此认为编译更快。部署、撤销方法和验收边界集中在配置仓库的
[xmake 说明](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/xmake-trybuild)。

完成前面的仓库同步、补丁预检和包级配置合并后，在目标 chroot 的 PC 配置目录执行：

```bash
python3 scripts/configure-portage-xmake.py
# 审阅预览后，部署执行器、包级环境与本地 Portage bashrc：
python3 scripts/configure-portage-xmake.py --apply
emerge --pretend --oneshot dev-build/xmake
emerge --ask --oneshot dev-build/xmake
```

安装 xmake 是可选步骤。stage3 尚无 xmake 时，Make 适配器直接调用 GNU Make，
Ninja 沿用原搜索路径。也可先跳过整个兼容入口，等系统引导完成后再启用。
xmake、Make、Portage 自身及内核、引导、NVIDIA 构建保留原入口。
QtSerialPort 和 tree 已在 Portage 中用本地配置完成暂存构建，分别覆盖 Ninja
及 GNU Make。部署文件不依赖安装现场的临时目录、用户名或磁盘 UUID。使用
`--root` 时可先将本地文件部署到目标根。已有自定义 bashrc 时须先检查并合并，
正常仓库同步无需恢复 xmake 专用 eclass 或 ebuild 补丁。

默认优先复用本机二进制包，命中时不发生源码编译；新增源码补丁或更改编译器、CPU、
LTO／链接选项后，对受影响包显式使用 `--usepkg=n`，不能假定旧二进制包自动识别
这些变化。需要整体撤销兼容入口时，执行
`python3 scripts/configure-portage-xmake.py --remove --apply`；后端软件继续保留。

## 配置内核与可信启动链

本章在目标 chroot 中，按“签名材料 → shim/rEFInd → 内核与外部模块”的顺序执行。musl 的 mold 引导已在 Portage 配置阶段准备，内核仍使用 LLD，UEFI 组件保留 BFD 例外。这样首次安装内核时，Portage 已经知道使用哪组密钥，启动文件的落点也已经明确；但 MOK 的最终登记仍必须在重启后的 MokManager 中由用户确认。

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

本机配置让 Portage 使用同一份 PEM 签名 distribution kernel、外部模块和 rEFInd。复制配置后逐项确认实际值，避免变量拼错或仍指向旧路径：

```bash
portageq envvar SECUREBOOT_SIGN_KEY
portageq envvar SECUREBOOT_SIGN_CERT
portageq envvar MODULES_SIGN_KEY
portageq envvar MODULES_SIGN_CERT
grep -R --line-number --fixed-strings 'secureboot' \
  /etc/portage/package.use /etc/portage/package.env
emerge -pv sys-boot/refind sys-boot/shim sys-kernel/installkernel
```

期望四个变量都指向 `/etc/kernel/secureboot/MOK.pem`，rEFInd 启用 `secureboot` USE，installkernel 启用 `dracut -refind`，由后文显式准备 rEFInd 内核入口。若检查结果不同，先修正 Portage 配置；不要靠安装脚本在最后偷偷补签。

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

#### 安装 distribution kernel 与固件

本机启动验收的是 `7.2.14-musl-x64v3`，使用 XanMod、CJKTTY 和 Clang／LLD ThinLTO。新机以 [PC 内核配置](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/kernel) 和配方为起点，选与当前仓库和驱动匹配的版本。在目标根核对 `/boot` 已挂载，按前文准备签名并完成包级规则后，预览并安装：

```bash
findmnt --mountpoint /boot
emerge --pretend --verbose --autounmask=n \
  sys-kernel/installkernel sys-kernel/linux-firmware sys-kernel/xanmod-kernel
emerge --ask --autounmask=n \
  sys-kernel/installkernel sys-kernel/linux-firmware sys-kernel/xanmod-kernel
ls -ld /lib/modules/*/build
ls -l /boot/vmlinuz-*
```

内核配置要覆盖目标机器的存储、根文件系统、显卡和固件；微码按 Intel 或 AMD 平台选择。验收内核的调度参数为 `preempt=full`，只有目标内核支持动态 full preemption 时才使用。记录实际安装的 kernel release，后面用它匹配模块及 initramfs。

#### 按需安装 NVIDIA 与私有用户态

有 NVIDIA 时，先确认该 release 的 build tree、生成头文件和 `Module.symvers`。按 [NVIDIA 补丁组](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/nvidia-620.70.06) 的次序预演并安装 modules-only、匹配 GSP、私有加载器、用户态与设备节点 helper。模块的 `KERNEL_DIR` 应指向目标内核，chroot 内 `uname -r` 显示的是 LiveCD 内核。使用集显的机器可以直接去掉这些选择，CUDA SDK 同样按需安装。

安装之后检查实际目标 release 的 vermagic、签名和固件。升级时内核、外部模块、GSP 和私有用户态须成套预演；旧验收版本只是复现基线。

#### 重建 initramfs 并设置 rEFInd 入口

先审阅 [dracut 配置](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/dracut.conf.d)。验收机用按设备缩减的镜像。首次在 LiveCD 的 chroot 里安装，可先生成不依赖宿主自动探测的通用镜像；需要早期加载 NVIDIA 等模块时，按实际设备显式配置驱动。填入安装到目标 `/lib/modules` 的 release，待所需模块和固件装齐后再生成：

```bash
read -r -p '目标内核 release：' release
test -n "$release" &&
  test -d "/lib/modules/$release" &&
  test -f "/boot/vmlinuz-$release" &&
  dracut --force --no-hostonly "/boot/initramfs-$release.img" "$release"
lsinitrd "/boot/initramfs-$release.img"
sbverify --list "/boot/vmlinuz-$release"
```

在安装器实际写入的 `refind.conf` 添加一个 Gentoo 入口。下面的 `<release>`、`<btrfs-uuid>` 均从目标机填写，`rootflags` 与 fstab 对应。新装可用子卷路径 `subvol=/@`；如果选择固定 ID 的布局，就实测 ID 并在两处统一使用 `subvolid=`。rEFInd 中指定的路径相对于 ESP：

```text
menuentry "Gentoo musl" {
    icon /EFI/refind/icons/os_gentoo.png
    loader /vmlinuz-<release>
    initrd /initramfs-<release>.img
    options "root=UUID=<btrfs-uuid> rw rootfstype=btrfs rootflags=subvol=/@"
}
```

先核对图标在实际目录中，随后启用手工菜单扫描（已有 `scanfor` 时加入 `manual`，保留 Windows 和外部介质所需类型）。已有可启动入口应保留，`refind_linux.conf` 如继续参与自动扫描也要剔除 LiveCD 参数。用手工菜单的单根新机在升级时更新成对的内核与 initramfs 路径；本机用于原双根迁移的更新脚本不作为新机前置依赖。

先确认生成结果含目标文件系统、存储控制器与所需模块，随后重启登记 MOK，再验证普通用户的 NVML／CUDA、显示输出和设备权限。

### 完成链接器与基础维护工具配置

#### 链接器选择

前文已用 stage3 工具链安装 mold。启用全局 ThinLTO 前，核对 [mold 的 musl 线程栈修正](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/mold-musl-stack)与同槽 LLVMgold。先在原设置下装好依赖，再合并审阅过的 make.conf 构建设置并确认有效值：

```bash
cd /root/dotfiles/gentoo_setting/pc
emerge --pretend llvm-core/llvmgold
emerge --ask llvm-core/llvmgold
# 合并已审阅的构建设置后，预览，再分别启用。
bash scripts/configure-linker.sh --linker mold --dry-run
bash scripts/configure-linker.sh --linker mold
bash scripts/configure-lto.sh --dry-run
# 确认依赖和包级例外齐备后才启用。
bash scripts/configure-lto.sh --mode thin
portageq envvar CHOST ELIBC LD CFLAGS LDFLAGS
```

不要一次接受新 LLVM 主版本来凑依赖；先核对实际槽位及预演。内核使用 LLD，GNU-EFI／rEFInd 保留 BFD。这里改变后续构建默认，不会自动重链接已装软件；详细证据见迁移文章。

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

#### 原生组件与 Flatpak 主包

不复用旧 PC world 或 GNU Emacs/GCC fallback 清单。SonicDE、XLibre、Fcitx/Rime 与字体由目标 Portage 配置管理；闭源桌面主包按独立 Flatpak 清单安装，运行时不能满足宿主 Portage 依赖。

先安装原生图形和会话的基础组件。若选择 iwd 作为 Wi-Fi 后端，先安装 `net-wireless/iwd` 并按 NetworkManager 当前配置文档设置 `wifi.backend=iwd`。预演成功后用 `--ask` 合并，再按现有 XLibre 兼容包、输入法、字体和声音包的依赖图补齐：

```bash
emerge --pretend --verbose x11-base/xlibre-server x11-base/xorg-server::xlibre \
  sonicde-base/sonicde-meta sonicde-base/sonic-login-manager \
  net-misc/networkmanager net-firewall/firewalld media-video/pipewire \
  sys-auth/elogind sys-apps/dbus app-admin/sysklogd net-misc/chrony \
  media-fonts/noto-cjk \
  app-shells/zsh sys-apps/flatpak
```

在 Flatpak 本体、CA 证书与字体已安装的目标 root chroot 中：

```bash
cd /root/dotfiles/gentoo_setting/pc
bash scripts/install-flatpak-apps.sh --dry-run --system
bash scripts/install-flatpak-apps.sh --system
```

脚本不启动 GUI，默认国内缓存并保留签名验证。唯一主包清单是 `scripts/flatpak-apps.txt`，当前包括中文 WPS、QQ、微信、腾讯会议、VSCodium、LocalSend 和 Thunderbird ESR。系统级部署、隔离界面与后续日常使用的验收范围见迁移文章；账号登录、会议共享、DRM 与特殊设备仍按需求另验。

原生 world 位于当前 PC 根，先逐项筛选、预演，再分批安装。CUDA、数据库及私有运行库并非每台机器都需要，不把历史 glibc manifests 当作 musl 的安装输入：

```bash
cd /root/dotfiles
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/pc/world_packages.txt
```

审核依赖图及目标清单后，将选定 atom 交给 `emerge --ask` 分批安装。

### 核对直接选择与用户配置

musl 当前 world 与旧 glibc 直接选择的逐项去向分别维护在 `world_packages.txt`、`world-migration.tsv`。可以比较自己的目标清单与安装选择；差异需要解释，不能为了让它为空就卸载软件：

```bash
sort -u /var/lib/portage/world > /tmp/gentoo-selected.txt
sort -u /root/dotfiles/gentoo_setting/pc/world_packages.txt \
  > /tmp/gentoo-tracked.txt
comm -3 /tmp/gentoo-selected.txt /tmp/gentoo-tracked.txt
```

`qlist -IC` 中的大量软件是依赖，不必全加进 world。

原博客中仍需单独执行、但不是缺失 Portage atom 的内容包括：

```text
~/.config/doom 中的 Doom 私人配置与 ~/.config/emacs 中的 Doom 框架
PostgreSQL 数据目录初始化与 pg_hba.conf 调整
Fcitx/Rime 用户 profile 和 custom.yaml
zimfw、Powerlevel10k 与生成的 ~/.p10k.zsh
fontconfig 的 /etc/fonts/local.conf
MOK 注册和 rEFInd ESP 文件
按需选择的 zram OpenRC 服务配置
```

首次启动后再完成用户层初始化。服务数据按用途单独配置，例如 PostgreSQL 的数据目录和认证规则。

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

当前桌面使用 `sonicde-base/sonic-login-manager`，不再以 SDDM 或从 TTY 手工运行 SDDM 作为正常启动方式。Sonic Login Manager 自带 OpenRC 服务；当前实机的服务保留 `provide xdm display-manager`，且只启用 Sonic 登录器。不要无条件恢复旧版“删除 provide”的补丁；先检查其他登录器是否同时提供相同服务，再按现行配方和实际冲突处理。musl 的 POSIX 类型头文件补丁是另一问题，见对应补丁组。

```bash
emerge --ask sonicde-base/sonic-login-manager
rc-update add soniclogin default
rc-update del sddm default 2>/dev/null || true
rc-update show | grep -E 'soniclogin|sddm|display-manager'
```

安装后应通过一次完整冷启动验证 greeter 和 SonicDE 会话；不要把 chroot 或 TTY 中直接执行登录管理器的结果当成稳定启动验证。完整迁移边界见：[Gentoo OpenRC 迁移到 SonicDE 6.7.5：登录管理器、Portal 与应用边界](/posts/gentoo-sonicde-openrc-migration/gentoo-sonicde-openrc-migration/)。

#### 系统与 Flatpak 字体

字体 fallback 的基础文件可安装为：

```bash
install -D -m 0644 \
  /root/dotfiles/gentoo_setting/pc/desktop/fontconfig/local.conf \
  /etc/fonts/local.conf
```

musl 当前还用 `scripts/cjk-readable.conf` 明确 HarmonyOS Sans／Noto／Nerd Font 回退；须先按 PC 配置安装真实字体包，再审阅是否合并该片段。`fc-match` 匹配到名称不表示 Flatpak 内也选中同一字体，两边应分别检查。

桌面首次启动后的字体、托盘与 PipeWire 历史诊断见：[Gentoo OpenRC 桌面排错：中文字体、KDE 托盘与 PipeWire](/posts/gentoo-openrc-desktop-troubleshooting/gentoo-openrc-desktop-troubleshooting/)。

### Portal、音量界面与 Flatpak 集成

旧 SonicDE 迁移文章中的 `plasma-pa` 是兼容包名，当前原生实现为 `sonicde-base/sonic-audio-applet-pulse`；服务端仍用 PipeWire。`XDG_CURRENT_DESKTOP=KDE` 是兼容标识，不能单凭这个值判断仍在运行旧 Plasma。

旧文为 Portal 临时直接选择的 `libei` 不再是当前 world 的手工绕行；不要为复刻历史重新加入。按现行配方解依赖，再在真实普通用户会话检查：

```sh
printf '%s\n' "$XDG_SESSION_TYPE" "$XDG_CURRENT_DESKTOP"
pgrep -a xdg-desktop-portal
wpctl status
```

旧文的 `portals.conf` 是当时的显式路由示例，当前实机没有该全局文件；先让已安装后端按会话选择，不为复制旧文而创建全局覆盖。文件选择器、通知、Secret Service 和屏幕共享分别验证，进程存在不代表各项接口已可用。

防火墙继续使用已安装、运行的 firewalld 及其界面，不借本次正文更新替换后端。Flatpak 内的编辑器与原生宿主命令有不同 ABI；需要宿主终端时采用包内 `host-spawn`，不能直接执行 musl Zsh。

### 配置 ClamAV、freshclam 与 clamd

ClamAV／ClamTk 可以按需扫描，也可以运行 clamd；是否常驻应按内存和用途决定，安装软件并不自动等于启用服务。2026-11-23 只读核对的 musl 实机安装 ClamAV 1.5.3／ClamTk 6.18-r2，clamd 已在 default 且运行，freshclam 未登记常驻、当前停止。新机不能据此跳过病毒库更新，也不必强制复制同样服务选择。

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

#### 已登记的最小组合

在目标 chroot 内静态登记，不启动真实服务：

```bash
rc-update add elogind boot
rc-update add dbus default
rc-update add NetworkManager default
rc-update add soniclogin default
rc-update add firewalld default
rc-update add sysklogd default
rc-update add chronyd default
```

这组基础登记及后续真机启动已完成；新机仍需在自己的首次启动中检查。Sonic 登录器提供 display-manager，不另启 xdm；iwd 由 D-Bus 激活，PipeWire 由普通用户会话启动。蓝牙和打印按需启用。本机安装了 `sys-power/power-profiles-daemon`，用 `rc-update add power-profiles-daemon default` 登记；使用匹配的 NVIDIA 私有用户态且已安装节点服务时，执行 `rc-update add nvidia-device-files boot`，不因软件已经安装就自动启动数据库或扫描服务。

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

引用的时间同步／PostgreSQL 文章记录过 glibc 的 `zh_CN.UTF-8` 集群，不能把那套 libc 排序环境当作 musl 新集群的要求。musl 路线已测试 UTF8＋ICU `zh-Hans-CN` 的中文排序、索引与逻辑导入导出；初始化新库前仍需确认版本、locale provider、扩展和业务要求。已有数据目录不重新初始化，不跨 libc 直接复制 PGDATA。

认证规则按当前 `services/postgresql/pg_hba.conf.example` 审核合并：本地 peer、回环 TCP 使用 SCRAM，保留集群所需的独立规则，不整文件覆盖，也不为省事扩大 trust。只有集群完成初始化与连接检查后，再按实际 slot 登记服务。数据库不是首次进入桌面的前提。

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
NetworkManager、日志、时间同步、dbus、elogind、soniclogin 位于正确 runlevel（elogind 在 boot）
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

#### 私有用户态与节点

```bash
rc-service nvidia-device-files status
stat -c '%U:%G %a %n' /dev/nvidia* /dev/nvidia-caps/* 2>/dev/null
command -v nvidia-musl-run
```

当前路线不默认提供普通 glibc 驱动包的 `nvidia-smi`，不能把命令不存在判为内核驱动失败。接着按 NVIDIA／CUDA 补丁组做普通用户的实际 CUDA／NVML 回读，并在调用前后核对节点保持 root:video 0660；入口存在或模块已加载都不代替运算检查。

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

Neomacs 已原生安装，SQLite、GUI 与 Fcitx/Rime 中文输入通过，完整 Doom 的普通用户／root 独立配置也已验收。首次启动后，以管理员选择系统编辑器，再在当前普通用户 shell 刷新环境：

```bash
doas eselect editor set neomacs
source /etc/profile
```

共享 Bash／Zsh 配置尊重系统编辑器选择。目标普通用户在自己的 dotfiles checkout 根目录运行：

```sh
sh gentoo_setting/scripts/deploy-doom.sh
neomacs --version
command -v doom
doom doctor
```

脚本先同步 Doom core 记录的模块子仓库，再同步插件，不只克隆 core，也不追踪子模块远端分支；不复制旧 `.eln`／字节码。root 采用自己所有的独立副本，不执行普通用户可写配置。Windows 共享配置已同步，当前完整模块及验收边界见[Gentoo musl 迁移复盘](/posts/gentoo-musl-llvm-pc-migration/gentoo-musl-llvm-pc-migration/)。

### VSCodium 的宿主入口与认证

系统级 Flatpak 安装后，可以直接 `flatpak run com.vscodium.codium`。需要 shell 入口和 Chromium／Node 扩展代理时，先审阅 PC `scripts/launch-codium.py`：它按进程转发调用 shell 的代理，并为 Node 启用 `NODE_USE_ENV_PROXY`，不关闭 TLS 或把代理写成全局默认。完整安装和验证边界见迁移文章及跨平台 VSCodium 配置说明。

`install-postboot-desktop.py` 仍带本次实验根身份限制，不能作为任意新机一键安装器；不要删除保护条件来照抄执行。新机应部署已审阅的独立启动器和字体文件，而不是复用私有实验状态。

VSCodium 的运行参数在 `~/.vscode-oss/argv.json`，账户加密使用 `"password-store": "gnome-libsecret"` 与已解锁的钱包。恢复旧会话、基础 GitHub 登录与扩展新增权限分开处理，不把令牌写进公开配置。编辑器已经运行时，新的代理环境不会可靠地影响旧进程，正常退出后再从正确 shell 重开。

### musl 路线的 Java 与 IDE

#### 统一 Dragonwell Standard 21

宿主采用现有仓库补丁组提供的 Dragonwell **Standard 21 LTS**，通过 Portage 与 `eselect java-vm` 管理。Flatpak 内的 Java 工具使用同版本的私有 glibc 构建，不把 musl JVM 与 glibc JNI 混用；不启用要求 JDK 25 的扩展。

Oracle Java 扩展与 Standard 21 的补全、编译、断点调试及 Maven 模板／JUnit 已通过，日常 Java Hello World 与 Windows 配置同步也已人工确认。Gradle、Spring 和具体项目仍按用途验收，不把一个示例推广为全部项目兼容。脚本和验收资产维护在 dotfiles 的 `main` 分支；具体补丁顺序、SHA256 与边界集中于[Gentoo musl 迁移复盘](/posts/gentoo-musl-llvm-pc-migration/gentoo-musl-llvm-pc-migration/)，不在主安装步骤重复维护一套配方。

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

musl 同步后还需先在 PC 配置目录执行仓库补丁恢复预检，确认兼容后显式 `--apply`，再重新预演；不能跳过补丁恢复就执行安装。确认依赖图后再执行更新。内核更新完成后核对版本化内核、initramfs、模块和签名；只有新内核实际启动成功，才使用 `eclean-kernel` 清理旧版本。

### Portage 国内镜像分工

当前 PC 配置没有把“镜像”视作一个可互换的地址，而是按 Portage 的不同数据层分别处理：

| 数据层 | 当前首选 | 仍然保留的验证或回退 |
| --- | --- | --- |
| Gentoo ebuild 主树 | USTC Git 浅克隆 | Gentoo Release Key 验证提交签名、拒绝超过三天的仓库时间戳；备用源按可达性临时选择，保留签名验证 |
| distfiles 源码包 | USTC → 华为 → 阿里 → TUNA → 官方 | 国内源优先，临时回官方也保留强哈希校验 |
| 官方 binhost | USTC 的 `x86-64_musl_llvm` | `verify-signature = true`；来源必须匹配当前 LLVM profile |
| gentoo-zh | 南京大学 Git 镜像 | Git 提交与 ebuild 自身的校验链不因镜像而关闭 |
| GURU、SonicDE、XLibre | 各自上游 | 不为追求形式统一而改写没有对应镜像的仓库 |

[MirrorZ Gentoo 帮助页](https://help.mirrors.cernet.edu.cn/gentoo/) 也特别区分了 stage3、distfiles、binhost 与 Portage ebuild 主树。`mirrors.cernet.edu.cn` 是联合镜像的动态调度入口，不是 MirrorZ 自己存放所有内容的单一站点，后端高校节点可能变化。原文的联合入口取舍来自 2026-09-01 的测量；上表已按 2026-11-23 配置核对更新。镜像可达性会变化，不把旧测量当作永久排序。

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
sync-uri = https://mirrors.ustc.edu.cn/gentoo/releases/amd64/binpackages/23.0/x86-64_musl_llvm
priority = 1
verify-signature = true
```

镜像暂未同步时，可临时使用官方对应目录，保留相同 ABI 路径与签名验证。不要只更换域名而混用 `x86-64_llvm` 与 `x86-64_musl_llvm`。

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

本机配置继续以 [Cyberl-ty02/dotfiles](https://github.com/Cyberl-ty02/dotfiles) 为准。musl 新机先审阅当前 PC 根配置，不直接套用 glibc 历史角色清单；[`world_packages.txt`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/world_packages.txt) 只作为完整复原时可审阅的目标清单，不是不经检查就执行的安装脚本。恢复完成后可运行 `gentoo_setting/scripts/verify.sh pc` 检查清单、配置语法、chezmoi dry run 与真机 world 差异。

## 参考资料

- [Gentoo musl 迁移复盘](/posts/gentoo-musl-llvm-pc-migration/gentoo-musl-llvm-pc-migration/)：本机当前方案与验收边界；旧故障文章用于理解原因。
- [VSCodium 跨平台配置](/posts/vscodium-sync/vscodium-sync/)：当前 Java21、扩展与宿主桥接入口。

- [Gentoo AMD64 Handbook：完整安装篇](https://wiki.gentoo.org/wiki/Handbook:AMD64/Full/Installation)：本文章节组织的参照，具体工具选择仍按 musl／OpenRC 与本机启动方案区分。

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
