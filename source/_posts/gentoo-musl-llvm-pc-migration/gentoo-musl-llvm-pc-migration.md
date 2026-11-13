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
| SonicDE/XLibre/Rime | 依赖预演通过，源码构建中；原生 Qt/Fcitx/Rime 实际键入并提交“你好”通过 | 新桌面登录、GTK/Flatpak 输入法和实际硬件显示 |
| 全新 stage3 安装基础 | 正确权限解压、基础包核验通过；默认 Portage 用户与沙箱源码安装官方 hello 通过 | 完整桌面与内核安装 |
| 新根启动 | 尚未执行 | 内核/initramfs、Secure Boot、第一次启动和回退 |

VSCodium 本轮验证的扩展包括 Python、debugpy、Jupyter、Jupyter Renderers、Ruff、rust-analyzer、Tinymist 和 Office。没有把原用户的凭据复制到实验环境，也没有把“扩展目录存在”当作“扩展加载成功”。

## glibc 兼容环境怎么选

gcompat 可以处理一部分 glibc ABI，但不是完整 glibc。本轮最小 CUDA 计算验证通过，并不代表 NVIDIA 整个显示栈已经可用；旧扩展附带的 Ruff、rust-analyzer、Tinymist 在当前 gcompat 环境下甚至会在版本查询时崩溃。

图形部分后来有了单独的进展：参考 Chimera 的 [NVIDIA 草案 PR](https://github.com/chimera-linux/cports/pull/6531)，固定到 `c26532983c3b811c2d6b310058761bba39491bbe`，在私有目录构建带 IFUNC/TLS 补丁的 musl 加载器、gcompat 和兼容 shim，只调整驱动库的实验副本。原系统及实验根的默认 libc 均未替换。

在本机 RTX 4060、620.70.06 驱动上，这条路径已经完成 EGL 1.5 / OpenGL 4.6 上下文创建、离屏清屏与像素回读。使用默认 musl 的对照组仍报重定位类型 37 不受支持。这证明了一个有限的原生图形兼容路径；上游仍是草案，本地尚未完成安装包，也没有验证 XLibre 显示、PRIME、外接显示、休眠恢复或 Vulkan。

因此目前把两条路线分开验证：

- SonicDE、XLibre、输入法和主系统工具使用原生 musl/LLVM。
- 闭源桌面应用与 VSCodium 的现有 glibc 扩展优先测试 Flatpak 运行时。

另外建立的独立 glibc stage3 仍保留作对照。它需要单独创建根环境、维护软件、配置 locale 和用户会话接口；安装一个 chroot 工具不会自动完成这些工作。如果最后仍采用这条回退路线，正式教程会明确写出额外空间和维护责任。

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

Fcitx 5.1.21 另有旧 Wayland CMake finder 与当前 SonicDE ECM 不匹配的问题。本轮目标是 XLibre/X11，因此只关闭这个版本 Fcitx 自身的 Wayland 后端，其他 Qt/Wayland 客户端库保留。两项配置随实验目录记录；GTK 和 Flatpak 应用的中文输入仍待独立验证。

CUDA 的宿主数学调用和 gcompat amd64 加载器路径也有小型实验补丁。最小验证通过不等于完整 ebuild、CUDA SDK 或原生 NVIDIA 图形兼容已经验收；补丁状态在仓库说明中单列。

新环境不默认安装 GNU Emacs。Neomacs 已有 Gentoo overlay，但仍是实验软件；musl、现有 Doom 配置及中文输入等尚待验证。若它不满足需要，本轮不会自动退回安装旧 Emacs，原系统与 Windows 配置继续保留。

## 新根、子卷和回退

当前实验根曾非特权解压，并为嵌套隔离调整过 Portage 用户与沙箱，只用于实验。正式新根要从已验签 stage3 以正确权限重新建立，恢复正常用户、文件归属和沙箱，再复用审核过的配置与受控构建包。

现在已经另行建立正确权限的全新 stage3 根：核对 63,870 个归档条目的属主、权限与符号链接，并确认 282 个基础包与官方归档一致。没有把旧实验根的文件归属或用户配置直接带过去。

随后在新根中保留默认 `sandbox`、`userpriv`、`usersandbox`、`ipc-sandbox`、`network-sandbox` 和 `pid-sandbox`，从源码安装官方 hello。编译阶段的实际身份是 Portage UID/GID 250:250，安装后运行输出正确，未引入 GCC 或 glibc。这一步证明了全新 stage3 的安装基础；完整桌面、新内核和启动流程仍须继续验收，不能据此把教程标为迁移完成。

候选 Btrfs 布局是在现有文件系统内新增 `@musl`，保留原 `@`、`@home` 和启动项。`/dev/nvme1n1p2` 是分区设备，不是要赋给子卷的名字，也不需要仅为此次迁移重新格式化分区。

第一次启动成功后，仍要做多次启动、桌面使用、更新与回退验证。用户配置先隔离，数据按应用清单恢复；旧 glibc 根的删除另行决定，不能把“迁移能启动”当作“旧根可以立即删除”。当前还没有进行这一步切换。

## 参考

- [Gentoo musl 项目](https://wiki.gentoo.org/wiki/Project:Musl)
- [Flatpak 基本概念](https://docs.flatpak.org/en/latest/basic-concepts.html)
- [中科大 Flathub 缓存说明](https://mirrors.ustc.edu.cn/help/flathub.html)
- [Chimera 的 musl/NVIDIA 实验](https://chimera-linux.org/news/2026/11/musl-nvidia.html)
- [NVIDIA PRIME Render Offload 文档](https://download.nvidia.com/XFree86/Linux-x86_64/620.70.06/README/primerenderoffload.html)
- [Neomacs](https://github.com/eval-exec/neomacs)
