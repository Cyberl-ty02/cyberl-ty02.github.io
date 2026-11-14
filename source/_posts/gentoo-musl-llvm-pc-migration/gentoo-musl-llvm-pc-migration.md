---
title: Gentoo musl/LLVM PC 迁移实验：兼容环境、locale 与 chroot 安装
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

这篇记录我从官方 musl/LLVM/OpenRC stage3 验证 Gentoo PC 安装的过程，目标仍是 SonicDE、XLibre 和 NVIDIA/CUDA，并尽量保留微信、腾讯会议、WPS、VSCodium 等日常使用体验。系统已有一套 glibc/LLVM 安装，因此实验的前提是保留原根、家目录和引导入口，先证明新环境能工作，再安排切换。

> **当前状态：尚未从 musl 新根真机启动。**
> 本文是进行中的实验记录。依赖预演、编译通过、应用启动和完整真机迁移是不同的验收项，不能把其中一步通过写成整套安装已完成。原有[实体机安装指南](/posts/gentoo-endeavouros-btrfs-openrc-install/gentoo-endeavouros-btrfs-openrc-install/)仍按 glibc 主线维护。

## 从哪个 stage3 开始

本轮使用 `stage3-amd64-musl-llvm-openrc-20261108T170107Z.tar.xz`，核对官方发布签名和 SHA512 后解压。它带有 musl、Clang/LLVM、LLD、libc++ 和 OpenRC，对应 profile 为：

```text
default/linux/amd64/23.0/musl/llvm
```

这里的版本号是实验基线，不是要求后来的新机器永远下载同一份归档。新装时仍要检查官方当前 stage3、发布密钥和 Handbook，也不要在已有 glibc 系统里仅切换 profile 来完成 libc 迁移。

源码和配置草案放在 dotfiles 的 [musl 实验目录](https://github.com/Cyberl-ty02/dotfiles/tree/experiment/musl-llvm-migration/gentoo_setting/experiments/musl-llvm-pc)。它与已经用于日常机器的 `pc/`、`wsl/` 配置分开，不覆盖 Windows 配置。

## 已经验证了什么

| 项目 | 本轮结果 | 尚未覆盖 |
| --- | --- | --- |
| 原生 UTF-8 | 中文文件名、文件内容和字符解码通过 | 旧编码文件、全部应用输入法 |
| ICU 中文处理 | 日期、人民币、排序和 GB18030 转换通过 | 每个应用是否实际走 ICU |
| NVIDIA/CUDA | musl/Clang 编译并运行最小 CUDA kernel；五个内核模块编译通过 | 新模块签名/加载、PRIME、外接显示、完整 SDK/PyTorch |
| NVIDIA 原生图形 | 私有补丁加载器下 EGL 1.5 / OpenGL 4.6 离屏渲染与像素回读通过 | XLibre 显示、PRIME、外接显示、休眠恢复、Vulkan |
| Flatpak | 由 musl 原生编译，完成应用部署和安装后触发器复核 | 真机桌面 Portal 和设备交互 |
| 微信 | 独立显示中出现中文登录界面 | 未登录；聊天、中文输入、音视频 |
| VSCodium | 八个选定扩展实际激活，中文 notebook 读取和 Jupyter 原生 ZeroMQ 中文消息往返通过 | notebook kernel 执行、调试、所有扩展与凭据 |
| SonicDE/XLibre/Rime | 全新根完整桌面安装通过；原生 Qt、GTK 及 Flatpak VSCodium 通过 Fcitx/Rime 实际提交“你好” | 新桌面登录、其他应用输入法和实际硬件显示 |
| 全新 stage3 安装基础 | 正确权限解压、默认用户与沙箱完整桌面安装通过，Pillow truetype 已恢复 | 新内核安装及真机验收 |
| 新根启动 | 尚未执行 | 内核/initramfs、Secure Boot、第一次启动和回退 |

VSCodium 本轮验证的扩展包括 Python、debugpy、Jupyter、Jupyter Renderers、Ruff、rust-analyzer、Tinymist 和 Office。没有把原用户的凭据复制到实验环境，也没有把“扩展目录存在”当作“扩展加载成功”。

## glibc 兼容环境怎么选

gcompat 可以处理一部分 glibc ABI，但不是完整 glibc。本轮最小 CUDA 计算验证通过，并不代表 NVIDIA 整个显示栈已经可用；旧扩展附带的 Ruff、rust-analyzer、Tinymist 在当前 gcompat 环境下甚至会在版本查询时崩溃。

图形部分后来有了单独的进展：参考 Chimera 的 [NVIDIA 草案 PR](https://github.com/chimera-linux/cports/pull/6531)，固定到 `c26532983c3b811c2d6b310058761bba39491bbe`，在私有目录构建带 IFUNC/TLS 补丁的 musl 加载器、gcompat 和兼容 shim，只调整驱动库的实验副本。原系统及实验根的默认 libc 均未替换。

在本机 RTX 4060、620.70.06 驱动上，这条路径已经完成 EGL 1.5 / OpenGL 4.6 上下文创建、离屏清屏与像素回读。使用默认 musl 的对照组仍报重定位类型 37 不受支持。这证明了一个有限的原生图形兼容路径；上游仍是草案，本地尚未完成安装包，也没有验证 XLibre 显示、PRIME、外接显示、休眠恢复或 Vulkan。

因此目前把两条路线分开验证：

- SonicDE、XLibre、输入法和主系统工具使用原生 musl/LLVM。
- 闭源桌面应用与 VSCodium 的现有 glibc 扩展优先测试 Flatpak 运行时。

另外建立的独立 glibc stage3 已完成对照实验，其目录已归档回收；归档与受限文件保留。它需要单独创建根环境、维护软件、配置 locale 和用户会话接口；安装一个 chroot 工具不会自动完成这些工作。如果最后仍采用这条回退路线，正式教程会明确写出额外空间和维护责任。

Flatpak 的 GPU 路径也做了单独验证：在 musl 宿主隔离根中，只挂入必要 GPU 节点和只读 sysfs，使用 VSCodium 所在的官方 glibc 运行时及 NVIDIA 扩展，CUDA 初始化、显存写入与回读通过；EGL 1.5 / OpenGL 4.6 离屏渲染和像素回读也通过。这条路径没有加载实验 musl 补丁。它仍只是运行时级别的测试，不等于 VSCodium 的全部 GPU 功能、CUDA 开发环境或其他应用已经验收。

Flatpak 提供的 glibc 库不用于满足宿主 Portage 依赖。已经在同一 musl 根中成功安装的宿主库，由 Portage 按版本、USE 和 ABI 复用，不必因为应用再装一次相同版本。

## 在 chroot 内一键安装 Flatpak 主包

先按原安装指南准备目标根的 `/proc`、`/sys`、`/dev`、`/dev/pts`、DNS、CA 证书、系统时间和代理，并通过 Portage 安装 Flatpak 本体。以仓库克隆在 `/root/dotfiles` 为例，在目标 chroot 的 root shell 内执行：

```bash
cd /root/dotfiles/gentoo_setting/experiments/musl-llvm-pc
bash scripts/install-flatpak-apps.sh --dry-run --system
bash scripts/install-flatpak-apps.sh --system
```

脚本在 root 下默认系统级安装，写入目标系统的 `/var/lib/flatpak`。它不要求普通用户先登录桌面，也不在 chroot 中启动 D-Bus、elogind、Portal 或应用 GUI。本轮已在没有桌面会话和 D-Bus 的隔离根里完成系统级安装、安装后触发器复核和重复运行验证；缓存经过预置，这仍不代替 LiveCD 全流程及第一次启动验收。

默认主包 ID 为：

```text
com.tencent.WeChat
com.vscodium.codium
```

运行时、语言内容、Mesa 和匹配当前驱动的 NVIDIA 图形扩展由 Flatpak 自动解析，不把实验机器的显卡版本写成所有机器的固定依赖。VSCodium 当前使用 Freedesktop SDK 26.08，体积比普通运行时大；其中的 glibc 开发工具与 musl 主系统分开维护，不等于向主系统安装 GCC。

腾讯会议的候选 ID 是 `com.tencent.wemeet`，尚未加入默认安装清单。`com.wps.Office` 对应国际版 WPS，不能直接视为现有中文 WPS 12 的完整替代，也暂不默认安装。

默认使用中科大缓存，签名校验保持启用。需要临时回官方源时：

```bash
bash scripts/install-flatpak-apps.sh --system --official
```

再次运行默认命令即可恢复国内缓存。镜像缺失内容可能回源，厂商 `extra-data` 仍由厂商站点提供。代理沿用调用环境。

如果只为已经登录的普通用户安装，可以改用 `--user`。系统级与用户级安装选一种即可；更新分别使用 `flatpak update --system` 或 `flatpak update --user`。应用启动和文件选择、音频、GPU、中文输入的验收，留到目标普通用户第一次登录后进行。

## musl 的中文 locale 要分层检查

原安装指南里的 `locale-gen` 适用于 glibc，不能原样套到 musl。实验目录提供了自动识别 Gentoo profile 的配置脚本：

```bash
# 目标 Gentoo/chroot 内，以 root 执行
bash scripts/configure-locale.sh --dry-run
bash scripts/configure-locale.sh --lang zh_CN.UTF-8 --timezone Asia/Shanghai
```

它先备份旧配置到 `/var/backups/locale-setup/`，再配置 `/etc/env.d/02locale`、`/etc/timezone` 和 `/etc/localtime`，最后执行 `env-update`。glibc 分支生成所需 locale，musl 分支不调用 `locale-gen`，也不复制 glibc 的 locale archive。两种后端已在各自真实根环境的独立配置夹中测试。

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

本轮发现 `LANG=zh_CN.UTF-8` 被接受，只证明了一部分条件：原生 UTF-8 文件处理正常，但 libc 的日期、货币、排序和 iconv 数据与 glibc 不等价。独立 ICU 程序可以完成中文日期、人民币格式、中文排序及 GB18030 转换；应用有没有使用这条路径，要继续实测。

首次登录可先检查：

```bash
locale
date +'%F %T %Z'
fc-match 'sans-serif:lang=zh-cn'
fc-match emoji
flatpak run --command=sh com.vscodium.codium -c 'locale -a; locale'
```

Flatpak 的 glibc locale 需要单独检查。本轮修复语言内容后，运行时已实际列出 `zh_CN.utf8`，`locale` 不再报缺失。安装脚本通过 `extra-languages` 自动处理中文和英文，不要求新机器手工修复语言扩展。中文分片实际是 `/zh`，不能凭 locale 名称猜成 `/zh_CN`。

数据库等有状态服务也要单独迁移。切换 libc 或排序规则时，不应直接复制整棵旧 `/var` 并假定索引和服务状态可用；要保留独立备份并核对数据库官方迁移和 collation 说明。

## LLVM 构建中遇到的小问题

旧 Darts CLI 使用 `std::random_shuffle`，在当前 Clang 默认 C++17 下无法编译。本轮只对 `dev-libs/darts-0.32h_pre20181117064816` 指定 Clang C++14，随后通过，没有引入 GCC。对应的版本限定配置随实验目录保存，不覆盖整套 Portage 配置。

输入法的联动测试还发现一个编译时看不到的问题：Fcitx 动态加载 Rime 时，经 LevelDB 带入的 tcmalloc 在默认 musl 下触发 initial-exec TLS 错误。本轮使用 Gentoo 已有的 `dev-libs/leveldb -tcmalloc` 配置重建，随后在私有 X11 显示、独立 D-Bus 会话和测试用户配置中，经 Qt 6 → Fcitx 5 → Rime 输入 `nihao<space>`，实际提交了“你好”。不需要给整个桌面设置 `LD_PRELOAD`。

Fcitx 5.1.21 另有旧 Wayland CMake finder 与当前 SonicDE ECM 不匹配的问题。本轮目标是 XLibre/X11，因此只关闭这个版本 Fcitx 自身的 Wayland 后端，其他 Qt/Wayland 客户端库保留。两项配置随实验目录记录。后续软件补齐中，Yakuake 26.04.3 的可选 Wayland 后端也拉入了与 SonicDE ECM 不兼容的 KWayland；关闭这个应用的可选后端后，新计划通过，安装仍在队列中。Gwenview 26.04.3 则使用上游已有的 `GWENVIEW_NO_WAYLAND_GESTURES=ON`，保留 X11 功能；在只读挂载真实 musl 根的独立 CMake 检查中，默认配置因 WaylandProtocols 缺失失败，X11 配置成功，完整 Portage 构建与运行仍待验证。相关开关按应用版本限定，没有替换全局 ECM 模块。后续原生 GTK 3 和 Flatpak VSCodium 编辑区也通过了实际中文输入，后者由扩展 API 确认文档收到“你好”，没有添加持久 Flatpak 权限覆盖。微信等其他应用的输入仍需逐项验证。

补丁现在按软件整理在仓库的 [patchsets 目录](https://github.com/Cyberl-ty02/dotfiles/tree/experiment/musl-llvm-migration/gentoo_setting/experiments/musl-llvm-pc/patchsets)，每组写明适用版本、验证状态和移除条件，避免长期维护整份本地 ebuild 副本。配方依赖变更放 `repository/`，源码变更放 `source/`；Portage 用户源码补丁不能补齐缺失的 `DEPEND`。

本轮 Sonic 图像编辑 0.7.0.1 就需要这两层：配方声明 Highway 依赖，源码使用其标准 `hwy` CMake Config。等效修正在 musl/Clang/Highway 1.4.0 下编译安装通过，补丁组也在独立工作副本完成应用与反向撤回检查。原实验根保留旧配方快照作对照；全新根随后也已通过上游配方加版本限定用户补丁安装图像编辑组件，VDB 来源保持 `sonicde`，日志确认源码补丁实际应用。上游修复后分别核对两层，不反向撤销已经进入上游提交的修正。

Sonic Login Manager 6.8.0.3 还暴露了一个头文件问题：`SelfProvisioner.h` 使用 POSIX 的 `uid_t`、`gid_t` 和 `mode_t`，没有直接包含定义它们的头文件。单独补上 `<sys/types.h>` 后，musl/Clang 编译安装通过；这也是独立源码补丁组，不改变登录、PAM 或权限逻辑。

原实验根的桌面源码构建已通过。在私有 Xvfb、独立 D-Bus 和用户配置中，SonicDE 窗口管理器、桌面 shell 持续运行并提供接口，中文欢迎界面和壁纸实际绘制出来。该测试采用软件 QML、关闭合成，且没有系统总线与物理设备；它不覆盖真实登录、硬件显示、关机或音频。音量界面的配置缺口也在这一步发现：meta 的 `pulseaudio` 开关选择界面，服务端仍用 PipeWire。补齐后，私有会话的面板、时钟和音量图标绘制正常，PipeWire 进程与 Pulse 兼容套接字通过检查；真实播放和麦克风仍待启动后验证。

CUDA 的宿主数学调用和 gcompat amd64 加载器路径也有小型实验补丁。最小验证通过不等于完整 ebuild、CUDA SDK 或原生 NVIDIA 图形兼容已经验收；补丁状态在仓库说明中单列。

新环境不默认安装 GNU Emacs。Neomacs 已有 Gentoo overlay，但仍是实验软件；固定上游提交后，真正 musl 根的依赖预演通过，共四个新包，不引入 GCC 或 glibc，三个依赖已安装。主体首轮编译遇到七处 musl 错误，涉及 glibc 专有回溯接口及 termios／ioctl 类型差异；固定源码补丁已通过精确应用与撤回检查，重建正在验证。Neomacs 尚未安装成功，现有 Doom 配置及中文输入等也待验证。安装并验收后，可用 `eselect editor set neomacs` 选择它，再执行 `source /etc/profile`；eselect editor 已支持自定义程序名，无需修改模块。若它不满足需要，本轮不会自动退回安装旧 Emacs，原系统与 Windows 配置继续保留。

## 旧 world 的覆盖范围

桌面批次安装通过不代表旧系统软件全部迁移。按旧 `world` 的 91 项直接选择核对，三项服务软件批次结束时原生覆盖 28 项，微信与 VSCodium 两项由 Flatpak 提供；其余包括待原生预演的软件、闭源兼容与 NVIDIA/CUDA 拆分项，以及按方案排除的 GNU Emacs、mold。配置仓库的 [`world-migration.tsv`](https://github.com/Cyberl-ty02/dotfiles/blob/experiment/musl-llvm-migration/gentoo_setting/experiments/musl-llvm-pc/world-migration.tsv) 保存逐项状态，“待预演”不等于不支持 musl。

PostgreSQL 18.6、ClamAV 1.5.3、ClamTk 6.18-r2 随后已在默认 Portage 用户和沙箱下安装完成。PostgreSQL 工具能正常执行，没有初始化或迁移旧数据库；ClamAV 对自定义无害签名的正、负样本扫描结果正确，正式病毒库更新仍待验收。ClamTk 在私有显示中正常打开，但最初界面仍是英文：musl 下需明确绑定 gettext 目录，已整理为一行、按版本限定的补丁，实际重建和私有显示的中文界面通过。此前 `--oneshot` 留下的空 `world` 已在该批次通过 Portage 登记 32 项软件选择；迁移验收期间仍不运行 `depclean`。

截至 2026-11-14，旧系统 91 项 world 选择中，71 项已有同名原生安装，Telegram 改为原生源码包，微信与 VSCodium 由 Flatpak 提供，GNU Emacs 和 mold 按方案排除。剩余六项普通应用、五项内核／引导选择，以及 WPS、腾讯会议、NVIDIA、CUDA 四项专项集成。这是安装清单核对，不代表旧数据、全部界面或硬件已经验收。

后续以统一软件／配置批次串行安装，未知错误保留日志等待处理；整理 Portage 前保存快照，核对已安装包的有效设置，发生差异则停止或回退。该批次在引导切换前停下，不能从“配置整理完成”推导“迁移完成”。

其余软件已完成逐项预演；关键词、USE 等必要配置调整后，连同 PostgreSQL LLVM/JIT、NetworkManager iwd、Btrfs udev 和 XLibre Xvfb 功能恢复，共 48 个直接选择项已完成安装，四项恢复功能的 USE 已核对。Node.js 的依赖允许选择 Gentoo 官方 `llvm-runtimes/libatomic-stub`，明确加入该包后，Firefox／Thunderbird 的合并预演不再选择 GCC；大型应用仍需单独构建。KTorrent 关闭可选内嵌 WebEngine，避免额外网页引擎构建。QQ、LocalSend、FlClash 的 glibc 预编译界面另行验证，不把关键词通过当作 ABI 兼容通过。

补齐过程中还遇到 lowdown 3.1.1 的 BSD 配置宏与 musl 头文件冲突，以及 ipset 7.24 的过期导出表被 LLD 拒绝。前者直接回补上游修复，后者保存为版本限定的本地源码补丁；两者均通过全新根正常沙箱编译安装，中文转换／帮助命令通过。nftables 1.1.7 的 xtables 兼容还需让 libc 的 Ethernet 头文件先于 Linux UAPI 包含，这项版本限定补丁也已通过正常沙箱编译安装，未操作真实防火墙规则。补丁集中保存在仓库补丁组中，不修改系统头文件或全局放宽链接校验。本轮国内镜像使用临时 `no_proxy` 直连，其余地址保留本地代理；校验策略保持启用。

Bun 官方 musl baseline 归档也已按发布资产 SHA256 校验。它需要 musl 版 C++ 运行库，复用已验签的 Alpine 约 2.7MiB `libstdc++`，在独立官方 stage3 中完成正常 Portage 沙箱安装，JavaScript、中文与人民币格式化通过，没有安装 GCC 编译器或 glibc。Alpine 与 Gentoo 的 libc／LLVM ABI 库名差异由配方内的 patchelf 修正，最终 SONAME 检查没有未解析依赖；运行库仅用于私有 wrapper，不全局修改库路径。配方已整理成新增小型运行库包及修改既有 Bun 配方的两组补丁，主桌面实验根的集成安装、CLI 和 SONAME 检查也已通过；完整博客依赖安装与构建仍待在原生 musl 中验证。

## 新根、子卷和回退

当前实验根曾非特权解压，并为嵌套隔离调整过 Portage 用户与沙箱，只用于实验。正式新根要从已验签 stage3 以正确权限重新建立，恢复正常用户、文件归属和沙箱，再复用审核过的配置与受控构建包。

现在已经另行建立正确权限的全新 stage3 根：核对 63,870 个归档条目的属主、权限与符号链接，并确认 282 个基础包与官方归档一致。没有把旧实验根的文件归属或用户配置直接带过去。

随后在新根中保留默认 `sandbox`、`userpriv`、`usersandbox`、`ipc-sandbox`、`network-sandbox` 和 `pid-sandbox`，从源码安装官方 hello。编译阶段的实际身份是 Portage UID/GID 250:250，安装后运行输出正确，未引入 GCC 或 glibc。这一步证明了全新 stage3 的安装基础；新内核和启动流程仍须继续验收，不能据此把教程标为迁移完成。

从这个全新根再做完整桌面预演，会遇到旧实验根已不再暴露的 GLib → docutils → Pillow → HarfBuzz → GLib 引导循环。候选方案是先临时设置 `dev-python/pillow -truetype`，安装 GLib/HarfBuzz 后移除临时设置，再按最终 USE 重建 Pillow。关闭后完整依赖预演通过，没有计划引入 GCC、glibc、GNU Emacs 或 QtWebEngine；随后已在这个新根实际完成两阶段引导：GLib/HarfBuzz 安装通过，Pillow 已恢复 `truetype`，临时开关删除，默认 Portage 用户和沙箱保留，未引入 GCC。随后完整桌面安装通过，共 926 个包，保留默认 Portage 用户与沙箱，未引入 GCC；图像编辑组件使用上游 SonicDE 配方加补丁组。新内核和真机启动仍待验收，临时配置不能直接作为最终配置发布。

全新根随后也在独立 Xvfb、私有 D-Bus 和隔离用户配置中通过桌面运行检查：窗口管理器、shell 进程及总线接口持续可用，中文欢迎界面与面板正常绘制，PipeWire 进程和兼容套接字检查通过。该测试仍使用软件 QML、关闭合成，没有真实设备与系统总线，不能作为登录管理器、硬件显示、音频播放或 Portal 的验收。新根随后已补齐音量界面，仍由 PipeWire 提供服务端，没有安装独立 PulseAudio daemon；中文 locale、上海时区和系统级微信／VSCodium 主包检查通过。系统级 VSCodium 也在这个新根实际接收到原生 Fcitx/Rime 提交的“你好”并正常退出。Flatpak 此次先复用已校验缓存，再运行安装脚本，不能当作空缓存下载流程已通过；Portal、音视频、所有扩展仍需真实会话验收。针对构建日志提示的 libc++ 面板右键问题，还在私有显示中实际打开右键菜单，窗口管理器与 shell 保持运行，未复现这个操作导致的崩溃；因此本轮没有追加全局 libc++ 重建开关，这不代替其他菜单与长期会话稳定性测试。

另一个要保留的 profile 细节是：Gentoo musl 已屏蔽 `kde-plasma/powerdevil[filecaps]`。SonicDE 的实现包与兼容包要同时采用 `-filecaps`，否则会出现 USE 依赖冲突；这不是因为 stage3 解压权限不足，也不应靠关闭整个 Portage 沙箱解决。

启动准备中还补齐了新根自己的五个仓库副本，固定在已验证版本，profile 不再依赖临时挂载；国内镜像优先与 Gentoo 同步签名检查保留，验收期间暂不自动同步。XanMod/CJKTTY 的内核依赖预演已通过，完整内核和签名仍待实际构建。签名工具会需要 GNU binutils，LLVM 也提供 libgcc ABI 库，这不等于安装 GNU GCC 编译器套件。NVIDIA 的开源 `nvidia-modprobe` 620.70.06 已按固定 Gentoo Manifest 校验官方源码，并在新根用 Clang/musl 构建、运行版本与帮助检查通过；它尚未安装或用于加载模块，不代表完整驱动集成已完成。

候选 Btrfs 布局是在现有文件系统内新增 `@musl`，保留原 `@`、`@home` 和启动项。`/dev/nvme1n1p2` 是分区设备，不是要赋给子卷的名字，也不需要仅为此次迁移重新格式化分区。

迁移验收后，最终根子卷名仍统一为原教程的 `@`。从救援环境挂载 Btrfs 顶层，将旧 `@` 改名为 `@glibc-backup`，再将新 `@musl` 改名为 `@`；同步修正两套系统的 `fstab`、rEFInd 根参数和按名称引用子卷的备份任务，检查 initramfs 是否固化了旧路径。分别验证新系统启动与旧系统回退后，再决定旧根的删除时间。这样不会留下额外的 `@musl`，也没有单独的 musl 分区需要删除，分区 UUID 不变。新机全新安装则直接建立 `@`、`@home`，不必经历临时命名。[Btrfs 官方文档](https://btrfs.readthedocs.io/en/latest/btrfs-subvolume.html)说明子卷可以改名，子卷 ID 保持不变。

第一次启动成功后，仍要做多次启动、桌面使用、更新与回退验证。用户配置先隔离，数据按应用清单恢复；旧 glibc 根的删除另行决定，不能把“迁移能启动”当作“旧根可以立即删除”。当前还没有进行这一步切换。

## 参考

- [Gentoo musl 项目](https://wiki.gentoo.org/wiki/Project:Musl)
- [Flatpak 基本概念](https://docs.flatpak.org/en/latest/basic-concepts.html)
- [中科大 Flathub 缓存说明](https://mirrors.ustc.edu.cn/help/flathub.html)
- [Chimera 的 musl/NVIDIA 实验](https://chimera-linux.org/news/2026/11/musl-nvidia.html)
- [NVIDIA PRIME Render Offload 文档](https://download.nvidia.com/XFree86/Linux-x86_64/620.70.06/README/primerenderoffload.html)
- [Neomacs](https://github.com/eval-exec/neomacs)
