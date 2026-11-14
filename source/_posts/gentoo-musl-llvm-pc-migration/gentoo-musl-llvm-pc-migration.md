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

先按原安装指南准备目标根的 `/proc`、`/sys`、`/dev`、`/dev/pts`、DNS、CA 证书、系统时间和代理，并通过 Portage 安装 Flatpak 本体。这些实验脚本目前位于 `experiment/musl-llvm-migration` 分支。使用独立 checkout 并核对接受基线，不覆盖已有工作区；例如在目标 chroot 的 root shell 内执行：

```bash
git clone --branch experiment/musl-llvm-migration --single-branch \
  https://github.com/Cyberl-ty02/dotfiles.git /root/dotfiles-musl
cd /root/dotfiles-musl/gentoo_setting/experiments/musl-llvm-pc
bash scripts/install-flatpak-apps.sh --dry-run --system
bash scripts/install-flatpak-apps.sh --system
```

脚本在 root 下默认系统级安装，写入目标系统的 `/var/lib/flatpak`。它不要求普通用户先登录桌面，也不在 chroot 中启动 D-Bus、elogind、Portal 或应用 GUI。本轮已在没有桌面会话和 D-Bus 的隔离根里完成系统级安装、安装后触发器复核和重复运行验证；缓存经过预置，这仍不代替 LiveCD 全流程及第一次启动验收。

默认主包 ID 为：

```text
com.tencent.WeChat
com.vscodium.codium
org.localsend.localsend_app
org.mozilla.thunderbird_esr
com.qq.QQ
```

LocalSend 采用[官网列出的 Flatpak 路线](https://localsend.org/download)，1.18.2 已在新根系统级安装，私有 X11 显示中的中文界面通过。局域网发现和文件传输仍待真机会话验收。Thunderbird 使用[官方 ESR Flatpak](https://support.mozilla.org/en-US/kb/channel-choices-thunderbird-snap-and-flatpak)，153.7.0esr 中文界面启动通过；QQ 社区 Flatpak 3.2.35-54395 的腾讯 extra-data 已核对固定哈希并完成安装，隔离离线中文窗口通过，未登录。QQ 首次代理下载中断，经腾讯国内地址直连下载校验后，复用 Flatpak 自带的本地 extra-data 缓存安装，签名与哈希检查保持启用。两项均未访问原邮件或账户配置。

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

新环境以 Neomacs 替代 GNU Emacs。固定提交 `aacf29294ab30aed5736e1eabcb3b83122593fce` 的 0.0.20 已在 musl 根安装，不引入 GCC 或 glibc。源码补丁修复七处 musl 编译兼容问题，以及 Lisp 引导中的栈段测量错误：原实现把较大栈段返回调用者时的剩余空间差当作消耗量，导致后续栈分配不断增大，最终报 `mprotect/mmap: ENOMEM`。真实 musl、UID250、stacker 的小型对照中，原版从 32MiB 增长至约 160MiB、670MiB，由测试夹具在分配前拦截；修复版 64 次调用及展开恢复保持 32MiB。诊断上限不进入生产补丁。

本次复用已准备源码和编译缓存，保留正常 Portage 沙箱；Rust release、Unicode 数据、127 个预载及 1,516 个 Lisp 文件引导、安装通过。配方另行修正 SQLite 特性和固定源码实际存在的图标／文档路径。普通用户 SQLite 中文读写、私有 X11 GUI、Fcitx5/Rime 输入 `nihao<space>` 并保存“你好”均通过。实验根已执行 `eselect editor set neomacs`，新 shell 可通过 `source /etc/profile` 更新 `EDITOR`；eselect 原有模块支持自定义程序，无需伪装成 `emacs`。这不代表空缓存全新重建、真实 GPU 或旧 Doom 配置已经验收。源码与配方补丁按用途归入配置仓库现有 Neomacs 补丁组，上游覆盖后逐项复验再移除。

## 旧 world 的覆盖范围

桌面批次安装通过不代表旧系统软件全部迁移，仍需按旧 `world` 的 91 项直接选择逐项核对。配置仓库的 [`world-migration.tsv`](https://github.com/Cyberl-ty02/dotfiles/blob/experiment/musl-llvm-migration/gentoo_setting/experiments/musl-llvm-pc/world-migration.tsv) 保存逐项状态，“待预演”不等于不支持 musl。

PostgreSQL 18.6、ClamAV 1.5.3、ClamTk 6.18-r2 随后已在默认 Portage 用户和沙箱下安装完成。PostgreSQL 工具能正常执行，没有初始化或迁移旧数据库；ClamAV 对自定义无害签名的正、负样本扫描结果正确，正式病毒库更新仍待验收。ClamTk 在私有显示中正常打开，但最初界面仍是英文：musl 下需明确绑定 gettext 目录，已整理为一行、按版本限定的补丁，实际重建和私有显示的中文界面通过。软件选择已通过 Portage 登记；迁移验收期间仍不运行 `depclean`。

截至 2026-11-14，旧系统 91 项 world 选择中，71 项已有同名原生安装，Telegram 改为原生源码包，GNU Emacs 由原生 Neomacs 替代，JDK 换为原生 Dragonwell Standard 21 LTS；微信、VSCodium、LocalSend、Thunderbird ESR 和 QQ 由 Flatpak 提供，mold 按方案排除。剩余 Firefox、FlClash 两项普通应用、五项内核／引导选择，以及 WPS、腾讯会议、NVIDIA、CUDA 四项专项集成。这是安装清单核对，不代表旧数据、全部界面或硬件已经验收。

本次统一授权的软件／配置批次已到复核点。Portage 六类配置按原顺序归并，整理前后比较了 1,158 个已安装包的有效设置，差异为零；替换前快照保留，不复制 GPG 私有目录。复核后的配置、环境片段及固定仓库提交清单同步到配置仓库的 `portage/`，源码补丁继续在 `patchsets/` 维护。新机仍须核对 profile、仓库版本、硬件和补丁，不整目录覆盖已有配置。Neomacs 与 Java 补齐后，新根共 1,191 个包、81 个 world 选择；安装通过仍不代表迁移完成，真实引导、数据库和旧根均未改变。本轮长批次已完成全部 34 项对齐（21 个新依赖、13 项 USE 重建），包括 SPIR-V translator、libclc、Mesa CLC 和 cargo-c；另装 Firefox 五项较小前置。最终 `@world --update --deep --newuse` 没有待合并项，仍无 GCC/glibc。官方 stage3 的 platformdirs 4.12.4 以精确关键词保留，避免非必要降版。

其余软件已完成逐项预演；关键词、USE 等必要配置调整后，连同 PostgreSQL LLVM/JIT、NetworkManager iwd、Btrfs udev 和 XLibre Xvfb 功能恢复，共 48 个直接选择项已完成安装，四项恢复功能的 USE 已核对。Node.js 的依赖允许选择 Gentoo 官方 `llvm-runtimes/libatomic-stub`，明确加入该包后，Firefox／Thunderbird 的合并预演不再选择 GCC；Firefox 已回补含安全修复的 153.7 ESR 官方配方，新版预演通过，Thunderbird 已改用 ESR Flatpak。KTorrent 关闭可选内嵌 WebEngine，避免额外网页引擎构建。QQ 和 LocalSend 已通过 Flatpak 界面检查；FlClash 的 glibc 界面、Helper/TUN 与 OpenRC 集成仍待验证。

补齐过程中还遇到 lowdown 3.1.1 的 BSD 配置宏与 musl 头文件冲突，以及 ipset 7.24 的过期导出表被 LLD 拒绝。前者直接回补上游修复，后者保存为版本限定的本地源码补丁；两者均通过全新根正常沙箱编译安装，中文转换／帮助命令通过。nftables 1.1.7 的 xtables 兼容还需让 libc 的 Ethernet 头文件先于 Linux UAPI 包含，这项版本限定补丁也已通过正常沙箱编译安装，未操作真实防火墙规则。补丁集中保存在仓库补丁组中，不修改系统头文件或全局放宽链接校验。国内镜像顺序保持优先，下载沿用当前调用环境的代理；本批使用已恢复的本地代理，只有核验国内直连可用且更快时才临时加入 `no_proxy`。Manifest 和签名校验保持启用，代理地址不写死到新机配置。

Bun 官方 musl baseline 归档也已按发布资产 SHA256 校验。它需要 musl 版 C++ 运行库，复用已验签的 Alpine 约 2.7MiB `libstdc++`，在独立官方 stage3 中完成正常 Portage 沙箱安装，JavaScript、中文与人民币格式化通过，没有安装 GCC 编译器或 glibc。Alpine 与 Gentoo 的 libc／LLVM ABI 库名差异由配方内的 patchelf 修正，最终 SONAME 检查没有未解析依赖；运行库仅用于私有 wrapper，不全局修改库路径。配方已整理成新增小型运行库包及修改既有 Bun 配方的两组补丁，主桌面实验根的集成安装、CLI 和 SONAME 检查也已通过；随后在普通用户、隔离网络和独立源码副本中，使用原生 musl Bun 完整执行了现有博客构建，类型、测试、内容、runtime、Hexo 和生成物检查均通过。原源码与依赖哈希保持不变；这次只读复用已有 node_modules，空缓存依赖安装仍待验证。

## Dragonwell Standard 与软件包管理

JDK 按用户选择改为 Alibaba Dragonwell **Standard 21 LTS**，使用官方 21.0.13.0.13+9 GA 的 amd64 Alpine/musl 归档，不使用 Extended。归档按官方发布资产 SHA256 核对，Manifest 另记录 BLAKE2B 与 SHA512。69 个 ELF 的检查未发现外部 libstdc++／libgcc 依赖；66 个文件需要把 Alpine 的 musl NEEDED 名调整为 Gentoo `libc.so`。调整只作用于包内文件，不创建全局 libc 别名，也不引入 glibc 或 GCC。

配方使用 Gentoo 的 `java-vm-2` eclass，程序位于版本化 `/opt`，证书连接系统 Java 信任库。正常沙箱安装六个包及 `virtual/jdk:21` 后，以普通用户重新运行安装产物：javac、中文 UTF-8 文件读写、人民币格式、上海时区、CJK 字体及 PNG 输出通过，系统证书库可读取；这不等于真机 AWT、远端 TLS 或所有 JNI 项目通过。`eselect java-vm set system dragonwell-bin-21` 已在实验根完成，当前真实系统默认 Java 不变。

维护形式仍是补丁组：一份向现有 Gentoo-Zh 添加固定 Standard 配方和 Manifest，另一份调整 Gentoo Java 21 虚拟包的 provider，不新建 overlay。具体应用顺序和 chroot 命令见配置仓库现有 `patchsets/dragonwell-21.0.13/`。跟进安全更新时重新核验官方归档和运行测试；上游有等价方案后再移除对应补丁。

其他没有配方的软件也可以用 Portage 二进制 ebuild 管理版本、依赖、文件与卸载，AppImage 可解包后按同样方式安装。专用兼容库放在程序私有目录，使用该程序的 RPATH 或 wrapper；不把兼容环境加入全局库搜索路径。Flatpak 应用和运行时由 Flatpak 管理，配置仓库只保留主包清单及一键脚本。

FlClash 上游[不计划提供 Flathub 包](https://github.com/chen08209/FlClash/issues/1190)，涉及 Helper、TUN 和系统代理的系统权限；仅能运行 GUI 或本地代理的封装不能算完整等价替代。目前仍保留该项。后续线程可从配置仓库根的 `AGENTS.md` 进入现有实验 README、world 清单和补丁组；本机检查点另记录活动进程、实验根身份与私有日志，避免公开文档变成过时的运行状态记录。

## Java IDE 也统一 Dragonwell Standard 21

新环境不采用 JDK 25 路线。Portage 已显式屏蔽其他 OpenJDK provider 与 Dragonwell 22+，防止后续依赖自动引入不同家族／主版本。宿主仍只有 `dragonwell-bin-21` 一个默认 VM；VSCodium 的 glibc 运行时内，使用同一补丁版本的私有 **Dragonwell Standard 21 glibc 构建**。两种 libc 需要各自二进制，不能把宿主 musl JVM 直接交给 glibc JNI。

当前 Red Hat Java 1.58 要求 JDK 25，设置路径为 21 不能解决其最低要求。本轮改在独立 profile 验证当前维护的 [Oracle Java 扩展](https://github.com/oracle/javavscode/releases/tag/v27.0.0)：扩展版本为 27，不代表 JDK 27，也不捆绑 JDK。它配合 Standard 21 已通过激活、Java 符号与补全、`javac --release 21` 中文编译运行，以及实际 DAP 断点、栈与表达式求值；调试目标明确返回 Alibaba／21。官方两项资产、版本和 SHA256 归入配置仓库现有 `scripts/java21-ide-assets.json`。

这是一条已验证的 Java 21 路线，尚未把真实用户的微软 Java Debug/Test/Project Manager 配置转为新方案，Maven/Gradle/JUnit 和真实项目也未全部验收。旧扩展目录保留；新目标 profile 不启用要求 25 的扩展。后续按扩展支持范围和安全更新复核升级，不把固定版本视为永久 LTS。

## 用户、对话和应用数据先定性

本机用户 UID/GID、附加组、home 路径与服务账户已经只读盘点。目标需保留数字身份与权限、避免 UID 冲突；当前还没有创建真实用户或迁入真实用户数据。隔离环境中看到的 nobody 可能只是 UID 映射，不是复制属主的依据。

| 数据 | 本轮结论 |
| --- | --- |
| 本地助手 sessions、索引与 SQLite | 数据库正在使用 WAL；在线 SQLite backup 只能取得单库事务快照，不能把多个数据库与追加中的 JSONL 当作同一时点。最终需应用停写后的快照／增量核对 |
| VSCodium User、工作区、WebStorage／Local Storage | 后两者可能混合扩展对话、界面状态及登录数据，先私有保留后验收，不当普通缓存删除 |
| 项目、个人资料和配置 | 保持 home 路径与符号链接；原生 ELF、`.node`、venv、`.eln` 分开做 ABI 检查，生成缓存按需重建 |
| 网络、蓝牙、钱包及其他凭据 | 不进入当前无认证测试 profile；在对应迁移阶段保留权限并进行实际会话验收 |
| PostgreSQL 等服务数据 | 独立于 home 快照，按版本、locale/provider、扩展及权限做逻辑迁移；不直接搬旧物理 PGDATA |

当前源扩展实际为 **56 项**。以 reflink 冻结后，源前／冻结副本／源后哈希与版本一致；隔离验收为 33 active、6 声明式注册、17 因 Java 政策、在线、远端或硬件等延期，11 项最小功能探针通过。Makefile Tools 和 debugpy 首次因只读执行目录失败，改用两个独立可写执行副本后通过，原冻结证据不变；Xmake 的 Flatpak 内工具缺失通过候选根私有 `flatpak-spawn --host --clear-env` 桥接解决，实际调用已有 Clang/libc++ 配置、编译并运行中文 C++。桥的身份核对指向候选根和外层隔离 namespace，未接入真实宿主 home、总线或密钥。Oracle Java 是另一份独立 profile 验收，不混入 56 项统计。

Neomacs 另已通过 Doom 2.2.4 core 源码加载和 early-init 最小非交互初始化。只冻结公开源及配置，未复制旧 `.local`、插件状态、`.eln` 或个人笔记，也未运行 `doom sync`。这仍不代表全套旧 Doom 模块、交互界面和用户资料已经迁移。

PostgreSQL 18.6 的合成预验证使用 UTF8＋ICU `zh-Hans-CN`，中文排序、约束、索引与 dump/restore 通过。宿主 glibc pg_dump 在清空环境、空凭据文件和显式私有 socket 下，对隔离 musl 测试服务器导出，再由 musl pg_restore 恢复；数据、排序、索引和约束一致，LLVM JIT 也实际执行通过。原数据库及服务没有读取或迁移；真实库的角色、扩展、大对象、locale/provider 和回退仍待逐项验收。

正式迁移先保留原 `@home` 回退基线，测试系统使用独立写入的 home 树，避免与旧系统共用可变配置。最终应用停写后再固定快照，核对权限、哈希、数据库与实际工作流。本轮没有创建或改名子卷，也没有把测试副本当作最终用户迁移。

## 长批次后的安装与启动边界

Firefox 153.7 配方直接回补官方 Gentoo 提交及语言包 Manifest；固定基线的 Rust eclass 仍使用 `llvm-r1`，因此配方两处 helper 调用单独做版本限定适配，不改全局 eclass，实际编译器仍选 LLVM 22。新版无 GCC/glibc 预演通过，Zip、cbindgen、图标虚拟包、simdutf、simdjson 已安装；Node、中文语言包和浏览器本体均已完成正常沙箱安装。首轮编译中，静态 musl Rust 构建脚本无法动态加载 libclang；仅对 Firefox 配方增加 rustc wrapper，使宿主脚本与目标都使用动态 musl 链接，普通 UID 250 的对照、离线 Cargo 宿主脚本测试及完整重建均通过。普通用户、空白 profile、隔离网络的离线中文页面渲染和截图目检通过；安装后 1,194 个包、82 个 world 选择，完整 world 预演无待合并项。GPU、输入法、旧 profile 和 Widevine DRM 尚未验收。本体的 9700M 检查是工作空间，另需保留根分区 20GiB 底线及下载／安装余量；本轮把构建临时目录放到独立 Linux 文件系统，仍保留空间保护。

OpenRC 服务只做了静态登记：`elogind → boot`，`dbus`、`NetworkManager`、`soniclogin`、`firewalld`、`sysklogd`、`chronyd → default`，没有实际启动服务。Sonic 登录器自身提供 display-manager；iwd 通过 D-Bus 激活，PipeWire 保持普通用户会话启动。五项内核／引导选择的预演均通过；XanMod 与 virtual/dist-kernel 已在独立实验根安装，签名、CJK 和 initramfs 存储驱动检查通过；通用设备固件、rEFInd 和 shim 尚未安装，fstab、真实用户和启动项仍待布局阶段处理。

签名内核批次沿用同一 Portage 写锁、候选根身份与锁内即时 world 预演。停止路径经过普通用户合成测试，子进程组确认清空后才接受下一任务；旧进程及挂载干净退出后复用构建镜像，没有重新格式化。先使用公开证书验证旧内核，再限于受限批次读取现有签名材料，目标私钥副本保存在新根 root 私有目录，不进入配置仓库。真实 ESP 未写入。新内核配置与 initramfs 的 NVMe／Btrfs 模块检查通过，新增驱动及固件的 initramfs 更新、通用设备固件、真实启动和回退仍需后续完成。

CUDA 先拆出 Clang device-only 头文件、CCCL 和 libdevice 数据包，配方补丁放入已有 Gentoo-Zh，不新建 overlay。普通用户、无网络／GPU 的变量 `sinf` sm_89 PTX 测试通过，随后正常 Portage 安装及安装后验证也通过；没有把数据包等同于完整 SDK。旧 musl CUDA 程序仍结合静态 cudart 和 gcompat，NVCC、ptxas、宿主运行库和用户态驱动需要继续分层打包验收。

NVIDIA 620.70.06 现有配方增加了版本限定的 modules-only 分支，沿用 Gentoo 原有模块编译与签名流程，不增加 overlay。真实预演发现 Gentoo-Zh 已有 virtual/linux-sources provider，因此撤回了冗余 provider 补丁。五个开源模块用普通 UID 250 编译、安装阶段签名，匹配 7.2.14-musl-x64v3，并以预期公开证书逐个验证 PKCS#7 签名。另将同版本四个 GSP／ucode 文件作为独立数据包，从官方归档经 Gentoo Manifest 校验后提取，不执行厂商安装器；载荷哈希通过。这一批复核为 1,201 个包、87 个 world 选择，无 GCC/glibc，完整 world 预演零项；尚未加载新模块或验证 PRIME／显示输出。

当前内核保留动态抢占和 lazy 默认值，已启用 CJK16／32 控制台字库。XanMod 提供独立 RT 分支，但 RT 主要降低实时调度延迟，不能保证更高编译／CUDA 吞吐或更低能耗；本机这版 NVIDIA 源码还有 RT 拒绝检查。先完成普通内核与驱动验收，再在独立启动入口比较 preempt=full 的帧时间、音频和放电功率，不直接把迁移目标改成 RT。[XanMod 官方说明](https://xanmod.org/)、[内核实时机制](https://docs.kernel.org/core-api/real-time/theory.html)、[动态抢占参数](https://docs.kernel.org/admin-guide/kernel-parameters.html)。

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
