---
title: Gentoo musl 迁移复盘
permalink: /posts/gentoo-musl-llvm-pc-migration/gentoo-musl-llvm-pc-migration/
comments: true
toc: true
donate: false
share: true
date: 2026-11-13 10:00:00
categories: Linux 与 BSD
tags:
- Linux
- Gentoo
---

这篇文章整理我把日常 Gentoo PC 从 glibc／LLVM 迁到 musl／LLVM 的安装路线。桌面继续使用 SonicDE、XLibre 和 OpenRC；闭源应用、Java 与 CUDA 则按各自的 ABI 和运行环境安排，不把所有兼容库塞进主系统。

全新安装从[Gentoo musl 安装指南](/posts/gentoo-musl/gentoo-musl/)开始。本文记录 glibc 到 musl 的验证过程、兼容方案和重编结果。已有 glibc 系统迁移需要独立目标根。

> **当前状态（2026-11-23）**
> musl／LLVM／OpenRC 已完成真机迁移，是配置仓库 `gentoo_setting/pc/` 的默认 PC 方案。日常桌面与 Windows 配置同步已人工确认；旧系统归档完成隔离恢复后，按明确决定退役。下文保留有复用价值的故障与验证边界，不再按实验批次追加进度。
> 文中的版本用于说明验收基线，新机安装和后续升级均以当前仓库、配方及硬件为准。

## 这套配置最后会得到什么

### 主系统与兼容环境的分工

```text
profile：default/linux/amd64/23.0/musl/llvm
工具链：Clang／LLVM、libc++、mold、ThinLTO
init：OpenRC
文件系统：Btrfs，根 @，家目录 @home
桌面：SonicDE + XLibre，PipeWire，Fcitx 5／Rime
内核与启动：XanMod／CJKTTY，shim + rEFInd + 本地 MOK
JVM：Dragonwell Standard 21，musl 与私有 glibc 构建分开
日常闭源应用：优先 Flatpak；特殊应用使用受管理的私有运行库
CUDA：原生驱动兼容层与私有 SDK 分开维护
```

“没有原生 GCC／glibc”只描述宿主安装。Flatpak SDK 内仍有自己的 glibc 和 GNU 工具，Bash、GNU make、autotools、GNU-EFI 所需 binutils 也分别保留。本文没有把“全 LLVM”解释为删除整机所有 GNU 组件。

公开配置由 dotfiles 的 `gentoo_setting/pc/` 维护，配置根 README 负责入口、约束和验收边界，本文负责安装思路与排错。逐包迁移去向见 `world-migration.tsv`；源码、配方补丁与移除条件见 `patchsets/`。这些入口统一列在文末参考资料中。

### 已完成的验收与剩余边界

| 项目 | 当前结果 | 按实际需要另行验证 |
| --- | --- | --- |
| UTF-8／ICU／字体 | 中文文件、字符处理、格式化、系统与 Flatpak 字体匹配通过 | 旧编码与逐个应用的语言实现 |
| NVIDIA／CUDA | 新内核模块真实加载、CUDA／NVML、NVCC／CMake／RDC、八项 Python 数学检查与600秒有限负载通过 | 长期生产模型、多 GPU、GPUDirect、完整数学边界 |
| 原生显示 | SonicDE／XLibre 真机登录及日常桌面已人工确认，私有 EGL 离屏回读通过 | 特定外接显示、PRIME、Vulkan、休眠与功耗 |
| Flatpak／日常应用 | 系统部署与触发器通过；用户确认微信、WPS、VSCodium、音视频与 FlClash TUN 日常正常 | 逐款账号、DRM、会议共享与所有设备场景 |
| IDE／Java | Dragonwell Standard 21、Oracle Java、Maven模板／JUnit及精选插件通过，Windows 配置同步已人工完成 | 其他插件组合和具体课程／业务项目 |
| 新机基础 | 官方 stage3 正确解压、默认 Portage 用户／沙箱构建、完整桌面安装通过 | 新硬件驱动选择、签名登记和现场设备验收 |
| 系统与用户 | 新根多次启动、普通更新、唯一 HOME、root／用户独立 Zsh／Doom 与资料接续完成 | 不以日常反馈替代全部应用专项测试 |
| 归档与退役 | 旧 root／home／boot 实际隔离恢复及只读 scrub 通过；按明确授权已删除三份旧密文及专用恢复凭据 | 不再安排旧系统回退启动，也不声称做过该测试 |

安装成功、隔离 GUI、真实硬件和用户日常使用是不同层次。空白配置下的窗口正常，不代表旧账户、登录凭据或全部插件兼容；复用下载缓存的安装，也不算空缓存下载全流程验收。

## Stage 0：准备独立的 musl 安装基础

### 选择 stage3 与目标根

本次从官方 `stage3-amd64-musl-llvm-openrc-20261108T170107Z.tar.xz` 开始，核对发布签名与 SHA512 后解压。新机应选择官方当前归档及对应发布密钥，不需要固定使用这份历史文件。

新装直接创建 `@`、`@home`。从现有系统迁移时，可先用独立根和 HOME 验证，再安排切换；本次曾使用 `@musl`、`@home-musl`，它们只是临时子卷名，不需要为迁移重新格式化已有分区。

> **迁移与全新安装的区别**
> 有旧系统时，应在对应数据和恢复路径验收前保留旧根、旧 home、启动入口与独立备份。本机已经走完这一步，并最终退役旧恢复来源；这项决定不能照搬到尚未完成验收的机器。

### 正确解压，再验证 Portage 用户与沙箱

早期非特权解压的实验夹曾调整属主与隔离设置，不能直接作为正式系统。正式根重新从已验签 stage3 建立，保留 numeric owner、权限、符号链接和扩展属性，再核对基础包。

随后使用默认 Portage UID/GID 250:250，在正常 `sandbox`、`userpriv`、`usersandbox`、`ipc-sandbox`、`network-sandbox` 和 `pid-sandbox` 下编译并运行小包。这一步先确认安装基础，避免把“root 能编译”误当作“新机可正常安装”。

进入 chroot 前，仍需准备目标根的 `/proc`、`/sys`、`/dev`、`/dev/pts`、网络、DNS、CA 证书与时间。不要把安装介质的账户、根参数或驱动版本直接写进目标系统。

## Stage 1：初始化 Portage 与 LLVM 工具链

### 按当前仓库恢复配置与补丁

在目标 chroot 中克隆独立工作区，不覆盖已有改动：

```sh
git clone --branch main --single-branch \
  https://github.com/Cyberl-ty02/dotfiles.git /root/dotfiles-musl
cd /root/dotfiles-musl/gentoo_setting/pc
```

先审核 profile、`make.conf`、包级规则与硬件选择，再部署所需配置，不能整棵覆盖 `/etc`。本机的 `-march=native`、并行任务数与构建空间不是所有机器的推荐值。

#### 配方补丁与源码补丁分开

`patchsets/*/repository/` 调整已有仓库的配方、依赖或 Manifest，`source/` 修正解包后的上游源码。Portage 用户源码补丁不能补上缺失的 `DEPEND`；因此不能只复制 `package.*` 和用户补丁，就认为重装路径完整。

同步仓库后，在 PC 配置目录执行：

```sh
python3 scripts/restore-repository-patches.py
# 全部预检通过并审核范围后，才显式写入。
python3 scripts/restore-repository-patches.py --apply
emerge --pretend --update --deep --newuse --autounmask=n @world
```

恢复工具先检查全部有序补丁组，已包含相同修复时跳过，不兼容时停止，不向仓库写入半组修改。源码补丁仍由 Portage 在解包时检查。历史构建提交和维护核验 HEAD 分列在 `repository-baseline.tsv`，不靠回退整个仓库维持旧补丁。

#### 保持规则可维护

`package.*` 按包原子升序，忽略前导版本运算符，同一选择器与附属注释保持顺序；独立 env 键和仓库节同样排序。`make.conf` 保持变量依赖、功能分组和国内镜像优先顺序，不做全局字母排序。

日常规则优先限定包、slot 或受影响版本范围，不把全部软件永久锁在验收版本。Neomacs live 配方不默认锁提交；Dragonwell Standard 21、内核／驱动配套与签名约束则需通过各自升级检查后再调整。

### 设置 mold 与 ThinLTO

#### 首次引导与链接器分工

全新 stage3 先用 LLD／无 LTO 准备 mold 和匹配 LLVMgold，再切到最终默认，避免工具链尚未齐备就要求重型 ThinLTO 链接。准备好配置后，在目标 chroot 的 PC 目录执行：

```sh
emerge --ask sys-devel/mold
bash scripts/configure-linker.sh --linker mold --dry-run
bash scripts/configure-linker.sh --linker mold
portageq envvar LD
```

脚本自动识别 Clang 主版本，支持显式 `--clang-major`，备份后修改；撤回时使用 `--linker lld`。LLVM 升级与 CONFIG_PROTECT 合并后，应复核新主版本的配置。

普通构建使用 `LD="ld.mold"`，Clang 使用 `-fuse-ld=mold`。内核保留 LLD，GNU-EFI／rEFInd 保留 BFD。这不会替换 `/usr/bin/ld`，也不会把已安装软件全部重新链接。C/C++ 与 Cargo release 的 ThinLTO 由当前配置管理，Flatpak SDK 内的工具链独立维护。

#### musl 线程栈与包级例外

curl 的 ThinLTO 链接曾在 mold／LLVMgold 中崩溃。同一组目标文件用 LLD 成功；仅把独立 mold 副本的默认线程栈调到 8MiB，也能成功。最终补丁仅在 musl 构建 mold 时设置 8MiB 非可执行默认栈，没有关闭全局 ThinLTO 或修改系统 ulimit。正常沙箱重建后，原故障链接与库初始化通过；上游提供等效保证后需撤回复验。

NVIDIA 私有加载器的早期启动对象另有 LTO 边界：早期入口不能依赖尚未完成的运行时解析，因此只对相关对象禁用 LTO。普通对象仍保留 ThinLTO，原始系统 musl 不替换。小型 C／C++、TLS、线程、dlopen、libc++ 与离线 Cargo 检查通过，但不代表每个项目自带的链接策略都被全局配置覆盖。

### LLDB 与其他用户态工具

LLDB 22.1.8 已通过原生 musl C++ 的断点、变量、表达式、继续至退出及 Python 绑定检查。配方过滤 LTO，而现有 LLVM 静态库含 ThinLTO 对象，故仅该包使用 `linker-lld`；全局 mold 保持。定向依赖预演后移除了 GDB，没有建立不兼容的命令别名。

uutils-coreutils、uutils-findutils、Toybox 和 Dash 已并行安装。uutils 保留 `uu-`／`uutils-` 前缀，Toybox 使用独立入口，未覆盖核心命令或 `/bin/sh`。除了最小运行检查，也做过无系统 PATH 回退的排序、复制、哈希、路径与空字符传递验证，仍不等于完整 GNU 行为兼容。

LLVM 的归档和二进制工具已在登录环境生效；`AS="clang -c"` 保持，因为 `llvm-as` 处理的是 LLVM IR，不能直接替代系统汇编步骤。

## Stage 2：安装桌面与应用运行环境

### 原生 musl 与私有 glibc 的边界

SonicDE、XLibre、输入法与主系统工具采用原生 musl。闭源桌面应用和现有 glibc 扩展优先复用 Flatpak；确有额外权限或布局要求的应用，再使用受 Portage 管理的私有运行库。

gcompat 可以覆盖部分 ABI，不是完整 glibc：早期测试中，一些工具连版本查询都会崩溃。不能因为最小 CUDA 调用成功，就把它推广为整个显示栈或所有闭源程序的兼容方案。私有 glibc、JNI 与 SDK 库不进入宿主全局搜索路径，Flatpak 库也不用于满足宿主 Portage 依赖。

### 安装原生 SonicDE 与输入法

默认 Portage 用户与沙箱下的全新桌面构建已经通过。首次解依赖曾出现 GLib → docutils → Pillow → HarfBuzz → GLib 循环：只在引导时临时关闭 Pillow 的 `truetype`，依赖就绪后删除临时规则，再按最终 USE 重建。不要把引导开关作为最终配置发布。

musl profile 屏蔽了 PowerDevil 的 `filecaps`，SonicDE 实现与兼容包需要同时采用 `-filecaps`。音量界面对应 meta 的 `pulseaudio` 选择，但服务端仍使用 PipeWire，不额外安装独立 PulseAudio daemon。防火墙保留 firewalld，音频、网络与防火墙分别由各自服务管理。

图像编辑、登录管理器、KWayland 等构建问题集中在文末排错索引，修复按补丁组管理。输入法要验证实际提交：Rime 曾经 LevelDB 带入 tcmalloc，造成 initial-exec TLS 错误，按包关闭后，原生与 Flatpak 中的“你好”输入通过，不给整个桌面设置 `LD_PRELOAD`。

### 在 chroot 内安装 Flatpak 主包

#### 系统级安装与镜像

先通过 Portage 安装 Flatpak，再在目标 chroot 的 PC 配置目录执行：

```sh
bash scripts/install-flatpak-apps.sh --dry-run --system
bash scripts/install-flatpak-apps.sh --system
```

系统级部署写入目标根的 `/var/lib/flatpak`，无需先登录桌面，也不在 chroot 中启动 D-Bus、Portal 或 GUI。默认主包清单由 `scripts/flatpak-apps.txt` 维护，本次包括：

```text
cn.wps.wps_365
com.qq.QQ
com.tencent.WeChat
com.tencent.wemeet
com.vscodium.codium
org.localsend.localsend_app
org.mozilla.thunderbird_esr
```

默认使用中科大缓存并保持签名验证，临时回官方源时执行：

```sh
bash scripts/install-flatpak-apps.sh --system --official
```

再次运行默认命令恢复国内缓存。厂商 `extra-data` 仍可能来自厂商站点；镜像缺失、下载中断和应用安装失败应分开处理，不跳过长度、哈希或签名校验。代理沿用调用环境，不给新机硬编码本地端口。

只为已登录用户安装时可以使用 `--user`，与系统级选一种即可。对应更新命令为 `flatpak update --user` 或 `flatpak update --system`；运行时、语言和图形扩展由 Flatpak 解析，不把某台机器的 NVIDIA 版本当成通用依赖。

#### 日常应用的验证范围

WPS 使用单独维护的中文 `cn.wps.wps_365`，不把国际版混入默认清单。隔离配置中完成过中文 DOCX 编辑、保存、重开与 CRC／XML 检查；需要切换语言时，在目标用户的 `~/.var/app/cn.wps.wps_365/config/Kingsoft/Office.conf` 的 `[General]` 下设置 `languages=zh_CN`，不替使用者预先接受许可。

腾讯会议通过签名维护包打开过完整中文登录界面；LocalSend、Thunderbird ESR 和 QQ 的隔离中文界面也通过。后续人工日常反馈覆盖微信、WPS、VSCodium 与音视频，但会议共享、DRM、特定设备、邮件账户及局域网传输仍应按用途验证。

### Dragonwell Standard 21 与 Java IDE

#### 宿主和私有 JVM 分开

所有 JVM 统一使用 **Dragonwell Standard 21 LTS**，不回退到 bundled JDK 25。宿主使用官方 Standard Alpine／musl 构建，经发布哈希与 Manifest 校验，按包调整 Alpine 与 Gentoo 的 musl 库名差异，不创建全局 libc 别名。

配方使用 `java-vm-2`，由 Portage 管理版本化 `/opt`、系统证书与 `virtual/jdk:21`。glibc JNI 应用使用同补丁版本的私有 glibc 构建，由同一包的 `glibc-runtime` 开关管理，不注册第二个宿主默认 VM。两种 libc 的 JVM 不能互换。

本次通过 javac、中文读写、货币／时区、字体图像和 Java21 项目检查；具体 JNI、远端 TLS 与业务项目仍需各自验收。升级时重验官方归档、虚拟包 provider 和安全更新，不把历史补丁目录当作永久发行版本锁。

#### VSCodium 的 Java 路线

本次基线中的 Red Hat Java 要求 JDK 25，单改路径为 21不能满足最低要求。最终选择 Oracle Java，配合 Dragonwell Standard 21，通过补全、符号、中文编译、DAP 断点与表达式求值；扩展版本号不等于 JDK 主版本。

Maven 模板生成、Java21 编译与 JUnit 也已通过。Flatpak 编辑器使用受控宿主桥接调用原生 Maven，不混合宿主 musl 与 SDK 的库。Maven 代理需单独核对私有 `settings.xml`，不能只依赖 shell 代理。完整跨平台清单和同步方法见 [VSCodium 配置文章](/posts/vscodium-sync/vscodium-sync/)。

### FlClash 的私有运行库

FlClash 涉及 Helper、TUN 与系统代理，不能假定普通 Flatpak 安装能覆盖全部权限路线。当前配方复用 FDO 运行时、私有 glibc Standard21 和经签名索引／逐包哈希核验的小型托盘库；不执行外部发行版安装脚本，也不引入全局 glibc。

最初灰屏来自 Flutter AOT 被普通 ELF 重定位工具改写。最终脚本保护无 `DT_NEEDED` 的 AOT 数据和静态 Core 原字节，只调整需要私有解释器／RPATH 的动态 ELF；重复应用跳过，上游结构不兼容时在写入前停止。原生子命令恢复调用者环境，避免继承前端的私有 GIO／库路径。

在 PC 配置目录中，为这条路线准备系统运行时：

```sh
bash scripts/install-flatpak-apps.sh --system --flclash-runtime
```

实际 GUI 的配置导入、Core 启动、回环代理正文、停止后端口关闭，以及独立网络命名空间中的 TUN TCP 正负对照通过。隔离测试没有代替本机授权；后续用户已确认真机 TUN 日常正常。订阅、代理配置与认证状态始终留在本机，维护入口和移除条件见 FlClash 补丁组。

## Stage 3：整合内核、NVIDIA 与 CUDA

### 内核、模块与 Secure Boot 成套处理

新机的 shim＋rEFInd 安装使用 Gentoo 官方的 `refind-install --shim /usr/share/shim/BOOTX64.EFI`，步骤与检查见安装指南。本文中的固定菜单和迁移 hook 记录已验收的本机历史，不要求新机另写 EFI 复制器或手工创建相同固件项。

XanMod、匹配的五个 NVIDIA 模块、四份 GSP／ucode 固件与 initramfs 分开打包，但必须配套验证。模块沿用 Gentoo 编译与签名流程，固件从官方归档经 Manifest 校验提取，不运行厂商安装器。rEFInd 保留所需 GNU-EFI／BFD 例外，签名材料由目标机器本地管理。

本次内核启用 CJK16／32、ThinLTO、动态抢占与强制模块签名。`preempt=full` 是动态抢占模式，不等于 PREEMPT_RT，也不保证更高编译／CUDA 吞吐或更低功耗。生成启动参数前需确认目标根 UUID 与子卷；chroot 的 `uname -r` 是正在运行的内核，不能用来选择目标模块目录。

#### 生成并检查最终 initramfs

安装内核时自动生成的中间镜像可能还没有匹配 NVIDIA 模块。模块、固件、helper 和权限配置就绪后，应重新生成最终镜像，再核对存储驱动、五个模块、GSP、微码、签名与根参数；私钥不能进入镜像。

hostonly 镜像依赖正确 `/proc`、`/sys`、`/dev` 和 `/run/udev/data`。硬件元数据不可靠时，先用通用镜像并检查 ESP 空间，不复用另一台机器的成品。镜像膨胀主要可能来自固件和微码，而非内核本体，不能为了腾空间提前删除尚需保留的启动路径。

#### GPU 设备节点与权限

模块加载不代表 CUDA 已可用。官方小型 `nvidia-modprobe` helper 与 OpenRC 准备正确节点；权限由驱动参数及早期镜像共同决定，一次 `chmod` 不能替代持久配置。当前启动已核验 GPU 调用前后保持 `root:video 0660`，没有改成所有用户可写。

### NVIDIA 用户态的 musl 兼容层

这条路线参考 Chimera 的 NVIDIA 草案：私有目录内使用带 IFUNC／TLS 修复的 musl 加载器、gcompat 与兼容 shim，再安装匹配驱动库。它由现有仓库补丁和正常 Portage 安装管理，位于 `/usr/libexec/nvidia-musl`，不替换系统 musl 或全局图形库。

本次 620.70.06 基线通过核心库加载、EGL 1.5／OpenGL 4.6 离屏回读、CUDA 显存往返与 NVML；默认加载器对照仍报重定位37。私有 XLibre DDX／GLX 入口还通过 dummy 会话，后来新内核和 SonicDE／XLibre 真机登录也已通过，桌面合成使用 Intel／Mesa。不能将这些结果扩大为 NVIDIA 驱动的 PRIME、Vulkan、外接显示或休眠均已验收。

`nvidia-musl-run` 只处理单个动态 musl ELF，不会自动转换脚本、子进程或完整桌面会话。草案源码基线、补丁许可证、应用顺序与移除条件仍需逐版复核。

### CUDA 的三种使用范围

#### 原生 Clang device-only

数据包提供 CUDA 头文件、CCCL、libdevice 及必要兼容头，已通过实际数学 kernel 的 PTX 生成。它不包含完整 NVCC、ptxas 或宿主运行库，不能当作完整 CUDA SDK，也不代表 Clang 完整支持该 CUDA 主版本。

#### 私有 NVCC／CMake SDK

`dev-util/cuda-sdk-flatpak` 由 Portage 管理官方归档和启动器，普通用户首次运行时校验并解包到自己的缓存，使用系统级 Freedesktop SDK。本次 NVCC 13.4 与 SDK 内 GCC 16.2 产生 glibc ELF；编译、链接、运行都留在同一个 SDK，不混入原生 musl C++ 对象。

在目标 chroot 的 PC 配置目录准备：

```sh
bash scripts/install-flatpak-apps.sh --system --cuda-sdk
emerge --ask dev-util/cuda-sdk-flatpak::gentoo-zh
```

脚本中的 SDK 和 NVIDIA 扩展选择需与目标驱动核对，不能按安装介质猜测。登录后，以普通用户在项目目录运行：

```sh
cuda-sdk nvcc --version
# math.cu 是自己的测试源文件；架构按目标 GPU 选择。
cuda-sdk nvcc -std=c++17 -arch=sm_89 --cudart=shared math.cu -o math
cuda-sdk ./math
```

CMake 项目同样使用 `cuda-sdk cmake`、`cuda-sdk ctest`。入口默认只开放项目与工具缓存、关闭网络；确有需要时单次设置 `CUDA_SDK_NETWORK=1`。卸载 Portage 包不会自动删除用户缓存。

#### Python GPU 环境与实际验收

Python GPU 应用复用 SDK 的 glibc Python，以标准 venv／pip 管理 wheel；不向 musl 宿主安装这些库。本次 PyTorch wheel 使用 CUDA 13.0 运行库，独立于核心 NVCC 13.4 工具包。启动时只移除核心工具包的库前缀，保留 Flatpak NVIDIA 驱动路径；清空整个库路径会导致 `libcuda.so.1` 缺失。

系统级 SDK 就绪后，在真实桌面以普通用户、从配置仓库根执行：

```sh
sh gentoo_setting/pc/scripts/cuda-python.sh --setup --dry-run
sh gentoo_setting/pc/scripts/cuda-python.sh --setup
sh gentoo_setting/pc/scripts/cuda-python.sh --check --seconds 600
sh gentoo_setting/pc/scripts/cuda-python.sh --run -c 'import torch; print(torch.cuda.is_available())'
```

环境默认位于用户 XDG 数据目录的 `gentoo-gpu/.venv`，可用绝对路径 `CUDA_PYTHON_HOME` 为项目指定受限工作区。SDK Python 次版本变化时重建环境，不在 musl shell 直接激活其中 venv 或执行它的 Python。

本次 NVCC／CMake／CTest、跨翻译单元 RDC 与 32 项 GPU 回读通过；Python 的矩阵、FFT、线性求解、卷积、反向传播、稀疏运算、cuRAND 与 NumPy 八项检查及 `pip check` 通过。另以 1024 阶矩阵执行 600 秒、11,774 轮有限合成负载，确认没有混入核心工具包库。这不是满载性能、长期稳定性、多 GPU、GPUDirect 或具体生产模型结论。

## Stage 4：首次启动与用户环境接续

### Btrfs、rEFInd 与第一次启动

本次先以独立菜单启动候选根，保留原系统；验证新内核与隔离 HOME 后，再停用应用完成最终数据同步。随后核对 fstab、内核命令行、rEFInd 与备份引用，利用本机确认的子卷 ID 完成名称整理，现用根和 home 已统一为 `@`、`@home`。

子卷改名不改变分区 UUID 或子卷 ID，但按名称引用它的配置都要核对。本文不提供本机历史 ID，也不把临时迁移布局作为新机要求。首次启动后先确认实际环境：

```sh
uname -r
findmnt -no FSTYPE,FSROOT,OPTIONS --mountpoint /
findmnt -no FSTYPE,FSROOT,OPTIONS --mountpoint /home
findmnt -no FSTYPE,OPTIONS --mountpoint /boot
printf '%s\n' "$HOME"
portageq envvar ELIBC
eselect java-vm show system
```

核对输出来自目标根，用户 HOME 与身份正确，ELIBC 为 musl；版本号则与本次实际安装一致。本机的首次候选启动、返回旧系统以及合并 HOME 后多次启动都已经完成，但未从后来恢复的旧归档再次启动。

### locale、字体与输入

#### musl 与 glibc 的差异

原安装指南里的 `locale-gen` 适用于 glibc，不能原样套到 musl。配置仓库提供了自动识别 Gentoo profile 的配置脚本：

```bash
# 目标 Gentoo/chroot 内，以 root 执行
bash scripts/configure-locale.sh --dry-run
bash scripts/configure-locale.sh --lang zh_CN.UTF-8 --timezone Asia/Shanghai
```

它先备份旧配置到 `/var/backups/locale-setup/`，再配置 `/etc/env.d/02locale`、`/etc/timezone` 和 `/etc/localtime`，最后执行 `env-update`。glibc 分支生成所需 locale，musl 分支不调用 `locale-gen`，也不复制 glibc 的 locale archive。两种后端已在各自真实根环境的独立配置夹中测试。

#### 系统语言与桌面覆盖

切换登录默认语言为英文，同时保留上海时区：

```bash
bash scripts/configure-locale.sh --lang en_US.UTF-8 --timezone Asia/Shanghai
unset LC_ALL
source /etc/profile
```

这只更新当前 shell 和后续登录环境；已经运行的桌面、应用和用户 D-Bus 需要重新登录。仅让一个命令使用英文时，可以把环境限制在该命令：

```bash
env LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 date
LC_ALL=C.UTF-8 emerge --sync
```

同步、编译日志中的临时 `LC_ALL` 不应成为整个桌面的永久语言设置。已有 SonicDE 用户的 `~/.config/plasma-localerc` 也可能覆盖系统默认值；应在新系统的目标用户下检查区域与语言，不直接覆盖旧家目录。

如果 `~/.config/plasma-localerc` 已存在，先保留一份用户配置：

```bash
# 新系统的目标普通用户下执行；文件不存在时无需备份
if [ -f ~/.config/plasma-localerc ]; then
    cp -a ~/.config/plasma-localerc ~/.config/plasma-localerc.before-musl
fi
kwriteconfig6 --file plasma-localerc --group Formats --key LANG zh_CN.UTF-8
kwriteconfig6 --file plasma-localerc --group Translations --key LANGUAGE zh_CN:en_US
```

想用英文桌面时，分别改为 `en_US.UTF-8` 和 `en_US`，然后退出桌面重新登录。系统脚本的备份不包括用户配置；需要撤回用户改动时，从刚保留的文件恢复。若仍有语言混杂，检查 `locale` 中的 `LC_*`、shell 启动文件里的 `LANG` / `LANGUAGE`，以及系统设置中各项格式覆盖。

迁移验证表明 `LANG=zh_CN.UTF-8` 被接受，只证明了一部分条件：原生 UTF-8 文件处理正常，但 libc 的日期、货币、排序和 iconv 数据与 glibc 不等价。独立 ICU 程序可以完成中文日期、人民币格式、中文排序及 GB18030 转换；应用有没有使用这条路径，要继续实测。

#### 首次登录后的检查

首次登录可先检查：

```bash
locale
date +'%F %T %Z'
fc-match 'sans-serif:lang=zh-cn'
fc-match emoji
flatpak run --command=sh com.vscodium.codium -c 'locale -a; locale'
```

Flatpak 的 glibc locale 需要单独检查。本轮修复语言内容后，运行时已实际列出 `zh_CN.utf8`，`locale` 不再报缺失。安装脚本通过 `extra-languages` 自动处理中文和英文，不要求新机器手工修复语言扩展。中文分片实际是 `/zh`，不能凭 locale 名称猜成 `/zh_CN`。

字体名称与实际安装同样重要。系统通过现有仓库管理 HarmonyOS Sans 和 Nerd Font，宿主、Flatpak 分别检查匹配；缺少字体时只恢复旧偏好，仍可能落到楷体。需要对应字体时先核对关键词、许可和 USE，再安装：

```sh
emerge --ask media-fonts/harmonyos-sans media-fonts/nerdfonts
```

### 账户、应用资料与数据库

#### 在线预副本与停写后的最终复制

先核对数字 UID/GID、附加组、HOME、符号链接及服务账户，首次登录使用独立用户配置。普通用户和 root 密码在本机设置，不写入公开脚本，也不让后续导入覆盖新密码。

| 数据 | 迁移方式与边界 |
| --- | --- |
| 对话索引、SQLite、JSONL | 在线 SQLite backup 只是单库事务快照；多个库与追加文件需应用停写后统一核对 |
| 编辑器 User、WebStorage、Local Storage | 可能混合对话、界面与认证状态，先私有保留，不当作普通缓存删除 |
| 项目与个人文件 | 保留路径、权限与链接；旧 ELF、`.node`、venv、`.eln` 等按 ABI 重建 |
| 网络、蓝牙、钱包与账户 | 保留权限，在真实登录会话单独验收，不进入公开测试 profile |
| PostgreSQL | 核对版本、locale/provider、角色、扩展与表空间，按需要逻辑备份恢复，不直接搬旧 PGDATA |

WPS 等应用退出后仍可能留 socket／FIFO，复制时先确认写入者已停止，排除缓存、IPC 和设备节点。一次目录复制失败不代表文档损坏，应以重开、文件格式及必要校验判断。

#### 数据库和归档各自验收

合成 PostgreSQL 测试以 UTF8＋ICU `zh-Hans-CN` 验证了中文排序、约束、索引、dump/restore 与 LLVM JIT。新系统 PostgreSQL 18.6 的只读元数据核验见默认三个数据库，postgres 库用户关系、自定义函数与大对象计数为零；这不代替其他库审计或旧业务库恢复。用户日常反馈正常，也不能扩大为所有数据库专项通过。

旧 root／home／boot 曾做加密归档、完整长度和强哈希校验；2026-11-23 在数据盘的独立 Btrfs 文件镜像中实际恢复，root／home 接收为只读子卷，boot 解包，只读 scrub 通过，随后卸载并删除测试镜像。这个结果证明归档可恢复，没有启动恢复出的旧系统或数据库。

用户随后明确决定退役旧恢复来源。旧根、旧 home、三份旧密文及其专用凭据和审定残留已清理，现用数据、钱包、数据库、签名材料与运行库保留。因此不再把旧系统恢复列作当前待办；新的日常数据备份需单独管理。

### Zsh、Doom 与编辑器配置

#### root 与普通用户分开

普通用户保留 Zim／Powerlevel10k；root 使用 root 所有的独立副本，不执行普通用户可写脚本，也不共享历史与认证。`scripts/configure-root-zsh.py` 默认识别调用者；直接从 root／chroot 调用时必须通过 `--user` 指定源账户，不猜测新机用户名。

VSCodium Flatpak 的终端通过包内 `host-spawn` 使用宿主 Zsh。TTY、作业控制与 Ctrl+C 已通过；应新建终端检查，恢复的旧 sh 会话不会因默认 profile 改动而自动变成 Zsh。

#### Neomacs 与完整 Doom

原生 Neomacs 的 musl 编译、SQLite、Rime 与引导栈修复分别归入现有补丁组。它执行完整 Doom Emacs 框架，与 Windows 共用 `dot_config/doom/` 的模块和偏好，各账户各自生成插件与缓存，不导入旧 `.eln`。

以目标普通用户、从配置仓库根执行：

```sh
sh gentoo_setting/scripts/deploy-doom.sh
```

安装器先初始化 Doom core 记录的模块子仓库，再同步插件。普通用户完整 sync、GUI／TTY 开始页、SPC／Evil 和 Corfu／Vertico／Magit／Org 加载，以及 root 独立 TTY 已通过。Discount 与官方静态 ShellCheck 也已运行，不为此安装 GHC／GCC；可选语言模块及未来 live 更新仍需另验。日常修改模块后执行 `doom sync`，不维护另一份 PC 最小 init。

#### CLI、代理与钱包

`codium`／`vscodium` 启动 Flatpak 并转发调用 shell 的代理；原生 `codex` 复用扩展携带的静态 CLI，支持时使用 `--no-daemon`。Flatpak 内外命令可见范围不同，不把读取静态会话数据等同于全部工具调用通过。

VSCodium 的运行参数在 `~/.vscode-oss/argv.json`，`"password-store": "gnome-libsecret"` 使用 KWallet 6 Secret Service。旧钱包密码和新登录密码可能不同，应在本机解锁。基础账户已登录和扩展另要 `read:org` 是两件事，不清空钱包、关闭加密或由脚本扩大 OAuth 权限。

Actions 扩展曾把有效固定提交误报为不存在，实际是 Node 进程访问 GitHub API 超时。启动器按进程启用 `NODE_USE_ENV_PROXY` 并转发代理，不改成浮动 tag 或关闭 TLS。已有编辑器不可靠地继承第二次启动环境，应正常退出全部窗口后，从启用代理的 shell 重开。

## Stage 5：日常桌面与后续维护

### 整机源码重建与 xmake 接入

同版本源码重建清单覆盖 1353 项。分批合并日志与清单逐项核对，全部完成。
这项计数包括只能重新打包的二进制、固件和虚拟包。引导、内核及配套驱动、
数据库与缺失原配方的项目沿用各自的验证流程。

Make 和 Ninja 从本地 Portage 配置优先经过 xmake 转发，依旧使用包的上游构建规则。
本次日志可确认 774 个已合并包出现过转发命令。适配器就绪的提示本身不纳入计数。
原生试点单独验证过，整机批次最终移除了专用 ebuild 和 USE 试点，也撤回了
原先依赖的 Ninja eclass 补丁。新机未安装 xmake 时直接使用原后端。

重建中遇到两类中断。公钥包的 GPG 套接字超长通过缩短构建镜像挂载路径解决，
保留签名和沙箱校验。下载因网络变化出现停滞或失败时，先验证实际源码端点，
再按包版本与来源从原清单扣除已确认合并的包。仅靠 `--resume` 可能漏掉被
`--keep-going` 跳过的项目。Neomacs 的源码用浅克隆减少传输，OpenCV 的源码在
网络恢复后重新下载，两者最终均合并成功。官方源与代理只对本批单独生效。


### 桌面服务和会话行为

#### OpenRC、电源与网络

基础服务按角色启用：elogind 在 boot，D-Bus、NetworkManager、Sonic 登录器、firewalld、日志与时间同步在 default；iwd 通过 D-Bus 激活，PipeWire 属于用户会话。chroot 内登记服务不代表已经运行，真实登录后再验收总线、音频与 Portal。

power-profiles-daemon 已用官方 OpenRC 脚本加入 default，三个档位可读，保持 balanced。新机先检查 TLP／tuned 等冲突，再按需启用。NetworkManager 的 limited 曾来自探测域与 Fake-IP 不匹配，现用标准正文／门户探测模板，仅重载配置后恢复 full，没有关闭探测、重启 Wi-Fi 或放宽防火墙。

#### 登录恢复与终端补丁

不想在登录时恢复旧终端与 FlClash 窗口，可由桌面用户执行：

```sh
kwriteconfig6 --file ksmserverrc --group General --key loginMode emptySession
```

这只改一项，不覆盖整份用户配置、不关闭当前窗口，也不禁用主动设置的自启动。

Sonic Terminal 26.08.3 最小化后从任务栏消失，实际进程仍活着，原因是隐藏 QWidget 与 QML 窗口的状态同步。回补上游 75ba4c38 后，正常／最大化窗口的最小化与恢复通过。标签行漏出壁纸则经 X11 ARGB 确认为透明横行，另以局部背景补丁修复；顶部／底部、显示／隐藏标签和普通／半透明八组，以及真实启动项、新标签和新窗口检查通过，正文透明度保留。

补丁只按适用版本部署，等价上游修复与实机回归通过后移除。已有进程需方便时正常退出后重开，不强制关闭当前任务。用户已确认后续开机体验正常。

#### rEFInd 图标与 ESP 权限

手动 Gentoo 菜单显式引用自带 `os_gentoo.png`，内核更新生成菜单时保留该设置；不改内核、initramfs、签名或 BootOrder。Ventoy 图标保留来源和 GPLv3 许可，仅供 rEFInd 原生卷标匹配，不保证任意未知外接介质都能识别品牌。

`/boot` 保持 root 所有、目录 755／文件 644，普通用户可读不可写；FAT 的实际挂载权限需复核，更新内核仍由管理员完成。不要为文件管理器可读而增加免密码写 ESP 的权限。

### 升级、补丁与空间管理

配置恢复先预演，再实际更新。安装数据库有包，不表示同步后的仓库仍有对应兼容配方；Firefox 的旧 `llvm-r1` 适配在新 `llvm-r2` eclass 下就曾过期。先核对现行配方和补丁，不把失败当作卸载应用或强打补丁的理由。

本次普通更新已实际完成，Qt 6.11.3 与 SonicDE 6.8.2 真机使用通过，world 与保留库重建在验收时无待合并项。这是当时的结果，不保证未来同步后仍为零项。

同一目标根保持单个 Portage 写入者；失败先确定发生在下载、准备、构建、安装还是检查阶段，再从未完成项接续。保持正常沙箱和至少 20GiB 根分区余量，Btrfs 写时复制仍占元数据与小文件空间，目录 `du` 相加不能推导实际可回收量。

本机配置与博客已统一到 `main`，必要历史以本地 archive tags 保留，不再维护重复 glibc PC 配置。隐私处理改写过历史，旧克隆应先保存改动与未推送提交，优先重新克隆后迁入自己的变化，不直接合并新旧历史或重置未保存工作。博客构建、推送和生产部署分别决定。

## 常见问题与排错索引

这里保留能复用的“现象—原因—处理”。前文已经说明安装顺序与最终选择，索引不再重复每次重试、包计数或临时实验进程，也不公开原始日志。

### 安装基础与构建

| 现象或日志关键字 | 原因与采用的处理 | 后续维护 |
| --- | --- | --- |
| stage3 解压后不能以默认 Portage 用户编译 | 早期实验夹的属主、权限不适合作为安装基础。重新从已验签 stage3 保留 numeric owner、xattrs 和权限解压，检查归档条目及基础包，先用默认用户和沙箱编译小包 | 不把 root 编译成功当作新机可安装；解压设备节点所需权限只用于目标目录 |
| GLib／docutils／Pillow／HarfBuzz 循环依赖 | 临时关闭 Pillow 的 truetype，完成引导依赖后恢复并重建 truetype | 临时开关不进入最终配置；检查字体功能已恢复 |
| Darts 的 random_shuffle 编译失败 | 旧源码不兼容编译器默认 C++17，限定受影响版本使用 Clang C++14 | 上游改用新接口后删除例外，不回装 GCC |
| Rime 动态加载报 initial-exec TLS | LevelDB 引入 tcmalloc；使用已有 -tcmalloc USE 重建后，实际输入“你好”通过 | 不给整个桌面设置 LD_PRELOAD |
| Sonic 图像编辑找不到 Highway，登录管理器缺 POSIX 类型 | 分别补配方依赖／标准 CMake Config，以及直接包含 sys/types.h | 配方与源码分层；上游已包含的修正不反向撤回 |
| KWayland 缺 WaylandProtocols，scanner 不接受 PRIVATE_CODE | SonicDE ECM 不提供 KDE 的两个 finder。旧可选后端能关闭时先按应用处理；后来真实依赖 KWayland 时，在该包构建目录使用有许可证的 KDE 上游模块回退 | 不替换全局 ECM；系统恢复模块时自动跳过回退 |
| lowdown 配置宏冲突、ipset 导出符号不存在、nftables Ethernet 重定义 | 各自采用上游回补或小型版本范围源码补丁 | 不修改系统头文件、不全局放宽链接检查；对应补丁组记录移除条件 |
| Neomacs 的 execinfo、终端类型及 SQLite 编译问题 | musl 条件编译及类型修正放源码补丁，SQLite 特性放现有配方补丁 | 先严格应用／撤回检查，live 源码改变时停止复核 |
| Neomacs 引导时 mprotect/mmap: ENOMEM | 原栈段剩余空间被误当作消耗量，栈分配递增；每段重置探针并正确处理展开后，调用与 Lisp 引导通过 | 诊断内存上限不进入生产；已验收的增量构建不冒充空缓存重建 |
| curl ThinLTO 链接时 mold／LLVMgold SIGSEGV | 同对象 LLD 成功，仅改 mold 默认线程栈为8MiB也成功。正常配方仅在 musl 下设置非可执行8MiB默认栈，再以旧故障对象复验 | 首次只用 LLD 引导重建 mold；不改变全局 mold／ThinLTO。检测 ELF 时应读 p_memsz，不是 p_filesz |
| Firefox 的 LLVM helper 导出冲突，Rust build.rs 报 Dynamic loading not supported | 先对齐该 Firefox 配方的 eclass 接口；再为 musl 宿主构建脚本使用动态 musl 的临时 rustc wrapper | 不改全局 Rust 或 libc；已有 RUSTC_WRAPPER 时拒绝覆盖 |
| Bun 的 libstdc++／SONAME 检查不通过 | 验签并校验 Alpine 运行库，只在私有包中调整 musl／LLVM ABI 的 NEEDED 名称 | 不建立全局 libc 别名，不用屏蔽 QA 代替修复；完整博客构建已在原生 musl 验证，空缓存依赖下载是另一项 |
| LLDB 与现有 LLVM ThinLTO 静态库链接失败 | 仅该包使用 linker-lld，原生 C++ 断点、变量、表达式与继续运行通过 | 不因此替换全局 linker 或宣称全部 GDB 功能等价 |
| sec-keys 包的 gpg-agent IPC 失败 | 深工作目录使 browser socket 超出 Unix socket 路径限制；把临时 GNUPGHOME 缩到包私有构建根。后来的全量重编译又遇到同类失败，因为整个工作区更深。将原构建镜像挂到较短的私有路径后复验，LLVM、GnuPG 等公钥包通过 | 保持导入、签名、Manifest 和沙箱校验；不使用个人 keyring |
| 依赖预演拉入 LLVM 新主版本或其他 JVM | 临时预演曾漏掉既定 autounmask 策略；Java 插件又自行捆绑要求 JDK 25 | 恢复原策略重新预演；统一 Dragonwell Standard 21，Oracle Java 扩展版本号不是 JDK 版本号 |
| NVIDIA helper 安装提示预剥离或手册压缩 QA | 使用上游 Makefile 的 DO_STRIP=、MANPAGE_GZIP= 关闭厂商安装阶段的剥离／压缩，由 Portage 正常安装与处理 | 不用 QA 白名单掩盖警告 |
| NVIDIA 模块已存在但 CUDA 无法打开设备 | 模块加载和设备节点准备是两步，使用已有仓库中的官方小型 nvidia-modprobe helper 及 OpenRC 准备节点 | 检查真实 GPU 调用前后 root:video 0660；不改成所有用户可写。内核／模块／GSP／签名成套升级 |

### 私有运行库、桌面与数据

| 现象 | 处理与验收边界 |
| --- | --- |
| gcompat 下部分闭源工具连版本查询都崩溃 | 不把它当作通用 glibc。优先复用成熟 Flatpak 运行时；私有运行库不加入宿主全局搜索路径 |
| FlClash 出现窗口但内容灰白 | 单文件对照确认 Flutter AOT 被通用 ELF 重写破坏；保留无 DT_NEEDED 的 AOT 和静态 Core 原字节。普通 ELF 使用私有解释器／RPATH，同时恢复原生子进程环境 |
| FlClash 看似启动但代理端口拒绝连接 | 没有活动配置不等于代理已工作；Core RPC 初始化后必须配置并启动 listener。GUI 的全局端口又可能覆盖 YAML；实际验证 HTTP 正文、停止后端口关闭，以及隔离 TUN 流量 |
| 手工拼装腾讯会议运行时没有界面，进程却退出0 | 原厂启动器、布局、网络及私有库对照均保留；最终由维护中的正常包安装路径通过 GUI。不能仅凭可选 dlsym 探测或 clone EPERM 断言是致命 libc 问题，也不为此禁用沙箱 |
| WPS 测试配置复制失败 | 旧缓存中有 Unix socket／FIFO。关闭写入者，排除缓存和特殊节点后复制，DOCX 的 CRC／XML 与重开显示通过；复制失败不是文档损坏 |
| 新用户密码、doas、字体、壁纸和 HOME 不完整 | 软件根不是完整用户安装。按 UID／GID、正常 HOME、权限和导出配置分别补齐；密码在本机设置，活动数据库与认证存储不直接照搬 |
| Codex 报没有完整本地包，codium 命令不存在 | 复用已安装扩展携带的静态 CLI，并提供原生 Flatpak 启动器；Flatpak 内看到的命令与宿主不相同，支持时以 no-daemon 接续 |
| 中文回退到楷体或 locale 看似切换无效 | 同时检查宿主／Flatpak 字体匹配、musl 环境变量和 ICU／应用处理。HarmonyOS Sans 与 Nerd Font 由系统包维护；不复制 glibc locale archive |
| GitHub 反复提示授权 | 使用实际 argv.json 参数和解锁后的 KWallet Secret Service；基础账户持久化、旧密文解密失败与扩展新增 read:org 权限分开处理，不清空账户或把令牌改成明文 |
| Actions 编辑器误报固定提交不存在 | 经代理验证实际 GitHub API；Chromium 与 Node 扩展进程各自需要正确代理。保留固定 SHA 与证书校验，已有编辑器必须正常退出再从新环境启动 |
| NetworkManager 偶发受限网络 | 区分探测地址不可达、Fake-IP 与真实路由；采用实测直连可达的标准正文／门户探测，只重载配置 |
| root Zsh 或编辑器终端仍异常 | root 使用自己所有的独立 Zim／Doom 文件；清空环境的测试要提供 ZIM_HOME。编辑器终端通过 host-spawn 使用宿主 Zsh，恢复的旧 sh 会话不会自动变成 Zsh |
| Neomacs 空白欢迎页或 Doom 模块不全 | 轻量 Evil／SPC 配置不是完整发行版；最终按官方 Doom 框架补齐记录的模块子仓库并 sync。普通用户与 root 分别验收 GUI／TTY、模块和插件，不共用可写缓存 |
| Konsole 最小化似乎关闭 | 实际进程未死，窗口从管理器撤出；回补上游对隐藏兼容 QWidget 的 WindowMinimized 掩码修复，验证正常／最大化状态下的最小化与恢复 |
| Konsole 标签与正文漏出壁纸 | 用 X11 ARGB 确认透明横行，普通 RGB 截图不足。最终按真实 desktop／任务栏入口、新窗口和标签验证，并覆盖顶底、显示隐藏及半透明组合；保持正文透明度 |
| 登录自动打开多个旧窗口 | 改用 emptySession，不删除当前工作会话，不把保存会话与真正自启动混为一谈 |
| /boot 在 Dolphin 中不可读 | FAT remount 未实际更改权限时正常卸载再挂载；root 所有、目录 755／文件 644，普通用户可读不可写。更新内核仍需管理员权限，不添加免密码改写规则 |
| 启动图标变成通用企鹅 | 独立 ESP 的手动菜单显式引用 Gentoo 图标；Ventoy 只做已知卷标的原生匹配，未知介质不保证自动识别 |
| PyTorch 下载超时、libcuda.so.1 缺失或找不到 cuRAND | 分别修正本次调用代理、只移除核心工具包库前缀并保留驱动路径、从 wheel 元数据定位新版库目录。八项数学检查及有限负载结果见 CUDA 小节 |

### 验证夹具与维护操作

- 深路径、缺少挂载、临时目录权限、socket／FIFO、换行和 ELF 字段索引都曾让检查先失败。先检查验证工具本身，不因它退出1就重编已经安装成功的大包。
- Polkit 授权有生命周期与范围；旧 status 文件不能证明进程还活着。续任务前核对实际进程、启动身份和待处理请求，不并发写同一 Portage 根。
- 只读 Btrfs 子卷报 EROFS 时，先核对来源与只读属性，不递归 chmod；共享 extent 和延迟回收也不等于 `df` 立即增加。必要 balance 应使用明确类型、usage 与 limit 过滤。
- GitHub OAuth 不自动提供原生 Git 凭据，SSH 无 shell 的退出码也不能单独判定认证失败。远端分支、跟踪引用与本地历史要分别核对。
- 文本属性曾错误作用于 PNG。修正更具体的 binary 属性，再比对工作区、索引和安装文件摘要，不改写图标或签名载荷来凑检查结果。
- 构建日志中的网络通知错误、正文生成退出码、远端 CI 和 Pages 部署分别判断。构建成功不等于已发布，部署也不应隐式触发。

## 参考资料

### 安装与公开配置

- [Gentoo musl 安装指南](/posts/gentoo-musl/gentoo-musl/)
- [Gentoo glibc 安装指南](/posts/gentoo-glibc/gentoo-glibc/)
- [Gentoo AMD64 Handbook](https://wiki.gentoo.org/wiki/Handbook:AMD64)
- [Gentoo musl 项目](https://wiki.gentoo.org/wiki/Project:Musl)
- [当前 PC 配置与 README](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)
- [旧 world 逐项迁移清单](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/world-migration.tsv)
- [仓库构建基线与维护核验记录](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/repository-baseline.tsv)
- [兼容补丁索引、应用顺序与移除条件](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets)

### 工具链、内核与文件系统

- [mold 用法](https://github.com/rui314/mold/blob/v2.42.1/README.md#how-to-use)
- [musl 与 glibc 的功能差异：线程栈](https://wiki.musl-libc.org/functional-differences-from-glibc.html#thread-stack-size)
- [XanMod](https://xanmod.org/)、[内核实时机制](https://docs.kernel.org/core-api/real-time/theory.html)、[内核启动参数](https://docs.kernel.org/admin-guide/kernel-parameters.html)
- [Btrfs 子卷](https://btrfs.readthedocs.io/en/latest/btrfs-subvolume.html)、[receive](https://btrfs.readthedocs.io/en/latest/btrfs-receive.html)、[balance](https://btrfs.readthedocs.io/en/latest/btrfs-balance.html)

### 应用、GPU 与桌面

- [Flatpak 基本概念](https://docs.flatpak.org/en/latest/basic-concepts.html)、[中科大 Flathub 缓存说明](https://mirrors.ustc.edu.cn/help/flathub.html)
- [LocalSend 下载](https://localsend.org/download)、[Thunderbird 发行通道](https://support.mozilla.org/en-US/kb/channel-choices-thunderbird-snap-and-flatpak)、[中文 WPS 维护包](https://github.com/flathub/cn.wps.wps_365)
- [Chimera musl／NVIDIA 介绍](https://chimera-linux.org/news/2026/11/musl-nvidia.html)、[对应草案 PR](https://github.com/chimera-linux/cports/pull/6531)
- [NVIDIA PRIME Render Offload 文档](https://download.nvidia.com/XFree86/Linux-x86_64/620.70.06/README/primerenderoffload.html)、[PyTorch 安装说明](https://pytorch.org/get-started/locally/)
- [FlClash 的 Flathub 讨论](https://github.com/chen08209/FlClash/issues/1190)、[v0.9.3 Core 协议](https://github.com/chen08209/FlClash/blob/v0.9.3/core/server.go)
- [Neomacs](https://github.com/eval-exec/neomacs)、[Oracle Java 扩展验收基线](https://github.com/oracle/javavscode/releases/tag/v27.0.0)
- [Node 代理环境变量](https://nodejs.org/learn/http/enterprise-network-configuration)
- [Sonic Terminal 最小化修复](https://github.com/Sonic-DE/sonic-terminal/commit/75ba4c38f00ce9d3ba7d13f5951132f6599947da)
- [VSCodium 跨平台配置](/posts/vscodium-sync/vscodium-sync/)
