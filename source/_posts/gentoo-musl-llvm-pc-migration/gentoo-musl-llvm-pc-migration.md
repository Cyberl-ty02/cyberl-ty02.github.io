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

> 默认 PC 配置已转为 `gentoo_setting/pc/` 中的 musl／LLVM／OpenRC。
> 旧 glibc 配置由 Git 历史保留，不再重复维护。安装步骤与迁移经过统一在本文，
> 配置根 README 只保留入口、约束和当前验收边界。博客部署与合入 main 分开决定。


这篇记录我从官方 musl/LLVM/OpenRC stage3 验证 Gentoo PC 安装的过程，目标仍是 SonicDE、XLibre 和 NVIDIA/CUDA，并尽量保留微信、腾讯会议、WPS、VSCodium 等日常使用体验。系统已有一套 glibc/LLVM 安装，因此实验的前提是保留原根、家目录和引导入口，先证明新环境能工作，再安排切换。

> **当前状态：musl／LLVM／OpenRC 已完成真机迁移并转为默认 PC 配置。**
> 2026-11-23 已完成归档实际恢复和 CUDA Python 专项检查，日常使用与 Windows 配置同步已人工确认。用户决定退役旧系统恢复资料，不再安排回退启动。
> 开头表格与文末收口为当前结论；中间按阶段保留当时的失败与边界，不应再当作仍有实验根或待运行队列。通用安装步骤见[实体机安装指南](/posts/gentoo-endeavouros-btrfs-openrc-install/gentoo-endeavouros-btrfs-openrc-install/)，差异按 glibc／musl 面板分开。

## 从哪个 stage3 开始

本轮使用 `stage3-amd64-musl-llvm-openrc-20261108T170107Z.tar.xz`，核对官方发布签名和 SHA512 后解压。它带有 musl、Clang/LLVM、LLD、libc++ 和 OpenRC，对应 profile 为：

```text
default/linux/amd64/23.0/musl/llvm
```

这里的版本号是实验基线，不是要求后来的新机器永远下载同一份归档。新装时仍要检查官方当前 stage3、发布密钥和 Handbook，也不要在已有 glibc 系统里仅切换 profile 来完成 libc 迁移。

源码和正式 PC 配置放在 dotfiles 的 [musl 配置目录](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)。该目录现为日常 PC 默认方案，WSL 和 Windows 配置独立保留。

## 已经验证了什么

| 项目 | 当前结果 | 按实际需要另行验证 |
| --- | --- | --- |
| UTF-8／ICU／字体 | 中文文件、字符处理、格式化、系统与 Flatpak 字体匹配通过 | 旧编码与逐个应用的语言实现 |
| NVIDIA／CUDA | 新内核模块真实加载、CUDA／NVML、NVCC／CMake／RDC、八项 Python 数学检查与600秒有限负载通过 | 长期生产模型、多 GPU、GPUDirect、完整数学边界 |
| 原生显示 | SonicDE／XLibre 真机登录及日常桌面已人工确认，私有 EGL 离屏回读通过 | 特定外接显示、PRIME、Vulkan、休眠与功耗 |
| Flatpak／日常应用 | 系统部署与触发器通过；用户确认微信、WPS、VSCodium、音视频与 FlClash TUN 日常正常 | 逐款账号、DRM、会议共享与所有设备场景 |
| IDE／Java | Dragonwell Standard21、Oracle Java、Maven模板／JUnit及精选插件通过，Windows 配置同步已人工完成 | 其他插件组合和具体课程／业务项目 |
| 新机基础 | 官方 stage3 正确解压、默认 Portage 用户／沙箱构建、完整桌面安装通过 | 新硬件驱动选择、签名登记和现场设备验收 |
| 系统与用户 | 新根多次启动、普通更新、唯一 HOME、root／用户独立 Zsh／Doom 与资料接续完成 | 不以日常反馈替代全部应用专项测试 |
| 归档与退役 | 旧 root／home／boot 实际隔离恢复及只读 scrub 通过；按明确授权已删除三份旧密文及专用恢复凭据 | 不再安排旧系统回退启动，也不声称做过该测试 |

插件清单、补丁与运行入口在配置仓库维护；历史测试中出现的版本不是永久锁。安装、私有 GUI、真实硬件与用户操作始终分别验收，不能把目录存在写成插件已加载。

## 将 mold 设为全局默认

后续按新选择恢复 mold。候选 musl 根用官方配方、原生 Clang/libc++ 安装 mold 2.42.1，
只新增 blake3、TBB 和 mold 三个包，没有安装原生 GCC／glibc，也没有增加 overlay。
Clang 的 `gentoo-linker.cfg` 改为 `-fuse-ld=mold`，Portage `make.conf` 设置
`LD="ld.mold"`；它们是后续普通构建的全局默认，不会将已经安装的软件全部重新链接。

已有内核配置实际是 `CONFIG_LD_IS_LLD=y`。旧 make.conf 中有 mold 编译器选项，
不表示内核最终也用了 mold；这次通过既有 `package.env` 分开保留 XanMod 的 LLD 和
GNU-EFI／rEFInd 的 BFD，模块配方按目标内核选择链接器。未改签名权限范围、真实 EFI
或原系统默认。编译器选择方式可对照 [mold 官方用法](https://github.com/rui314/mold/blob/v2.42.1/README.md#how-to-use)。

新机在已准备配置的目标 root chroot 中可执行：

```bash
# 位于 dotfiles/gentoo_setting/pc
emerge --ask sys-devel/mold
bash scripts/configure-linker.sh --linker mold --dry-run
bash scripts/configure-linker.sh --linker mold
portageq envvar LD
```

脚本自动识别 Clang 主版本，支持显式 `--clang-major 22`，备份后修改，可重复运行；
回退使用 `--linker lld`。LLVM 升级、处理 CONFIG_PROTECT 后检查对应主版本的设置。
它不替换 `/usr/bin/ld`、全局预加载或用户 Cargo 配置，也不改 Flatpak SDK 内的工具链。

普通 UID 250 的 C、libc++、共享库／dlopen／线程／TLS 测试通过，未剥离产物确认带有
mold 标记。Rust 在明确使用 Clang 驱动、动态 musl 和关闭自带链接器的测试中通过，
不等于所有 Rust 项目的自带链接策略已被覆盖。正常 Portage 重建 tree、私有 NVIDIA
兼容层与 GNU-EFI 后，普通用户 NVIDIA EGL／CUDA／NVML 回归也通过。最新复核为
mold 阶段当时为 1,214 个包、95 项 world，更新预演零项。

随后按新选择重建 LLVM 22.1.8 并安装同槽 LLVMgold，开启 C/C++ 与 Cargo release
ThinLTO。普通用户的 bitcode、静态归档、共享库、TLS／dlopen／线程、libc++ 和
离线 Cargo proc-macro 验证通过。tree 实际重建通过；私有 NVIDIA musl 加载器在
ThinLTO 重建中出现 `__dls2` 早期入口未解析，现已用补丁组 0005 让现有早期启动
对象单独禁用 LTO，其余 1,343 个普通对象保留 ThinLTO。正常沙箱重建安装及普通用户
加载器正负对照、EGL／CUDA／NVML 回归通过，系统原始 musl 哈希未变。已签名内核仍为 `CONFIG_LTO_NONE=y`，没有据此宣称新内核已经使用 LTO。

### 按现有 PC 的 make.conf 分组复用

musl 配置复用 PC 版本的字段顺序、USE 分类、国内优先镜像、下载和续传重试、
FEATURES、构建调度、优先级与签名路径。保留 profile FEATURES 和正常编译沙箱。
`-march=native` 与 `-j13 -l13` 是本机参数，新机需要按硬件和剩余空间调整。

目标差异保留为 musl CHOST、64 位 ABI、Python 3.14、中文优先及独立 NVIDIA 用户态；
不复制 glibc 的 32 位 ABI。C/C++ 使用命名的 ThinLTO 变量，Fortran 保留 `-flto`
写法而不安装 GCC，链接器和 LTO 脚本支持该格式及原 stage3 平铺格式。
内核／UEFI 通过 Portage 支持的环境片段保留 LLD／BFD 和各自的 LTO 边界。

make.conf 已补充中文注释，不固定 `ACCEPT_KEYWORDS` 或缓存目录，继承 profile／
Portage 默认值，默认链接器仍为 mold；测试版按包登记。删除与全局重复的签名环境后，
`env` 从 8 个精简为 7 个，保留各包必要的独立约束；对全部 1,215 个已安装包比较
编译、签名及权限等有效设置，差异为零。

后续维护规则也已整理：包条目、独立 env 键和仓库节按 `0–9、a–z` 升序，
make.conf 的变量依赖和镜像优先级保持原序。对全部 1,215 个已安装包比较，排序
没有改变有效设置或仓库优先级。

普通关键词／许可不锁发行版，部分 USE 按 slot 跟随升级；Dragonwell 仍使用 Standard
21，Neomacs 不再锁定 Git 提交。仓库已允许 auto-sync，但本轮没有实际同步。
放宽后预演为 291 项，新增 platformdirs 4.14.0 升级，没有原生 GCC／glibc；
该次配置调整未实际升级软件。内核签名权限、NVIDIA 配套和实际兼容性保护继续单独核验。

补丁索引提供 `scripts/apply-patch-if-needed.py`：默认仅检查，可应用时才写入，
已包含相同修改时自动跳过，不兼容则停止并保留目标。它不强打补丁，也不是自动
更新所有 ebuild 的服务；版本目录和固定提交仍保留为验收记录，不当作永久更新上限。

预演修复了全局 udev 对 ALSA 的依赖，并按现有 rEFInd 约束保留 GNU-EFI <4。
最初完整 world 更新预演通过，计划 290 项合并（133 新增、157 重建），多数新增是
`verify-sig` 引入的公钥和验签依赖，没有原生 GCC／glibc。配置已应用候选根，
链接器和 LTO 往返切换、幂等性及 C/C++／Cargo 小型编译检查通过；该预演阶段尚未
开始合并；后续进度以上方本轮接续记录为准，先前 mold 阶段的 world 零项是历史里程碑。配置及细节统一维护在
[实验目录](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)。

### 本轮接续：验签前置与私有 XLibre 模块

原 291 项配置对齐已完成 101 个公钥／信任根包和 32 项验签工具依赖，正常沙箱安装
通过。普通 UID 250 的 Ed25519 正负签名测试及 Sigstore CLI 通过，不等于已验证远程
Sigstore 工件。该前置批次复核时，候选根有 1,349 个包、96 项 world 选择，剩余 158 项；
未引入原生 GCC／glibc。LLVM libgcc 23 因配套 libunwind 关键词限制而被跳过，
当前仍用已验收 LLVM 22，没有扩大测试关键词来追新版本。

NVIDIA 补丁组增加可选 `xlibre` USE，将官方归档中的 DDX／GLX 模块安装到
`/usr/libexec/nvidia-musl/xorg`，提供 `nvidia-musl-xorg` 私有入口。它从 Xorg 的
stderr 查询默认模块路径，不锁定 XLibre 主版本目录；未改系统模块、全局 GLX
链接或 Sonic 登录器。入口及已安装模块在普通用户、只读根、无 GPU／DRM／真实 VT
的 dummy XLibre 会话中通过启动和 xdpyinfo；GLX 另用测试专属别名加载通过，核心
EGL／CUDA／NVML 回归也通过。

日志显示 XLibre 上游自身会对 NVIDIA 隐式忽略 ABI 差异；本次没有设置 IgnoreABI，
仍不能宣称严格 ABI 或真实 NVIDIA 显示验收。硬件屏幕、PRIME／混合 GLX、休眠和
完整 Sonic 登录仍要单独验证，真实桌面尚未切换。

ThinLTO 片段先以独立 KCONFIG_CONFIG 通过 olddefconfig，随后实际重建并安装
XanMod 7.2.14；已签名内核现为 `CONFIG_LTO_CLANG_THIN=y`，CJK 与强制模块签名
检查通过。匹配的五个 NVIDIA 模块正常编译安装，逐个 CMS 验签通过；模块装好后
重新生成通用 initramfs，验证存储、GPU、固件、早期微码及镜像内模块签名，确认没有
签名材料和原宿主根参数，最终 world 零项。尚未真机启动，也未修改真实引导。

第一次校验用 `nvidia*.ko` 计数，误包含内核自带的 WMI 背光模块；改为明确的五个
驱动文件后接续验证通过，无需重编内核。安装内核时自动生成的中间 initramfs 可能
尚无匹配 NVIDIA 模块，必须在模块安装后重新生成并验收最终镜像。
验签解包目录和重复临时镜像已清理约 477MiB；旧内核及模块回退副本保留到真机启动
与回退验证通过。全新 stage3 首次安装先用 LLD／无 LTO 准备
mold 与匹配 LLVMgold，再切换最终默认，具体 chroot 命令统一维护在实验 README。

### 串行对齐中修复 mold 的线程栈

后续 158 项串行对齐在完成前 28 项后，停于 curl 的 ThinLTO 链接。保留现场后，以普通
编译用户重放同一组目标文件：原 mold 崩溃、LLD 成功；回溯位于 LLVMgold 的 LLVM
优化线程，存在深层 PHITransAddr 递归。只在独立 mold 副本中将 PT_GNU_STACK 设为
8MiB 后，同一链接成功，支持线程栈不足的诊断。musl 对默认栈与 ELF 调整机制的说明见
[官方差异文档](https://wiki.musl-libc.org/functional-differences-from-glibc.html#thread-stack-size)。

修复整理为现有 Gentoo 仓库的 [mold 补丁组](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/mold-musl-stack)：
仅在 musl 构建 mold 时追加 8MiB 默认栈，不新增 overlay／env 文件或永久版本上限。
旧 mold 尚不能承载该重型链接时，仅此次重建用 LLD 引导，随后仍以 mold 为全局默认，
不关闭 ThinLTO，也不调整系统 ulimit。正常沙箱重建后，实际产物的 GNU_STACK 为 RW
非可执行、MemSiz 8MiB，原 curl 链接和库初始化通过，curl 正常安装成功。

其余 130 项接续已全部完成，原 291 项对齐计划完成；此前成功的软件没有重复重建。
最终 world 复查为零项，更新后的普通用户 C／C++／Cargo ThinLTO 检查通过，没有
待合并配置，候选根 `/boot` 哈希未变。上游已有等效线程栈
保证且撤回后原重现通过时删除补丁；不把旧版本目录当作永久锁定，也不强打不兼容
补丁。本轮没有切换实际桌面、内核或引导。

更新后的独立回归也通过：私有 GLcore、当前宿主驱动的 EGL／CUDA／NVML、XLibre
私有模块和 dummy 会话、Xvfb 内的 SonicDE shell／窗口管理器／面板菜单／PipeWire，
以及 Dragonwell Standard 21、Bun 中文格式、Neomacs SQLite、中文 locale 与字体。
根目录只读，使用独立用户配置及隔离网络；真实显示、声卡和旧账户数据仍待验收。

后续集中为几个串行批次：先完成桌面与剩余应用集成，再构建并核验签名 ThinLTO
内核、匹配模块与 initramfs，随后准备候选子卷和回退入口，最后停写形成一致数据
副本并进行真机启动、日常使用与回退验收。同一根只允许一个 Portage 写入进程，
报错先定位修复，再从未完成项接续。内核回退包与合并依赖已预先检查，签名构建另用
明确的密钥访问范围；不因为批次合并而扩大旧授权，也不提前清理原根。

## glibc 兼容环境怎么选

gcompat 可以处理一部分 glibc ABI，但不是完整 glibc。本轮最小 CUDA 计算验证通过，并不代表 NVIDIA 整个显示栈已经可用；旧扩展附带的 Ruff、rust-analyzer、Tinymist 在当前 gcompat 环境下甚至会在版本查询时崩溃。

图形部分后来有了单独的进展：参考 Chimera 的 [NVIDIA 草案 PR](https://github.com/chimera-linux/cports/pull/6531)，固定到 `c26532983c3b811c2d6b310058761bba39491bbe`，在私有目录构建带 IFUNC/TLS 补丁的 musl 加载器、gcompat 和兼容 shim，只调整驱动库的实验副本。原系统及实验根的默认 libc 均未替换。

在本机 RTX 4060、620.70.06 驱动上，这条路径已经完成 EGL 1.5 / OpenGL 4.6 上下文创建、离屏清屏与像素回读。使用默认 musl 的对照组仍报重定位类型 37 不受支持。这证明了一个有限的原生图形兼容路径；上游仍是草案；本地最初只有独立实验副本，随后完成了下面的私有前缀安装验收。XLibre 显示、PRIME、外接显示、休眠恢复和 Vulkan 仍未验收。

重启后，将这层整理成已有 Gentoo-Zh 仓库的版本补丁，正常 Portage 安装 `sys-libs/nvidia-musl-compat-1.2.6_p20261115` 和 `x11-drivers/nvidia-userspace-musl-620.70.06`，仅引入 libucontext 依赖，没有新增 overlay 或原生 GCC/glibc。加载器、兼容 shim 和约 293MiB 核心驱动库放在 `/usr/libexec/nvidia-musl`，原始 musl 仍匹配 Portage 登记哈希；不替换系统 libc、不全局注册图形库，也不改当前桌面。

安装后的专用 `nvidia-musl-run` 在普通 UID 1000、只读候选根、独立 HOME 和无网络环境中通过 GL 核心加载、EGL 1.5／OpenGL 4.6 离屏渲染、像素回读、CUDA 64 字节显存往返及 NVML 驱动查询。默认加载器对照仍报重定位 37。这次使用已安装文件与当前宿主 620.70.06 模块，尚未从新 musl 内核启动；启动器只接受单个动态 musl ELF，脚本、子进程和完整会话不会自动转换解释器。

本轮复核上游草案 `7b121686e15cc1d06ee1ee16968665004519d8a4`，四份关键补丁／源码与此前实验逐字相同；两份小型 musl／gcompat 固定源码也已重新下载验 SHA256。应用顺序、许可证、安装命令及撤回条件集中在 [NVIDIA 补丁组](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/nvidia-620.70.06)。候选根最终复核为 1,211 个包、94 项 world 选择，更新预演零项。完整 XLibre 驱动、PRIME、休眠与真实桌面仍要继续集成。

因此目前把两条路线分开验证：

- SonicDE、XLibre、输入法和主系统工具使用原生 musl/LLVM。
- 闭源桌面应用与 VSCodium 的现有 glibc 扩展优先测试 Flatpak 运行时。

另外建立的独立 glibc stage3 已完成对照实验，其目录已归档回收；归档与受限文件保留。它需要单独创建根环境、维护软件、配置 locale 和用户会话接口；安装一个 chroot 工具不会自动完成这些工作。如果最后仍采用这条回退路线，正式教程会明确写出额外空间和维护责任。

Flatpak 的 GPU 路径也做了单独验证：在 musl 宿主隔离根中，只挂入必要 GPU 节点和只读 sysfs，使用 VSCodium 所在的官方 glibc 运行时及 NVIDIA 扩展，CUDA 初始化、显存写入与回读通过；EGL 1.5 / OpenGL 4.6 离屏渲染和像素回读也通过。这条路径没有加载实验 musl 补丁。它仍只是运行时级别的测试，不等于 VSCodium 的全部 GPU 功能、CUDA 开发环境或其他应用已经验收。

Flatpak 提供的 glibc 库不用于满足宿主 Portage 依赖。已经在同一 musl 根中成功安装的宿主库，由 Portage 按版本、USE 和 ABI 复用，不必因为应用再装一次相同版本。

## 在 chroot 内一键安装 Flatpak 主包

先按原安装指南准备目标根的 `/proc`、`/sys`、`/dev`、`/dev/pts`、DNS、CA 证书、系统时间和代理，并通过 Portage 安装 Flatpak 本体。这些实验脚本目前位于 `main` 分支。使用独立 checkout 并核对接受基线，不覆盖已有工作区；例如在目标 chroot 的 root shell 内执行：

```bash
git clone --branch main --single-branch \
  https://github.com/Cyberl-ty02/dotfiles.git /root/dotfiles-musl
cd /root/dotfiles-musl/gentoo_setting/pc
bash scripts/install-flatpak-apps.sh --dry-run --system
bash scripts/install-flatpak-apps.sh --system
```

脚本在 root 下默认系统级安装，写入目标系统的 `/var/lib/flatpak`。它不要求普通用户先登录桌面，也不在 chroot 中启动 D-Bus、elogind、Portal 或应用 GUI。本轮已在没有桌面会话和 D-Bus 的隔离根里完成系统级安装、安装后触发器复核和重复运行验证；缓存经过预置，这仍不代替 LiveCD 全流程及第一次启动验收。

默认主包 ID 为：

```text
cn.wps.wps_365
com.qq.QQ
com.tencent.WeChat
com.tencent.wemeet
com.vscodium.codium
org.localsend.localsend_app
org.mozilla.thunderbird_esr
```

LocalSend 采用[官网列出的 Flatpak 路线](https://localsend.org/download)，1.18.2 已在新根系统级安装，私有 X11 显示中的中文界面通过。局域网发现和文件传输仍待真机会话验收。Thunderbird 使用[官方 ESR Flatpak](https://support.mozilla.org/en-US/kb/channel-choices-thunderbird-snap-and-flatpak)，153.7.0esr 中文界面启动通过；QQ 社区 Flatpak 3.2.35-54395 的腾讯 extra-data 已核对固定哈希并完成安装，隔离离线中文窗口通过，未登录。QQ 首次代理下载中断，经腾讯国内地址直连下载校验后，复用 Flatpak 自带的本地 extra-data 缓存安装，签名与哈希检查保持启用。两项均未访问原邮件或账户配置。

运行时、语言内容、Mesa 和匹配当前驱动的 NVIDIA 图形扩展由 Flatpak 自动解析，不把实验机器的显卡版本写成所有机器的固定依赖。VSCodium 当前使用 Freedesktop SDK 26.08，体积比普通运行时大；其中的 glibc 开发工具与 musl 主系统分开维护，不等于向主系统安装 GCC。

腾讯会议 `com.tencent.wemeet` 已从签名 Flathub 正常安装，复用现有 Freedesktop
25.08 运行时；普通用户在只读候选根、独立 Xvfb／会话总线、空 HOME 与离线环境中
实际 `flatpak run`，完整中文登录界面已目检。没有登录或勾选协议；真实会议、摄像头、
音频和屏幕共享仍待验收。已加入默认主包，更新后的六主包脚本也在无系统 D-Bus 的
目标 root chroot 重复执行通过。此前手工重建 Flatpak build 布局未出窗口，恢复
官方原始载荷、启动脚本与空 xcast.conf 的对照也未通过；正常维护包的安装结果
不能用这些局部测试代替，更不能据此认定 musl 必然无法使用腾讯会议。

中文 WPS 后来找到单独维护的 [`cn.wps.wps_365`](https://github.com/flathub/cn.wps.wps_365)，
本轮为 12.1.2.29183，官方载荷与签名元数据哈希一致，正常安装后复用 FDO 26.08。
经用户明确同意，仅在离线测试配置接受许可／隐私条款，实际打开自建中文 DOCX，
追加中文、保存，再于新会话只读重新打开并目检；ZIP CRC、XML 文本和文件哈希通过。
这里用剪贴板输入中文，Fcitx/Rime 仍需单独验收。没有登录、打开旧文档或设置真实
默认应用；表格、演示、PDF、插件与协作仍待检查。维护包不含暂不可用的 Xiezuo；
国际版 `com.wps.Office` 仍不列入清单。默认主包因此增至七项。七主包脚本在无系统 D-Bus 的目标 root chroot 中重复执行通过，随后 world 复查零项，没有引入原生 GCC／glibc。

脚本为 Flatpak 保留 `zh`／`en` 语言内容。若 WPS 界面语言需要切换，按上游说明在
目标用户的 `~/.var/app/cn.wps.wps_365/config/Kingsoft/Office.conf` 中，于
`[General]` 下设置 `languages=zh_CN`。不要为做试验改动原用户配置。

重新打开测试还发现，应用退出后仍可能留下 Unix socket／FIFO。停止写入后复制
测试配置时，排除缓存、IPC 与设备节点，再验证文档成功重开；这也说明后续真实
用户迁移不能直接整棵复制运行中的目录。测试条款确认只作用于该隔离配置，不替
新机器的使用者预先接受协议。

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

补丁现在按软件整理在仓库的 [patchsets 目录](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets)，每组写明适用版本、验证状态和移除条件，避免长期维护整份本地 ebuild 副本。配方依赖变更放 `repository/`，源码变更放 `source/`；Portage 用户源码补丁不能补齐缺失的 `DEPEND`。

本轮 Sonic 图像编辑 0.7.0.1 就需要这两层：配方声明 Highway 依赖，源码使用其标准 `hwy` CMake Config。等效修正在 musl/Clang/Highway 1.4.0 下编译安装通过，补丁组也在独立工作副本完成应用与反向撤回检查。原实验根保留旧配方快照作对照；全新根随后也已通过上游配方加版本限定用户补丁安装图像编辑组件，VDB 来源保持 `sonicde`，日志确认源码补丁实际应用。上游修复后分别核对两层，不反向撤销已经进入上游提交的修正。

Sonic Login Manager 6.8.0.3 还暴露了一个头文件问题：`SelfProvisioner.h` 使用 POSIX 的 `uid_t`、`gid_t` 和 `mode_t`，没有直接包含定义它们的头文件。单独补上 `<sys/types.h>` 后，musl/Clang 编译安装通过；这也是独立源码补丁组，不改变登录、PAM 或权限逻辑。

原实验根的桌面源码构建已通过。在私有 Xvfb、独立 D-Bus 和用户配置中，SonicDE 窗口管理器、桌面 shell 持续运行并提供接口，中文欢迎界面和壁纸实际绘制出来。该测试采用软件 QML、关闭合成，且没有系统总线与物理设备；它不覆盖真实登录、硬件显示、关机或音频。音量界面的配置缺口也在这一步发现：meta 的 `pulseaudio` 开关选择界面，服务端仍用 PipeWire。补齐后，私有会话的面板、时钟和音量图标绘制正常，PipeWire 进程与 Pulse 兼容套接字通过检查；真实播放和麦克风仍待启动后验证。

CUDA 的宿主数学调用和 gcompat amd64 加载器路径也有小型实验补丁。最小验证通过不等于完整 ebuild、CUDA SDK 或原生 NVIDIA 图形兼容已经验收；补丁状态在仓库说明中单列。

新环境以 Neomacs 替代 GNU Emacs。固定提交 `aacf29294ab30aed5736e1eabcb3b83122593fce` 的 0.0.20 已在 musl 根安装，不引入 GCC 或 glibc。源码补丁修复七处 musl 编译兼容问题，以及 Lisp 引导中的栈段测量错误：原实现把较大栈段返回调用者时的剩余空间差当作消耗量，导致后续栈分配不断增大，最终报 `mprotect/mmap: ENOMEM`。真实 musl、UID250、stacker 的小型对照中，原版从 32MiB 增长至约 160MiB、670MiB，由测试夹具在分配前拦截；修复版 64 次调用及展开恢复保持 32MiB。诊断上限不进入生产补丁。

本次复用已准备源码和编译缓存，保留正常 Portage 沙箱；Rust release、Unicode 数据、127 个预载及 1,516 个 Lisp 文件引导、安装通过。配方另行修正 SQLite 特性和固定源码实际存在的图标／文档路径。普通用户 SQLite 中文读写、私有 X11 GUI、Fcitx5/Rime 输入 `nihao<space>` 并保存“你好”均通过。实验根已执行 `eselect editor set neomacs`，新 shell 可通过 `source /etc/profile` 更新 `EDITOR`；eselect 原有模块支持自定义程序，无需伪装成 `emacs`。这不代表空缓存全新重建、真实 GPU 或旧 Doom 配置已经验收。源码与配方补丁按用途归入配置仓库现有 Neomacs 补丁组，上游覆盖后逐项复验再移除。

## 旧 world 的覆盖范围

桌面批次安装通过不代表旧系统软件全部迁移，仍需按旧 `world` 的 91 项直接选择逐项核对。配置仓库的 [`world-migration.tsv`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/world-migration.tsv) 保存逐项状态，“待预演”不等于不支持 musl。

PostgreSQL 18.6、ClamAV 1.5.3、ClamTk 6.18-r2 随后已在默认 Portage 用户和沙箱下安装完成。PostgreSQL 工具能正常执行，没有初始化或迁移旧数据库；ClamAV 对自定义无害签名的正、负样本扫描结果正确，正式病毒库更新仍待验收。ClamTk 在私有显示中正常打开，但最初界面仍是英文：musl 下需明确绑定 gettext 目录，已整理为一行、按版本限定的补丁，实际重建和私有显示的中文界面通过。软件选择已通过 Portage 登记；迁移验收期间仍不运行 `depclean`。

截至 2026-11-14，旧系统 91 项 world 选择中，71 项已有同名原生安装，Telegram 改为原生源码包，GNU Emacs 由原生 Neomacs 替代，JDK 换为原生 Dragonwell Standard 21 LTS；微信、VSCodium、LocalSend、Thunderbird ESR 和 QQ 由 Flatpak 提供，当时暂时排除 mold，后续已按新的选择安装并设置默认。剩余 Firefox、FlClash 两项普通应用、五项内核／引导选择，以及 WPS、腾讯会议、NVIDIA、CUDA 四项专项集成。这是安装清单核对，不代表旧数据、全部界面或硬件已经验收。

本次统一授权的软件／配置批次已到复核点。Portage 六类配置按原顺序归并，整理前后比较了 1,158 个已安装包的有效设置，差异为零；替换前快照保留，不复制 GPG 私有目录。复核后的配置、环境片段及固定仓库提交清单同步到配置仓库的 `portage/`，源码补丁继续在 `patchsets/` 维护。新机仍须核对 profile、仓库版本、硬件和补丁，不整目录覆盖已有配置。Neomacs 与 Java 补齐后，新根共 1,191 个包、81 个 world 选择；安装通过仍不代表迁移完成，真实引导、数据库和旧根均未改变。本轮长批次已完成全部 34 项对齐（21 个新依赖、13 项 USE 重建），包括 SPIR-V translator、libclc、Mesa CLC 和 cargo-c；另装 Firefox 五项较小前置。最终 `@world --update --deep --newuse` 没有待合并项，仍无 GCC/glibc。当时官方 stage3 的 platformdirs 4.12.4 以精确关键词保留，避免非必要降版；后续已放宽规则允许上游升级。

其余软件已完成逐项预演；关键词、USE 等必要配置调整后，连同 PostgreSQL LLVM/JIT、NetworkManager iwd、Btrfs udev 和 XLibre Xvfb 功能恢复，共 48 个直接选择项已完成安装，四项恢复功能的 USE 已核对。Node.js 的依赖允许选择 Gentoo 官方 `llvm-runtimes/libatomic-stub`，明确加入该包后，Firefox／Thunderbird 的合并预演不再选择 GCC；Firefox 已回补含安全修复的 153.7 ESR 官方配方，新版预演通过，Thunderbird 已改用 ESR Flatpak。KTorrent 关闭可选内嵌 WebEngine，避免额外网页引擎构建。QQ 和 LocalSend 已通过 Flatpak 界面检查；FlClash 的 glibc 界面、Helper/TUN 与 OpenRC 集成仍待验证。

补齐过程中还遇到 lowdown 3.1.1 的 BSD 配置宏与 musl 头文件冲突，以及 ipset 7.24 的过期导出表被 LLD 拒绝。前者直接回补上游修复，后者保存为版本限定的本地源码补丁；两者均通过全新根正常沙箱编译安装，中文转换／帮助命令通过。nftables 1.1.7 的 xtables 兼容还需让 libc 的 Ethernet 头文件先于 Linux UAPI 包含，这项版本限定补丁也已通过正常沙箱编译安装，未操作真实防火墙规则。补丁集中保存在仓库补丁组中，不修改系统头文件或全局放宽链接校验。国内镜像顺序保持优先，下载沿用当前调用环境的代理；本批使用已恢复的本地代理，只有核验国内直连可用且更快时才临时加入 `no_proxy`。Manifest 和签名校验保持启用，代理地址不写死到新机配置。

Bun 官方 musl baseline 归档也已按发布资产 SHA256 校验。它需要 musl 版 C++ 运行库，复用已验签的 Alpine 约 2.7MiB `libstdc++`，在独立官方 stage3 中完成正常 Portage 沙箱安装，JavaScript、中文与人民币格式化通过，没有安装 GCC 编译器或 glibc。Alpine 与 Gentoo 的 libc／LLVM ABI 库名差异由配方内的 patchelf 修正，最终 SONAME 检查没有未解析依赖；运行库仅用于私有 wrapper，不全局修改库路径。配方已整理成新增小型运行库包及修改既有 Bun 配方的两组补丁，主桌面实验根的集成安装、CLI 和 SONAME 检查也已通过；随后在普通用户、隔离网络和独立源码副本中，使用原生 musl Bun 完整执行了现有博客构建，类型、测试、内容、runtime、Hexo 和生成物检查均通过。原源码与依赖哈希保持不变；这次只读复用已有 node_modules，空缓存依赖安装仍待验证。

## Dragonwell Standard 与软件包管理

JDK 按用户选择改为 Alibaba Dragonwell **Standard 21 LTS**，使用官方 21.0.13.0.13+9 GA 的 amd64 Alpine/musl 归档，不使用 Extended。归档按官方发布资产 SHA256 核对，Manifest 另记录 BLAKE2B 与 SHA512。69 个 ELF 的检查未发现外部 libstdc++／libgcc 依赖；66 个文件需要把 Alpine 的 musl NEEDED 名调整为 Gentoo `libc.so`。调整只作用于包内文件，不创建全局 libc 别名，也不引入 glibc 或 GCC。

配方使用 Gentoo 的 `java-vm-2` eclass，程序位于版本化 `/opt`，证书连接系统 Java 信任库。正常沙箱安装六个包及 `virtual/jdk:21` 后，以普通用户重新运行安装产物：javac、中文 UTF-8 文件读写、人民币格式、上海时区、CJK 字体及 PNG 输出通过，系统证书库可读取；这不等于真机 AWT、远端 TLS 或所有 JNI 项目通过。`eselect java-vm set system dragonwell-bin-21` 已在实验根完成，当前真实系统默认 Java 不变。

维护形式仍是补丁组：一份向现有 Gentoo-Zh 添加固定 Standard 配方和 Manifest，另一份调整 Gentoo Java 21 虚拟包的 provider，不新建 overlay。具体应用顺序和 chroot 命令见配置仓库现有 `patchsets/dragonwell-21.0.13/`。跟进安全更新时重新核验官方归档和运行测试；上游有等价方案后再移除对应补丁。

其他没有配方的软件也可以用 Portage 二进制 ebuild 管理版本、依赖、文件与卸载，AppImage 可解包后按同样方式安装。专用兼容库放在程序私有目录，使用该程序的 RPATH 或 wrapper；不把兼容环境加入全局库搜索路径。Flatpak 应用和运行时由 Flatpak 管理，配置仓库只保留主包清单及一键脚本。

FlClash 上游[不计划提供 Flathub 包](https://github.com/chen08209/FlClash/issues/1190)，涉及
Helper、TUN 和系统代理权限。此次复用已有 FDO 运行时、私有 glibc Dragonwell
Standard 21 和测试用托盘库，已显示中文免责声明，JNI 确认只加载私有同版本 JVM。
最初的托盘库暂取自已签名 LocalSend，仅供试验。后续已换成 Debian trixie 的
五个 Ayatana／dbusmenu 小型库包：核验官方公钥、InRelease 三份签名、索引与逐包
SHA256，国内镜像与官方源的元数据一致；只解包库和许可文本，不执行 Debian
安装脚本。约 0.5 MiB 的库已在私有目录完成加载，中文仪表盘正常绘制，不再借用
LocalSend 内部文件。

私有 ELF 解释器／RPATH 路线的灰屏也完成了单文件对照：Flutter 的
`lib/libapp.so` 是 AOT 数据 ELF，没有普通共享库的动态依赖；保持原始字节后
中文界面恢复，改动过的副本仍灰屏。配置仓库的
[`relocate-flclash-elf.py`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/scripts/relocate-flclash-elf.py)
默认只预检，保护 AOT 与 manifest 校验的静态 Core，仅对需要重定位的动态 ELF
设置私有路径。新副本已通过重复应用及中文界面检查；模拟上游 AOT 结构变化时，
脚本在写入前停止。随后已整理为
[现有仓库的补丁组](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/flclash-private-runtime)，
完成正常 Portage 沙箱安装、19 个动态 ELF 的依赖检查，并核对安装后的 AOT 与
原始来源 deb 摘要一致；没有新增 overlay、全局 glibc 或库路径。

私有 glibc Standard 21 现在由同一个 Dragonwell 包的 `glibc-runtime` 开关管理，
宿主仍只有一个 musl 默认 VM。新机无需手建第二个 glibc chroot，额外步骤是用
`install-flatpak-apps.sh --system --flclash-runtime` 准备系统级 FDO 运行时；该脚本
在无系统 DBus 的 chroot 中幂等执行通过。`@musl-private-apps` 用 USE 能力约束
选择适配配方，不锁应用发布版本；当前允许关键词内的 world 预演为零项，未接受
LLVM 23 的关键词扩展建议。

已安装入口在普通用户、只读候选根、独立 HOME／Xvfb／网络中显示中文仪表盘，
显式 JNI 使用已管理的 Standard 21。界面流程本身未加载 JVM，不能扩大为全部
Java 功能验收。原生辅助命令包装已验证恢复调用者环境并加载 musl GIO，避免
把前端的私有模块路径传给经 PATH 启动的桌面命令；真实浏览器和完整输入仍待验证。

源码核对后，原生辅助命令进一步覆盖 `kwriteconfig`、`dbus-send` 和按原始 PATH
查找后端的 `which`，并完成正常沙箱重建。实际 GUI 通过中文文件选择器导入自制
YAML、启动 Core、回环 HTTP 200、写入私有 KIO 代理，以及停用后 ProxyType=0／
监听端口关闭的往返。测试中应用全局混合端口覆盖了 YAML 端口，经实际 GUI 调整
后验证通过；没有接触真实订阅或宿主代理。

独立用户／网络命名空间内的 TUN TCP 报文也实测通过：客户端直接访问测试地址，
TUN 收发计数增加；不可达路由负对照失败，恢复后再次 HTTP 200，宿主路由哈希
不变。这仍是当前内核下的隔离测试，不能扩大为真机 TUN 自动路由或外网验收。

OpenRC 路径按上游实现，不需要另造服务。没有 systemd 时，GUI 通过 Polkit
授权直接 Core，设置 root／请求者组与 4750；只在一次性用户命名空间副本验证了
路径引用及权限检查，实际候选 Core 仍为 0755。SonicDE 的授权代理保留 KDE
兼容名称，与会话 DesktopNames=KDE 匹配；真实登录授权仍需切换后的本机验收。

补丁工具也补上有序组预检：同一仓库用多个 `--patch`，可识别后续补丁已修改前一份
文件的完整状态，重复执行会跳过；第二份不兼容时不会向真实目标写入半组。
FlClash 与 Dragonwell 两组均验证了完整、部分、重复和失败状态，候选根原生
Python 的完整组重复检查也通过。

经用户同意，仅测试配置接受免责声明后，GUI 与静态 Core 的 IPC 连通。另按
[v0.9.3 源码协议](https://github.com/chen08209/FlClash/blob/v0.9.3/core/server.go)，
在只读 musl 根、普通用户、独立网络中验证 Core 初始化、配置、监听和回环 HTTP
代理通过，退出干净，无需新增 GCC／glibc。再以普通宿主用户建立自己的用户／网络
命名空间，仅在其中赋予 NET_ADMIN，TUN 设备创建／回收与回环代理通过，宿主路由
哈希保持不变。后续已补齐上述隔离 TUN TCP 与 GUI 代理启停，仍不代表新内核已启动、
真机自动路由、OpenRC 特权激活或完整桌面集成通过；原订阅、setuid、Polkit 和真实
网络配置均未改动。因此 FlClash 安装已完成，OpenRC 特权链、系统代理和真实 TUN 转发仍在剩余清单中。后续线程可从配置仓库根的 `AGENTS.md` 进入现有实验 README、world 清单和补丁组；本机检查点另记录活动进程、实验根身份与私有日志，避免公开文档变成过时的运行状态记录。

## Java IDE 也统一 Dragonwell Standard 21

新环境不采用 JDK 25 路线。Portage 已显式屏蔽其他 OpenJDK provider 与 Dragonwell 22+，防止后续依赖自动引入不同家族／主版本。宿主仍只有 `dragonwell-bin-21` 一个默认 VM；VSCodium 的 glibc 运行时内，使用同一补丁版本的私有 **Dragonwell Standard 21 glibc 构建**。两种 libc 需要各自二进制，不能把宿主 musl JVM 直接交给 glibc JNI。

当前 Red Hat Java 1.58 要求 JDK 25，设置路径为 21 不能解决其最低要求。本轮改在独立 profile 验证当前维护的 [Oracle Java 扩展](https://github.com/oracle/javavscode/releases/tag/v27.0.0)：扩展版本为 27，不代表 JDK 27，也不捆绑 JDK。它配合 Standard 21 已通过激活、Java 符号与补全、`javac --release 21` 中文编译运行，以及实际 DAP 断点、栈与表达式求值；调试目标明确返回 Alibaba／21。官方两项资产、版本和 SHA256 归入配置仓库现有 `scripts/java21-ide-assets.json`。

这是一条已验证的 Java 21 路线，尚未把真实用户的微软 Java Debug/Test/Project Manager 配置转为新方案，Maven/Gradle/JUnit 和真实项目也未全部验收。旧扩展目录保留；新目标 profile 不启用要求 25 的扩展。后续按扩展支持范围和安全更新复核升级，不把固定版本视为永久 LTS。

## 用户、对话和应用数据先定性

本机用户 UID/GID、附加组、home 路径与服务账户已经盘点；新子卷内已创建匹配数字身份的账户，保留密码散列与全部密码有效期字段，首次登录使用独立 HOME。`@home-musl` 是原 home 的在线预副本，VSCodium／Codex 等仍需停用应用后的最终一致性复制，PostgreSQL 也尚未迁移。隔离环境中看到的 nobody 可能只是 UID 映射，不能作为复制属主的依据。

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

OpenRC 服务只做了静态登记：`elogind → boot`，`dbus`、`NetworkManager`、`soniclogin`、`firewalld`、`sysklogd`、`chronyd → default`，没有实际启动服务。Sonic 登录器自身提供 display-manager；iwd 通过 D-Bus 激活，PipeWire 保持普通用户会话启动。五项内核／引导选择的预演均通过；XanMod 与 virtual/dist-kernel 已在独立实验根安装，签名、CJK 和 initramfs 存储驱动检查通过；通用设备固件、rEFInd 和 shim 已安装；子卷、fstab 与隔离用户已准备，真实引导入口和首次启动尚未验收。

签名内核批次沿用同一 Portage 写锁、候选根身份与锁内即时 world 预演。停止路径经过普通用户合成测试，子进程组确认清空后才接受下一任务；旧进程及挂载干净退出后复用构建镜像，没有重新格式化。先使用公开证书验证旧内核，再限于受限批次读取现有签名材料，目标私钥副本保存在新根 root 私有目录，不进入配置仓库。真实 ESP 未写入。新内核配置与 initramfs 的 NVMe／Btrfs 模块检查通过，新增驱动及固件的 initramfs 更新、通用设备固件、真实启动和回退仍需后续完成。

CUDA 先拆出 Clang device-only 头文件、CCCL 和 libdevice 数据包，配方补丁放入已有 Gentoo-Zh，不新建 overlay。普通用户、无网络／GPU 的变量 `sinf` sm_89 PTX 测试通过，随后正常 Portage 安装及安装后验证也通过；没有把数据包等同于完整 SDK。旧 musl CUDA 程序仍结合静态 cudart 和 gcompat，原生用户态驱动继续单独验收。

随后增加了 Portage 管理的 `dev-util/cuda-sdk-flatpak-13.4.1`：只安装六份官方压缩归档和 `cuda-sdk` 入口，普通用户首次执行时校验并解包到自己的缓存，复用现有 Freedesktop SDK 26.08，不必手工创建 glibc chroot，也不向 musl 主系统安装 GCC。它实际使用 SDK 内已有 GCC 16.2 和原厂 NVCC 13.4，输出为 glibc ELF；编译、链接和运行须全部留在该 SDK 中，不与原生 musl C++ 对象混用。

新机在已准备挂载、网络、Flatpak 和版本补丁的目标 root chroot 中可执行：

```bash
# 位于 dotfiles/gentoo_setting/pc
bash scripts/install-flatpak-apps.sh --system --cuda-sdk
emerge --ask =dev-util/cuda-sdk-flatpak-13.4.1::gentoo-zh
```

主应用清单仍是原来五项；可选开关额外固定 SDK 26.08 和本候选 NVIDIA 620-70-06 扩展，避免 chroot 误用安装介质驱动版本。新机器或驱动升级必须调整该精确版本；不能将它照搬为所有硬件的配置。本轮无桌面 D-Bus 的 chroot 重复安装已通过，使用已有缓存，尚非空缓存下载证明。

登录后，以普通用户在项目目录运行：

```bash
cuda-sdk nvcc --version
cuda-sdk nvcc -std=c++17 -arch=sm_89 --cudart=shared math.cu -o math
cuda-sdk ./math
```

`math.cu` 需自行提供真实测试源文件；CMake 项目同样在 `cuda-sdk cmake`、`cuda-sdk ctest` 中配置、构建和测试。首次准备至少预留 1GiB，缓存默认位于 `~/.cache/cuda-sdk-flatpak/13.4.1`；卸载包不会删除用户缓存。入口默认只开放项目目录和工具缓存、关闭网络，确实需要联网时单次设置 `CUDA_SDK_NETWORK=1`。

已安装入口的 NVCC 编译、CMake／CTest 和 RTX 4060 上 32 个 `sinf` GPU 结果回读通过，最大绝对误差小于 3.73e-8；中文 locale、人民币和上海时区也通过。GPU 仍使用当前宿主已加载的 620.70.06 驱动，不能据此认定新 musl 内核已经启动成功。这只覆盖核心 NVCC／cudart，不涵盖 cuBLAS、cuDNN、RDC、PyTorch 或实际项目。配方、撤回条件和命令集中在仓库的 [CUDA 补丁组](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets/cuda-13.4)。

NVIDIA 620.70.06 现有配方增加了版本限定的 modules-only 分支，沿用 Gentoo 原有模块编译与签名流程，不增加 overlay。真实预演发现 Gentoo-Zh 已有 virtual/linux-sources provider，因此撤回了冗余 provider 补丁。五个开源模块用普通 UID 250 编译、安装阶段签名，匹配 7.2.14-musl-x64v3，并以预期公开证书逐个验证 PKCS#7 签名。另将同版本四个 GSP／ucode 文件作为独立数据包，从官方归档经 Gentoo Manifest 校验后提取，不执行厂商安装器；载荷哈希通过。包含随后核心 SDK 包的最终复核为 1,202 个包、88 个 world 选择，无 GCC/glibc，完整 world 预演零项；尚未加载新模块或验证 PRIME／显示输出。

候选内核已启用动态抢占和 CJK16／32 控制台字库。按本轮选择，候选 `/etc/kernel/cmdline` 已登记 `preempt=full`，仅此一项还不是可启动命令行；须在确定根 UUID／子卷后合并必要参数到新启动入口。当前宿主内核未改变，新根也尚未启动，因此还不能声称 full 已运行生效。XanMod 提供独立 RT 分支，但 RT 主要降低实时调度延迟，不能保证更高编译／CUDA 吞吐或更低能耗；本机这版 NVIDIA 源码还有 RT 拒绝检查。普通动态抢占的 full 不等于 PREEMPT_RT。后续首次启动核对实际模式，再比较帧时间、音频和放电功率，保留原启动入口。[XanMod 官方说明](https://xanmod.org/)、[内核实时机制](https://docs.kernel.org/core-api/real-time/theory.html)、[动态抢占参数](https://docs.kernel.org/admin-guide/kernel-parameters.html)。

启动载荷随后也已补齐：使用官方现有配方安装 linux-firmware 20261019、Intel 微码、rEFInd 0.14.2-r4 和 shim 16.1_p7。rEFInd 的 musl／Clang 修复已在 Gentoo 配方中，无需再维护本地补丁；为了匹配其依赖，gnu-efi 由 4.0.4 调整为 3.0.19。仍使用 Clang 和已有 binutils，没有安装 GCC／glibc。完整 world 预演零项，最终共 1,208 个包、92 项 world 选择。

固件以 zstd 压缩安装，目标内核已启用对应解压支持。Intel 微码保留 split-ucode；关闭固件包各自的 initramfs 安装动作，统一由 dracut 组装。最初的通用镜像不捕获当前宿主根参数，显式包含 NVMe、i915、Wi-Fi／蓝牙、有线网及五个 NVIDIA 模块，省略 nouveau。当时约 173MiB 镜像已解包检查匹配 GSP、Wi-Fi／核显固件；早期归档含当前 CPU `0x000b0671` 的 `0x0137` 微码，当前宿主未在线更新微码。

镜像中两项 NVMe 与五项 NVIDIA 模块实际通过 CMS 验签，10 个 UEFI 载荷（含 Btrfs 驱动、MokManager）通过本机公开证书验证，签名私钥目录未进入镜像。受限实验进程内保留了 dracut 创建五个设备节点时的权限警告；已确认 init 挂载 devtmpfs，内核也启用 DEVTMPFS，尚不能代替实际启动。未放宽宿主权限来隐藏这些警告。

配置与 chroot 重建命令集中在 [实验仓库的新根与回退说明](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)。新机使用自己的签名材料及目标内核版本，不能取安装介质的 `uname -r`。musl 根的 rEFInd 实际位于 `/usr/lib/refind`，不要照搬旧 glibc 脚本的 `/usr/lib64/refind` 路径。

这些操作只写候选根，未运行 `refind-install`，也未修改真实 EFI 或原启动入口。主板／shim 信任链、目标子卷与 fstab、首次启动、显示／PRIME 和回退仍待验收，当前不安排重启切换。


## 新根、子卷和回退

当前实验根曾非特权解压，并为嵌套隔离调整过 Portage 用户与沙箱，只用于实验。正式新根要从已验签 stage3 以正确权限重新建立，恢复正常用户、文件归属和沙箱，再复用审核过的配置与受控构建包。

现在已经另行建立正确权限的全新 stage3 根：核对 63,870 个归档条目的属主、权限与符号链接，并确认 282 个基础包与官方归档一致。没有把旧实验根的文件归属或用户配置直接带过去。

随后在新根中保留默认 `sandbox`、`userpriv`、`usersandbox`、`ipc-sandbox`、`network-sandbox` 和 `pid-sandbox`，从源码安装官方 hello。编译阶段的实际身份是 Portage UID/GID 250:250，安装后运行输出正确，未引入 GCC 或 glibc。这一步证明了全新 stage3 的安装基础；新内核和启动流程仍须继续验收，不能据此把教程标为迁移完成。

从这个全新根再做完整桌面预演，会遇到旧实验根已不再暴露的 GLib → docutils → Pillow → HarfBuzz → GLib 引导循环。候选方案是先临时设置 `dev-python/pillow -truetype`，安装 GLib/HarfBuzz 后移除临时设置，再按最终 USE 重建 Pillow。关闭后完整依赖预演通过，没有计划引入 GCC、glibc、GNU Emacs 或 QtWebEngine；随后已在这个新根实际完成两阶段引导：GLib/HarfBuzz 安装通过，Pillow 已恢复 `truetype`，临时开关删除，默认 Portage 用户和沙箱保留，未引入 GCC。随后完整桌面安装通过，共 926 个包，保留默认 Portage 用户与沙箱，未引入 GCC；图像编辑组件使用上游 SonicDE 配方加补丁组。新内核和真机启动仍待验收，临时配置不能直接作为最终配置发布。

全新根随后也在独立 Xvfb、私有 D-Bus 和隔离用户配置中通过桌面运行检查：窗口管理器、shell 进程及总线接口持续可用，中文欢迎界面与面板正常绘制，PipeWire 进程和兼容套接字检查通过。该测试仍使用软件 QML、关闭合成，没有真实设备与系统总线，不能作为登录管理器、硬件显示、音频播放或 Portal 的验收。新根随后已补齐音量界面，仍由 PipeWire 提供服务端，没有安装独立 PulseAudio daemon；中文 locale、上海时区和系统级微信／VSCodium 主包检查通过。系统级 VSCodium 也在这个新根实际接收到原生 Fcitx/Rime 提交的“你好”并正常退出。Flatpak 此次先复用已校验缓存，再运行安装脚本，不能当作空缓存下载流程已通过；Portal、音视频、所有扩展仍需真实会话验收。针对构建日志提示的 libc++ 面板右键问题，还在私有显示中实际打开右键菜单，窗口管理器与 shell 保持运行，未复现这个操作导致的崩溃；因此本轮没有追加全局 libc++ 重建开关，这不代替其他菜单与长期会话稳定性测试。

另一个要保留的 profile 细节是：Gentoo musl 已屏蔽 `kde-plasma/powerdevil[filecaps]`。SonicDE 的实现包与兼容包要同时采用 `-filecaps`，否则会出现 USE 依赖冲突；这不是因为 stage3 解压权限不足，也不应靠关闭整个 Portage 沙箱解决。

启动准备中还补齐了新根自己的五个仓库副本，固定在已验证版本，profile 不再依赖临时挂载；国内镜像优先与 Gentoo 同步签名检查保留，验收期间暂不自动同步。XanMod/CJKTTY 的内核依赖预演已通过，完整内核和签名仍待实际构建。签名工具会需要 GNU binutils，LLVM 也提供 libgcc ABI 库，这不等于安装 GNU GCC 编译器套件。NVIDIA 的开源 `nvidia-modprobe` 620.70.06 已按固定 Gentoo Manifest 校验官方源码，并在新根用 Clang/musl 构建、运行版本与帮助检查通过；它尚未安装或用于加载模块，不代表完整驱动集成已完成。

候选 Btrfs 布局是在现有文件系统内新增 `@musl`，保留原 `@`、`@home` 和启动项。分区设备节点不能用作 Btrfs 子卷名，也不需要仅为此次迁移重新格式化分区。

实机已建立 `@musl` 与 `@home-musl`：前者从已验收的软件根写时复制，后者是原 home 的在线快照。匹配账户、根 UUID／子卷挂载与 `preempt=full` 参数已落实；1,350 个原生包、Portage 配置和 world 与验收源一致，无原生 GCC／glibc。普通用户离线 chroot 中 Dragonwell Standard 21 与 FlClash 19 个动态 ELF 依赖检查通过，内核／initramfs 哈希匹配，内核公钥验签通过。真实 ESP 已按原教程整理为根目录的 `vmlinuz-7.2.14-musl-x64v3` 与匹配 `initramfs-7.2.14-musl-x64v3.img`；`EFI/Gentoo/musl.conf` 保存独立 musl 菜单，主 rEFInd 配置只追加受管理的排除与 include 块。原内核、活动 EFI 程序、旧根参数、磁盘默认选择记录与固件 BootOrder 保留，Windows 入口保持原样。密钥仍在原 `/etc/kernel/secureboot`，未搬到 ESP；尚未重启，固件菜单及首次启动仍待真机验收。

现有 rEFInd 使用磁盘 `vars/PreviousBoot` 保存默认项，已确认仍指向原内核。移动到共用 ESP 根目录后，不能让新内核直接读取旧的 `refind_linux.conf`。现在使用独立菜单显式指定新根及匹配镜像，并从自动扫描中逐个排除 musl 内核文件；其他旧配置保留。已验证 Gentoo installkernel 的 compat 布局与 postinst 调用接口，并安装版本化的菜单脚本及 hook；它自动发现新版本内核对，不锁死版本，缺失镜像时停止。脚本预演、幂等、新版本发现及原配置保留已通过临时夹具检查；完整真实内核更新仍需后续验收。Secure Boot 当前启用，内核公钥与运行时 MOK 列表中的证书逐字节匹配，实际 ESP 目的端验签通过。这些静态检查不能代替固件启动测试。

首次手动启动时，选择内核名含 `7.2.14-musl-x64v3` 的入口，随后检查：

```sh
uname -r
findmnt -n -o FSROOT /
findmnt -n -o FSROOT /home
printf '%s\n' "$HOME"
portageq envvar ELIBC
```

预期内核为 `7.2.14-musl-x64v3`，根与 home 分别为 `@musl`、`@home-musl`，HOME 指向首次登录专用的隔离目录，ELIBC 为 `musl`。旧 VSCodium／Codex 数据不在这一步验收；出现问题时，从保留的原 Gentoo 入口回到 `@`／`@home`。首启采集器已装入候选根，普通用户离线运行通过；同时准备了隔离 HOME 内的说明与新根接续检查点。离线通过不代表新内核已启动，旧仓库和用户资料的在线预副本也不能直接作为同步来源。

清理前已运行 `eclean-kernel --pretend`，未发现过期内核；`eclean-dist` 和 `eclean-pkg` 预演也报告已清洁。ESP 仅移除了经完整归档并逐项比对一致的 106 项重复备份，实际释放约 2.9MiB，清理当时剩余约 160MiB。随后在保留驱动选择和早期微码的前提下，将通用 initramfs 从约 173.8MiB 缩到约 118.3MiB；五个 NVIDIA 模块、两项 NVMe 模块及四份 GSP 固件与已验收文件哈希一致，Btrfs 为内建，本 CPU 微码保留。OpenRC locale／键盘／字体通过 dracut 的 i18n 映射读取，镜像内中文 locale 与 Unicode 配置已核对。原通用镜像仍有 root 私有备份。

新内核约 13.95MiB，实际小于旧内核的 15.43MiB，原先膨胀主要来自 initramfs 的固件、模块及全量微码。当前 400MiB ESP 剩约 215MiB；保留原系统再放一套同等大小的 musl 镜像后仍约剩 83MiB，高于本轮 64MiB 余量，因此暂不扩容。以后按新内核实际大小重新检查，不能提前删除回退入口。ESP 后紧邻根分区，扩容需另外规划离线操作。新机从 chroot 生成 hostonly 镜像时须提供正确 `/proc`、`/sys`、`/dev` 和 `/run/udev/data`；无法保证硬件元数据正确时先生成通用镜像并复核空间，不直接复用另一台机器的 hostonly 成品。

根复制曾触发保留 20GiB 的空间保护。核验回收未完成暂存，将闲置实验部署、旧内核树和缓存归档到既有独立工作镜像，经完整比对后移除展开副本，空间恢复后才继续。写时复制仍需要目录、inode 和小文件空间，不能按零额外占用估算；这里的 coreutils 要求 `cp --reflink=always` 配合 `--sparse=auto`。已分配元数据块组内部的回收量也不能直接当作 `df` 立即增加的可用量，整理应使用[明确的类型、usage 与 limit 过滤](https://btrfs.readthedocs.io/en/latest/btrfs-balance.html)，不直接执行无过滤的全盘 balance。

本机 musl `chage --help` 没有 `--mindays`。账户脚本须核对实际支持参数，保留原有效期语义；本轮仅兼容已确认等价的零／空最短有效期表示，其他字段与密码散列严格核对，不记录散列内容。home 预副本与停用应用后的最终一致性迁移分开验收，首次登录使用独立 HOME。

2026-11-17 的首启报告已确认：新内核、`@musl`／`@home-musl`、musl、UID 1000、X11 桌面和 i915／NVIDIA 图形模块匹配，随后已回到旧根继续整理。这是第一次实际桌面启动及返回旧系统的证据，合并用户环境后的桌面和完整硬件工作流仍须再次验证。

本次为目标 root/home 另留只读回退快照，再将默认 HOME 恢复为普通的 `/home/<用户>`。root 和普通用户密码由用户在本机分别重设，后续导入不覆盖新密码；doas 从用户提供的策略恢复，并用目标原生 doas 检查语法。约 7.7 万个兼容文件已克隆导入，包括 shell、桌面、壁纸、字体偏好、个人文件及编辑器配置。宿主的旧 glibc 动态程序、编译缓存、虚拟环境和生成物延期重建，保留原始数据及私有延期清单。

用户导出的 `.code-profile` 已解析并导入 Flatpak 的正常 profile：91 项设置、快捷键、任务和可移植 UI 状态保留。56 项扩展中，七项依赖 Java 25 的旧 Java 组合延期，改用此前验证的 Oracle Java 21 扩展，目标目录共 50 项；JVM 继续统一为 Dragonwell Standard 21。FlClash 用户备份也已恢复，备份内 SQLite 检查通过。原始 profile、代理配置、密码与其他凭据不进入公共仓库。

普通 TTY 的 zsh、Neomacs 核心、字体匹配和普通用户离线检查通过，字体选择已恢复到旧用户的 Noto Sans。Codex 在目标软件环境读取当前线程，普通用户宿主控制试验的只读命令执行也通过，没有发送模型请求。嵌套容器的 `/proc` 挂载限制是另一条验收边界；本轮用 `musl-codex-resume` 原生终端作为接续入口，不把静态数据读取当成 Flatpak 中完整工具调用成功。完整 GUI、认证、插件与实际模型调用仍待真机复验。

新根提供旧 home 的只读入口及桌面取文件快捷方式；原系统 fstab、根和数据库保留。随后已在原编辑器正常退出后完成最新对话、编辑器配置及两个仓库的最终同步，核验写入并释放挂载。迁移过滤器和 profile 导入器已放在[现有实验仓库](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)，默认预演、显式写入，不需要新增 overlay。

最终子卷名统一为原教程的 `@`、`@home`。本机优先不使用 LiveCD：先备份并把新旧系统的 fstab、内核命令行和 rEFInd 引用改为已核对的固定子卷 ID，保留当前名称；用户重启确认后，再挂载 Btrfs 顶层整理名称。固定 ID 的启动准备已完成，名称和全部旧数据仍保留，下一次启动尚待验收。按名称引用子卷的备份任务、固化路径的 initramfs 也须核对。旧根内嵌的 srv、历史快照和迁移快照分别审查，旧卷删除单独进行；无法启动时再使用救援环境。这不改变分区 UUID，新机全新安装直接建立 `@`、`@home` 即可。[Btrfs 官方文档](https://btrfs.readthedocs.io/en/latest/btrfs-subvolume.html)说明子卷可以改名，子卷 ID 保持不变。

第一次启动成功后，仍要做多次启动、桌面使用、更新与回退验证。用户配置先隔离，数据按应用清单恢复；旧 glibc 根的删除另行决定，不能把“迁移能启动”当作“旧根可以立即删除”。当前还没有进行这一步切换。

## 参考

- [Gentoo musl 项目](https://wiki.gentoo.org/wiki/Project:Musl)
- [Flatpak 基本概念](https://docs.flatpak.org/en/latest/basic-concepts.html)
- [中科大 Flathub 缓存说明](https://mirrors.ustc.edu.cn/help/flathub.html)
- [Chimera 的 musl/NVIDIA 实验](https://chimera-linux.org/news/2026/11/musl-nvidia.html)
- [NVIDIA PRIME Render Offload 文档](https://download.nvidia.com/XFree86/Linux-x86_64/620.70.06/README/primerenderoffload.html)
- [Neomacs](https://github.com/eval-exec/neomacs)


### 合并 HOME 后的真机复验：字体、CLI 与钱包

2026-11-19 已从合并后的正常 HOME 登录 musl 新根，核对新内核和根／home 子卷。
SonicDE 使用 Intel/Mesa GLX 合成，PipeWire 已枚举内置与 HDMI 声卡；这还不是完整
音视频、PRIME 或休眠验收。FlClash 私有运行库检查与真实前端／Core 启动通过，
窗口短暂重影继续观察。原配置关闭自动运行，打开窗口后还须启动代理，才会监听 7890；
使用外部代理网络时不必执行指向未监听 localhost 的 `proxy`。

系统字体补齐现有仓库的 HarmonyOS Sans，已有 IntoneMono Nerd Font Mono 继续由
Portage 管理；宿主与 Flatpak 的实际字体匹配均已通过。只恢复原来的字体名称不够，
缺少字体时会出现楷体等不合适的回退。新机或 chroot 中可按实验配置登记关键词、
许可证与 Nerd Font 的 `intelonemono` USE，再安装：

```sh
emerge media-fonts/harmonyos-sans media-fonts/nerdfonts
```

字体回退、用户配置修复和原生 CLI 入口在[现有配置仓库](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)
集中维护。`codium`／`vscodium` 调用 Flatpak 并传递 shell 代理，原生 `codex` 复用
扩展携带的静态程序，支持时使用 `--no-daemon`，不关闭沙箱。已有编辑器进程的代理
不会可靠地随第二次 CLI 调用改变，切换后应正常退出再打开。

VSCodium 真正的运行参数文件是 `~/.vscode-oss/argv.json`，其中设置
`"password-store": "gnome-libsecret"`，复用 KWallet 6 的 Secret Service；不是把参数
写到 XDG 的 User 配置旁。钱包解锁后的随机临时项加密保存、读回及删除已通过；
GitHub 登录跨编辑器重启仍待实测。旧钱包密码与新登录密码可能不同，需要本机解锁，
不把令牌改成明文，也不关闭钱包自动锁定。

当时 `/boot` 的 root 专用权限使普通文件管理器无法进入；后续已改为普通用户可读、仅 root 可写，见文末。旧 Doom PATH 注入
已从新用户 shell 移除，原脚本与导入资料保留。缓存、备份卷和旧根按验收门槛分批
处理，不在刚能登录时删除回退路径；PostgreSQL 逻辑迁移也仍是独立任务。

Neomacs 在宿主已安装，命令是 `neomacs`，系统 `eselect editor` 和登录环境均已选中。
新根的 UTF-8 批处理和真实 X11 窗口通过；原用户缺少 `init.el`，因此补一份简单的中文与
字体配置到它实际读取的 `~/.config/emacs/init.el`，不自动加载旧 Doom。文件管理器的
文本关联仍保留 VSCodium；Flatpak 终端内的可执行程序范围与宿主不同，核验时需区分。

复查时，用户启动代理后本地 7890 已监听，经其访问 GitHub 首页和 example.com
均返回 HTTP 200，TLS 校验通过。VSCodium 也已在配置修复后重启；实际日志位于
`$XDG_STATE_HOME/VSCodium`。旧迁移密文有解密错误，用户随后重新授权后，新会话
保存与普通 GitHub 权限查询通过；额外 `read:org` 请求和跨下一次重启的持久性仍需
分别验收，不因此清空账户、关闭加密或自动扩大权限。

用户随后确认基础账户已登录，剩余提示来自 Pull Requests 等扩展的额外组织读取权限。
需要使用这些功能时，在扩展的 GitHub 授权界面检查并自行同意 `read:org`；不退出既有
账户、不清空凭据，也不由安装脚本代替用户扩大 OAuth 权限。


### 同步仓库后的维护复查

后续发现同步后的独立仓库缺少迁移配方补丁，而安装数据库仍保留对应软件，更新预演
因缺失配方及 Qt6.11.2／6.11.3 依赖冲突失败。已准备并验证统一恢复入口：先检查
全部仓库的有序补丁组，再显式写入；已包含则跳过，不兼容即停止。Bun 只需刷新
Manifest 中被上游清理的历史行上下文，不改变归档强哈希；Neomacs 上游已修复资源
路径，跳过对应旧补丁。历史构建基线与当前维护 HEAD 分别记录，不把回退整仓库或
锁死旧版本当作解决方式。

新内核已识别 NVIDIA GPU，但 `/dev/nvidia*` 没有准备齐全。普通用户 CUDA 仍不能
据“模块存在”验收。官方 `nvidia-modprobe` 的小型源码已按 Gentoo Manifest 双强哈希
核验并通过正常 Portage 安装，不额外建立 overlay。首次 OpenRC 准备暴露了组查询及
控制／UVM 节点参数错误，已严格修正配方；节点及真实 GPU 运算仍待修复批次完成。
原内核、EFI、签名材料和旧数据库保持不变。

同时，当前宿主 C++ 与 Rust 的 Clang/mold/ThinLTO 小程序已实际运行通过；托管 SDK
的 NVCC/CMake 编译通过，继续复用 SDK 的 GCC16.2。正式 ClamAV 病毒库的干净样本
与 EICAR 检测通过，临时样本已删除。完整更新、GPU运行、数据库和回退继续分项验收。


本批后续已完成：helper正常沙箱安装、打包QA和OpenRC节点准备通过；新musl内核的
原生私有CUDA/NVML均识别一块GPU，托管NVCC/CMake/CTest通过，32项sinf最大误差
5.96e-8。完整更新预演也已解算出244项一致计划，没有原生GCC/glibc，但本轮不实际
安装这批更新，内核和Qt重建仍须配套工作区及升级验收。

GPU调用后还观察到驱动按早期加载参数恢复节点默认权限。根内新modprobe配置正确，
已加载参数却只读，因此一次 chmod 不是持久解决方案。同内核 musl initramfs 已
更新并发布，约 117.6MiB；解包核验早期权限配置、五个模块、四份 GSP 固件及 Intel
微码通过，原镜像已私有备份。内核、菜单和旧根保持，当前 ESP 约剩 216MiB。尚未
再次重启，须在下一次手动启动后核验 GPU 调用前后节点权限，不卸载正在使用的驱动。
新机 chroot 应在生成最终 initramfs 之前安装 helper。

旧根的 PostgreSQL 18 已只读确认正常关闭，新根尚无真实数据库集群。后续先盘点
原库 locale、对象及外部表空间，再做私有逻辑备份和恢复测试；不把旧 PGDATA 直接
作为 musl 服务的数据目录。数据卷上的旧构建镜像也须确认文件系统与空间后才能复用，
不能因一次挂载失败便判断镜像不存在。


旧库后续已用写时复制副本在无网络、普通 postgres 身份的隔离环境中启动并正常
停止，原控制文件哈希未变。目录报告仅见默认数据库与角色，可连接库的用户表、
视图等关系计数为零，扩展仅 plpgsql。旧排序环境为 libc `zh_CN.UTF-8`、版本 2.43；
自定义函数、大对象与完整服务配置尚未审计，不能将这个结果扩大为“整个集群没有
自定义内容”。原库继续保留，新根正式数据库尚未初始化。


同日缓存清理的 `eclean` 预演触发了 Firefox 旧配方与新 eclass 的兼容错误：旧基线
使用 `llvm-r1` 的适配已经不适合当前继承 `llvm-r2` 的 `rust.eclass`。这次保留了
源码和二进制包缓存，不按缺失或过期提示卸载软件；升级前须移除过期适配并重新
验收。此前 244 项更新预演只代表当时的解算结果。


固定 ID 入口随后已实际启动，用户完成子卷改名：新根为 `@`、home 为 `@home`，
ID 保持不变。fstab 已恢复 baselayout 的默认注释示例，与本机条目隔三行空行，
有效挂载未变。NVIDIA 启动参数及节点的 video 组／0660 权限通过；GPU 调用后的
复查仍单列。旧 PostgreSQL 与 root 自定义资料尚未独立保留，因此尚未删除旧卷与旧引导。


旧根与旧内核随后已完整加密归档，并通过解码、数据流解析和哈希校验，再回收
旧根主体及旧内核文件。历史只读快照使用内核只读克隆保存，核对来源 UUID 后删除
旧引用；新旧 ID 映射留在本机记录。随后旧 home 也完成加密归档与数据流校验，
原卷及其只读挂载入口已回收。经用户明确授权，六份历史快照与旧 musl 安装前
归档已移除，保留最新旧根／home／内核加密恢复归档。根分区占用约25GiB，
可用约47GiB，ESP可用约264MiB；具体数值会随更新变化。当前根和 home 的 ID 保持
265／266，musl 内核、Windows 引导和密钥未改动。归档恢复与实际回退启动尚未
演练，旧 Linux 一键入口已经移除；恢复依赖本机私有凭据和归档，不能只复制旧
fstab 的子卷 ID。空间恢复后，剩余普通软件更新继续串行执行。


### 2026-11-21：普通更新与 GPU 权限收尾

普通软件更新已实际完成，最终 `@world --update --deep --newuse` 与
`@preserved-rebuild` 预演均无待合并项，Qt 6.11.3、SonicDE 6.8.2、Dolphin／Konsole／
Yakuake 26.08.3 已安装。Yakuake 引入的 KWayland 依赖遇到 SonicDE ECM 缺少查找
模块的问题，采用 KDE 上游模块作为该软件构建目录内的回退；系统恢复相应模块时
自动跳过。登录管理器缺少 POSIX 类型头文件的同一补丁也已通过新版重建，改放
包级目录，避免精确版本路径使后续升级漏用。补丁来源和移除条件集中记录在
[现有补丁组索引](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets)，不另建 overlay。

当前启动下，原生私有 CUDA/NVML、托管 CUDA CTest 与数学回读再次通过，GPU 调用
前后节点保持 root:video 0660，模块参数 GID27／mode432 也已核验。Neomacs 中文
批处理、Dragonwell Standard21 选择及上述原生应用版本命令均通过；这不代替重新
登录后的完整桌面、音视频、休眠和实际课程项目验收。内核、引导、NVIDIA及
PostgreSQL未在本轮升级，preempt=full 保持；新系统现有 PostgreSQL 服务的来源与
业务内容仍须单列核验，不再沿用早期“新根尚无集群”的结论。

旧加密归档目录后来被用户移到 Windows 回收站。只读重新完整读取后，旧根、
旧 home 和旧内核三个密文归档的 SHA256 均与此前已校验文件一致，恢复凭据的
私有权限保持；没有恢复或清理回收站中的文件，也没有再次读取密钥内容。恢复
演练仍未进行，不应将回收站位置视作长期备份方案。

本轮独立16GiB构建镜像已卸载回收，根分区占用约25GiB、可用约48GiB，ESP可用
约264MiB。按用户后续要求取消自动关机，机器保持开机。配置及文章已快进同步到两仓库的实验分支，
本地重复备份分支已在保留归档标签后整理；不改 main，也不隐式部署博客。


root 的交互终端也已切换为 Zsh，使用与普通用户相同的 Zim／Powerlevel10k 配置，
但复制成 root 所有的独立文件，历史与认证信息保持各自独立。
[配置脚本](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/scripts/configure-root-zsh.py)
先备份、离线初始化并核验，再更改登录 shell；在已经安装 Zsh、util-linux、shadow
且普通用户模块齐全的 chroot 中也可执行。后续修改普通用户配置时显式重新同步，
不让 root 启动时直接引用普通用户可写的脚本。


编辑器若使用 Flatpak，默认终端可能仍是 SDK 内的 sh。迁移配置现通过包内的
host-spawn 启动宿主机 Zsh，保持本机主题、补全和工具链；在应用专用设置中设为
Linux 默认 profile，不把该路径推广到 Windows／WSL 配置。TTY、作业控制和
Ctrl+C 已实测通过。新建终端即可生效，恢复的旧终端与历史继续保留。

## LLVM 调试器与非 GNU 用户态的边界

LLDB 22.1.8 已通过 Portage 安装，并在原生 musl 上完成最小 C++ 程序的断点、
局部变量、表达式求值、继续运行至退出0以及 Python 绑定检查。首次构建在 mold
链接 LLVM 静态库时失败：LLDB 配方过滤了 LTO，现有 LLVM 静态库却仍含 ThinLTO
对象。修复仅让 `llvm-core/lldb` 使用已有 `linker-lld` 包级环境，全局 mold 不变；
待上游构建方式变化后重新验证这条例外。验收及定向依赖预演通过后，仅移除了
GDB 17.2-r1，没有执行全局 depclean，也不建立不兼容的 `gdb → lldb` 别名。

Gentoo 官方配方的 uutils-coreutils 0.12.0、uutils-findutils 0.11.0、Toybox 0.8.15、
Dash 0.5.13.6 已并行安装，UTF-8 输出、find、Toybox 入口和 POSIX shell 算术的
最小检查通过。uutils 使用 `uu-`／`uutils-` 前缀，Toybox 使用独立入口；
这些检查尚不足以覆盖 GNU 选项、脚本行为和全部构建系统，因此没有替换系统
核心命令或 `/bin/sh`。

登录环境已经选择 LLVM 的归档和二进制工具，但 LLVM 不提供 Bash、GNU make
或所有 autotools 行为的等价替代。`llvm-as` 处理 LLVM IR，不能直接替换系统汇编
步骤，现有 `AS="clang -c"` 保持。GNU-EFI／rEFInd 依赖的 binutils、Portage 的
Bash，以及私有 CUDA SDK／Bun 兼容运行库中的 GNU ABI 组件分别保留。
没有宿主 GCC／glibc 与整机没有任何 GNU 组件是不同的验收标准。

本轮只读查询新系统 PostgreSQL 18.6 的元数据，发现默认三个数据库；postgres 库
的用户关系、自定义函数、大对象计数均为零，保留 ICU 排序规则。查询没有修改
数据库或启动／停止服务；不能据此替代其他数据库逐库审计、旧库完整恢复或
业务数据验收。

### Actions 固定提交存在但编辑器无法解析

本机曾将有效的 `oven-sh/setup-bun` 固定提交标为“repository or version not found”。
核验五种 Actions 的 `action.yml` 均可读取，GitHub CI 的完整构建也通过；扩展日志
实际报告 `api.github.com` 连接超时。Chromium 的 `--proxy-server` 并不会自动配置
扩展语言服务器的原生 Node fetch；仅在另一个终端启用代理，也不会改变已有
VSCodium 实例的环境。

启动器现会在调用 shell 配置 HTTP(S) 代理时，同时为该应用进程启用
[`NODE_USE_ENV_PROXY`](https://nodejs.org/learn/http/enterprise-network-configuration)，
并转发代理环境变量；不写全局代理、不关闭 TLS 校验、不改为浮动 Action tag。
已用编辑器自带 Node 24.21.0 通过代理读取到同一提交的元数据，HTTP200。
应用修复后需完整退出所有 VSCodium 窗口，再从启用代理的 shell 运行 `codium`；
没有强制关闭现有对话，也不能把独立网络探针成功说成旧窗口的误报已经消失。

### 终端最小化后从任务栏消失

Sonic Terminal 26.08.3 的独立实机窗口可复现：最小化后进程仍在，但 `WM_STATE`
被移除，窗口也退出 `_NET_CLIENT_LIST`，因此看起来像退出。此故障来自 QML
主窗口与隐藏 QWidget 兼容窗口之间的状态同步；最小化被错误同步后，兼容窗口
的 Hide 事件又隐藏主窗口。

已定位上游修复 [75ba4c38](https://github.com/Sonic-DE/sonic-terminal/commit/75ba4c38f00ce9d3ba7d13f5951132f6599947da)，
回补完整修复及回归测试源，不改为 live 包或新增 overlay。发布源码已按现有
Manifest 核对大小、BLAKE2B、SHA512，补丁严格应用／撤回及本机正常 Portage 沙箱重建安装均通过。新窗口用 X11 请求
验证正常最小化／恢复、最大化后最小化／恢复，窗口保持受管理、进程存活，最大化
状态保留。未执行整套上游测试。补丁只部署到 26.08.3 的用户补丁目录，新版默认不再应用，等价上游修复
和实机回归通过后即可清理。已有终端任务不强制关闭，验收使用独立新窗口。


### 日常桌面验收与 Doom 配置统一

本次日常试用中，用户确认 Codium 开发、Java Hello World、音视频、WPS／微信、PostgreSQL 和 FlClash TUN 暂无异常。会议共享、休眠、其他 CUDA 数学库及真实归档恢复仍按需要单独验收。Konsole 旧窗口标签栏下的白缝在新独立窗口中没有复现，未再追加渲染补丁。

SonicDE 电源管理补齐官方 power-profiles-daemon 的 OpenRC 服务，验证 performance／balanced／power-saver 可读后加入 default，保持原 balanced 档位。新机先检查 TLP／tuned 等冲突服务，再启用 daemon；不需要重启桌面。NetworkManager 的 limited 则定位为 Fake-IP 与绑定物理网卡的探测不匹配：改用本机验证可达的标准 Microsoft Connect Test 端点并校验正文，重新探测为 full，没有关闭连通性检测、重启 Wi-Fi 或放宽防火墙。通用模板放在配置仓库 PC 服务目录，软件源的国内优先顺序不变。

编辑器最终采用完整 Doom Emacs 框架，由原生 Neomacs 执行；与 Windows 共用 dot_config/doom 中的模块和自有偏好，保留 Evil／SPC、相对行号、缩进、字体与终端背景设置。发行版及插件各账户独立，root 的框架、私有配置与缓存均由 root 自己拥有，不执行普通用户可写的配置。当前 Doom core 将完整模块放在 sources/doom+ 子仓库，Linux 和 Windows 安装脚本都会先初始化 core 记录的模块提交，再同步插件，避免只安装 core 而漏掉模块。

普通用户的完整 sync、正式目录 GUI／TTY 开始页、主题、SPC／Evil 编辑和 Corfu／Vertico／Magit／Org 加载通过；root 的独立 TTY 也通过。doctor 识别33个模块、106个包。Discount 提供 Markdown 编译，官方静态 ShellCheck 提供 Shell 检查，实际运行均通过，未安装 GHC 或 GCC。只保留可选 Symbola 字体提示，现有 Unicode／中文字体回退继续使用。这仍不是全部 Doom 语言模块、原生插件或未来 Neomacs 更新的兼容保证。

测试过的 Spacemacs 按最终选择停用，可重新下载的发行版与可再生缓存已移除，少量可回退配置仅在本机私有目录保留。新机以配置仓库的 deploy-doom.sh 与共享 Doom README 为入口，不再维护另一套 PC 最小 init。VSCodium 的 Oracle Java21、Maven／Gradle／Spring 模板及 Python／Rust 组件另见[跨平台配置文章](/posts/vscodium-sync/vscodium-sync/)；Windows 清单与脚本已同步，实际应用在 Windows 执行验收。

数据盘 上三份旧系统加密归档已重新完成全文件长度与 SHA256 校验，均与原记录一致，未发现需要删除的损坏临时件，因此保留作恢复来源。未解密、恢复数据库或把密码、代理配置、账号状态及原始截图加入公共记录；哈希一致不代替实际恢复演练。


### 登录恢复、透明间隙与启动图标

开机时出现多个终端窗口并非来自新添的自启动脚本：保存的桌面会话中有四个 Konsole 客户端和 FlClash 的 legacy 会话。以桌面用户执行以下命令，改为下次登录启动空会话；不整文件覆盖 ksmserverrc，不删除会话资料，也不关闭当前窗口：

```sh
kwriteconfig6 --file ksmserverrc --group General --key loginMode emptySession
```

终端标签栏下方的细缝实际会漏出壁纸。普通 RGB 截图把透明像素显示为黑色，仅凭“没有白线”不能排除问题。读取 X11 ARGB 后确认整行 alpha=0，原因是隐藏 QTabWidget 的样式间距没有被 QML 标签背景覆盖。最终补丁在窗口坐标中补齐可见窗格上下方的背景与顶部设备像素边缘，覆盖标签行和页眉／容器交界，不给整个终端铺不透明底色。显示／自动隐藏标签栏、顶部／底部与普通／65% 透明终端八组实机回归中，透明横行均消失，终端内部 alpha 保持255／166；另按真实 desktop 启动项打开交互式 Zsh，再新建标签，并验证右键新窗口的等效命令。不能以隔离 profile 或休眠命令正常代替这些实际入口。正常沙箱重建与原有最小化／恢复检查通过，补丁顺序、上游移除条件和验证边界集中在 Sonic Terminal 补丁组。已有进程仍需正常退出后重开；登录恢复策略仍需下一次登录观察。

独立 ESP 无法通过根文件系统的 os-release 推断发行版，手动生成的 Gentoo 菜单原先也没有指定图标，因此使用通用企鹅。本次生成器显式引用 rEFInd 自带 os_gentoo.png，先检查资源，再写入菜单；已验证旧的未标记 include 只归并一次、重复执行不产生重复菜单，并保留根参数和内核／initramfs 字节不变。没有改动签名密钥、BootOrder、Windows 或分区。

Ventoy 官方图标按 GPLv3 原样保存来源与许可，安装为 os_ventoy.png 和 os_vtoyefi.png，交给 rEFInd 原生的卷标匹配与外部介质扫描。其他发行版沿用已有图标；进入菜单后才插入介质可按 Esc 重扫。未知卷标或固件自身提供的启动项不能保证自动识别品牌，不为换图标改名载荷、改 USB 标签或写入介质。相关模板和 chroot 安装命令在配置仓库 kernel/refind-icons，真实启动画面仍待下次开机验收。


2026-11-23 人工复查：用户确认开机体验正常、Windows 配置同步已完成，可选应用日常使用大致正常。相应项目不再列作待完成迁移步骤；反馈不等同于所有 USB 卷标、逐项会议／DRM／休眠场景或长期负载均已测试。旧归档实际恢复演练、完整 CUDA 生态验收仍保持单独记录，博客生产部署仍另行决定。


### 隔离恢复演练与 Python GPU 环境

2026-11-23，先重新核对三份密文归档的完整长度和 SHA256，再在数据盘的新建文件镜像上创建独立 Btrfs。解密凭据仅由本机受限进程使用，旧 root 和 home 实际接收为只读子卷，旧 boot 也实际解包；恢复文件系统的只读 scrub 通过。测试镜像随后正常卸载、解除 loop 并删除，原归档与私有凭据保留。这个结果补齐的是归档可恢复性；没有启动旧系统或恢复出的数据库，也不等于实际回退启动验收。隔离接收目录只向维护进程开放，不能把未知来源的 send 流直接接收到当前根文件系统。[Btrfs receive 文档](https://btrfs.readthedocs.io/en/latest/btrfs-receive.html)。

Python GPU 应用复用已有 Freedesktop SDK 的 glibc Python，通过标准 venv／pip 管理二进制依赖，不往 musl 宿主安装 glibc、GCC 或 CUDA Python 库，也不新增 overlay。核心 NVCC 仍使用独立13.4工具包；PyTorch 使用其 wheel 声明的 CUDA13.0运行库。启动时只移除核心工具包的库目录前缀，保留 Flatpak 的 NVIDIA 驱动路径；直接清空整个库路径会让 libcuda.so.1 无法加载。此处是私有运行环境的兼容方案，不是 PyTorch 原生支持 musl。[PyTorch 安装说明](https://pytorch.org/get-started/locally/)。

系统级 SDK 与 cuda-sdk 数据包在 chroot 安装阶段准备；以下操作在真实桌面登录后，以普通用户、从配置仓库根目录执行：

```sh
# 先审阅依赖图；联网时沿用调用 shell 的 HTTP(S) 代理。
sh gentoo_setting/pc/scripts/cuda-python.sh --setup --dry-run
sh gentoo_setting/pc/scripts/cuda-python.sh --setup
sh gentoo_setting/pc/scripts/cuda-python.sh --check --seconds 600
sh gentoo_setting/pc/scripts/cuda-python.sh --run -c 'import torch; print(torch.cuda.is_available())'
```

默认使用用户 XDG 数据目录中的 gentoo-gpu/.venv；项目可设置绝对路径 CUDA_PYTHON_HOME，以该目录作为受限工作区。安装只接受 wheel；SDK Python 次版本改变时重建环境。运行默认无网络，需要时显式设置 CUDA_SDK_NETWORK=1。不要在 musl shell 直接执行此环境的 Python 或激活它；这部分包由 pip 管理，不能把它们算成 Portage 已安装库。维护入口、兼容边界与补丁移除条件集中在配置仓库的 CUDA 补丁组 README。

实测使用 SDK Python3.14.9、PyTorch2.14.1+cu130、NumPy2.5.4 和 cuDNN9.24。矩阵、FFT、线性求解、卷积、反向传播、稀疏运算、独立 cuRAND 设备输出与 NumPy 回读八项检查通过，pip check 正常；核心 NVCC 的跨翻译单元 RDC 设备链接及32项 GPU 输出也通过。另以1024阶矩阵、每轮50ms间隔执行600秒，共11,774轮，最高46°C、峰值张量分配23.3MiB，确认未混用核心工具包库。这里记录的是有限合成负载，不是满载性能或长期稳定性结论；多 GPU、NCCL／NVSHMEM、GPUDirect、完整数学边界与具体生产模型仍按实际用途验证。版本仅记录本次基线，脚本不锁死后续上游更新，未向 musl 宿主引入 GCC／glibc。


## 报错复盘与维护索引

这里汇总迁移中有复用价值的失败现象。相同错误的重复重试、下载进度、进程号和机器私有路径不逐条复制；原始日志也不直接公开。上文按阶段保留当时的结论，下表给出最后采用的处理方式。某项只有对照证据时，会明确保留这个边界。

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
| sec-keys 包的 gpg-agent IPC 失败 | 深工作目录使 browser socket 超出 Unix socket 路径限制；把临时 GNUPGHOME 缩到包私有构建根。只缩到临时目录仍对较长包名不够 | 保持导入、签名、Manifest 和沙箱校验；不使用个人 keyring |
| 依赖预演拉入 LLVM 新主版本或其他 JVM | 临时预演曾漏掉既定 autounmask 策略；Java 插件又自行捆绑要求 JDK25 | 恢复原策略重新预演；统一 Dragonwell Standard21，Oracle Java 扩展版本号不是 JDK 版本号 |
| NVIDIA helper 安装提示预剥离或手册压缩 QA | 使用上游 Makefile 的 DO_STRIP=、MANPAGE_GZIP= 关闭厂商安装阶段的剥离／压缩，由 Portage 正常安装与处理 | 不用 QA 白名单掩盖警告 |
| NVIDIA 模块已存在但 CUDA 无法打开设备 | 模块加载和设备节点准备是两步，使用已有仓库中的官方小型 nvidia-modprobe helper 及 OpenRC 准备节点 | 检查真实 GPU 调用前后 root:video 0660；不改成所有用户可写。内核／模块／GSP／签名成套升级 |

源码基线、补丁应用顺序和移除条件集中在[配置仓库补丁索引](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc/patchsets)。历史精确版本用于复验，不把所有日常规则锁死在这些版本；已有等效上游修复时跳过，不兼容就停止。

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
| /boot 在 Dolphin 中不可读 | FAT remount 未实际更改权限时正常卸载再挂载；root 所有、目录755／文件644，普通用户可读不可写。更新内核仍需管理员权限，不添加免密码改写规则 |
| 启动图标变成通用企鹅 | 独立 ESP 的手动菜单显式引用 Gentoo 图标；Ventoy 只做已知卷标的原生匹配，未知介质不保证自动识别 |
| PyTorch 下载超时、libcuda.so.1 缺失或找不到 cuRAND | 分别修正本次调用代理、只移除核心工具包库前缀并保留驱动路径、从 wheel 元数据定位新版库目录。八项数学检查及有限负载结果见前节 |

### 编排、空间与校验中的教训

- 深路径、缺失挂载点、缺少 setpriv、临时目录权限、socket／FIFO、测试输出多一个换行，以及错误的 ELF 字段索引，都曾让验证夹具先失败。先确认失败发生在准备、编译、安装还是检查阶段；不因检查脚本退出1就重复已经成功安装的大包。
- Polkit 授权随进程、重启或既定范围结束而失效。核对 PID、启动时间、boot ID、实际子进程与队列；旧 identity／status 文件不证明权限进程还活着。一个根只能有一个 Portage 写入者，正常沙箱与签名检查不因失败关闭。
- 文件镜像也会占用承载分区空间；Btrfs 逻辑 du、共享 extents 和延迟回收不等于立即增加的可用空间。复制曾因 reflink=always 与 sparse=always 组合失败，改用 sparse=auto；触及20GiB底线就停止，不能降低阈值继续。
- 父子卷只读属性曾使旧快照搬移报 EROFS。先检查属性、来源 UUID 与当前挂载，不把只读保护当作普通权限不足去递归 chmod。子卷不是分区，改名不改变分区 UUID；启动参数和 fstab 的固定 subvolid 只能来自本机盘点。
- 国内镜像404、厂商 extra-data 慢或中断属于抓取阶段。临时改路由后仍按已签名元数据校验长度与强哈希，完成后恢复镜像优先级；不把下载完成当作安装完成。退出前要撤销临时 FETCH 设置、卸载镜像并处理自己的进程组。
- GitHub OAuth 不等于原生 Git 已有凭据；SSH 验证成功但返回无 shell 的退出码1也不是认证失败。带全局 prune 设置时，跟踪 main 应使用完整 refs/heads/main 映射和 no-prune，不能误删跟踪引用后以为远端分支消失。
- Gentoo 目录的通用文本属性曾使 PNG 入索引时被换行规范化；追加更具体的 binary 属性，仅重新规范化该资源，比较工作区／索引／安装文件摘要后再提交。不要为了通过检查改写图标或签名载荷。
- Hexo 可选更新通知曾因网络超时打印 ERROR，但正文构建与生成检查已退出0；应按每一步的真实状态判断，并为本次调用提供代理，不关闭 TLS。远端 Pages 构建成功与生产部署成功也不是同一件事。

## 迁移收口与新线程接续

本机已完成 musl 真机启动、普通更新、配置与用户资料合并；Windows 配置同步和日常应用已由用户确认。旧归档实际恢复与只读 scrub 已通过。用户最终明确决定把旧恢复资料、旧配置备份与已审定残留一并退役，不再安排旧系统回退启动；这不是声称旧系统启动已经验证。

签名密钥、当前账户与钱包、数据库、Doom／Zsh 正式配置、现用内核／initramfs／EFI 程序以及 CUDA Python 环境不属于旧缓存。历史测试日志只保留已提炼的现象、原因与验收边界；不公开密码、令牌、订阅、网络配置、原始截图或个人文件名。模板中的用户名是匿名身份，真实账户由目标机器确定；设备取自 findmnt／lsblk，不能跨机复制本文的历史子卷 ID 或磁盘编号。

后续新线程从配置仓库的 AGENTS.md、gentoo_setting/pc/README.md 开始，再按任务读 world-migration.tsv、repository-baseline.tsv 和对应补丁组。私有历史实验目录不再是安装前提，也没有长期存在的实验根或授权进程。先在目标机器检查：

```sh
uname -r
findmnt -no FSTYPE,FSROOT,OPTIONS --mountpoint /
findmnt -no FSTYPE,FSROOT,OPTIONS --mountpoint /home
findmnt -no FSTYPE,OPTIONS --mountpoint /boot
eselect java-vm show system
# 在配置仓库根目录运行，仅校验，不写配置。
sh gentoo_setting/scripts/verify.sh pc
```

需要更新时再预演 world／preserved-rebuild，先恢复并预检仓库补丁，不直接复用旧安装命令、固定版本和私有路径。持续生产 CUDA、特殊显示／休眠、多 GPU 和 GPUDirect 按实际业务单独验收；没有这些需求不继续扩大迁移范围。博客只有在正文、隐私、构建与远端检查通过后，才按用户明确授权手工部署。

本次清理先做固定路径、文件身份、挂载与活进程检查。整目录清理曾被自动审批拒绝，因为目录内可能含仍需保留的配置或密钥；用户对旧配置、专用恢复凭据和 ESP 遗留进一步明确授权后，改为逐文件计划。预检又拦住旧构建缓存中5个 GnuPG socket，确认全部网络命名空间中无活动引用后，只移除这几枚过时节点，不处理个人 keyring。最终清理27个审定目标，三份旧密文及其专用恢复凭据、旧配置备份、旧编辑器副本和历史测试／构建缓存已删除。ESP 的旧 GRUB 碎片与过时菜单备份也已移除，现用 EFI／内核／initramfs 前后摘要相同；当前账户、钱包、数据库、签名密钥和运行库保持。

清理后数据盘可用约453GiB、系统分区约43GiB，实际数值会随使用改变；Btrfs 共享与延迟回收使它不等于各目录 du 的相加。CUDA 和显式加载的 Doom 引导／CLI 复查通过。旧系统归档已不能再作为恢复来源，后续日常数据备份另行管理。

隐私复查覆盖本次正文、配置与可达文本历史：没有检出实际私钥或令牌；第三方前端的 API 密钥占位提示不是用户凭据，不改写其原始资源。真实用户名、路径、个性化卷标和设备号不进入新机默认值，原有匿名模板身份保留；一份已删除旧指南中的本机家目录及相关历史文本也已匿名化，其他内容、日期、提交说明与他人署名保持；本人可确认的个人邮箱署名改用公开的 GitHub noreply 身份。历史改写不撤销外部已有克隆；若将来发现真实凭据泄露，应先撤销或轮换，而不能只改提交。

由于隐私匿名化改写了 main 的历史，其他机器（包括 Windows）的旧克隆不能再按普通快进更新。先保存本地文件改动和未推送提交，优先在新目录重新克隆 main，再迁入确实要保留的自有变化。不要直接合并新旧两套历史，也不要重置尚未保存的工作；Windows 插件与用户数据不会因远端历史改写自动迁移或删除。
