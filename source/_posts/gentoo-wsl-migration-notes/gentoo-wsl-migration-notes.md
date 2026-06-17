---
title: Gentoo 真机与 WSL 迁移踩坑记录
comments: true
toc: true
donate: true
share: true
date: 2026-06-04 17:07:55
categories: 实用技巧
tags:
- 技巧
- ai
---
本文章由 ChatGPT 协助整理和写作，主要记录最近一次从 Gentoo 真机环境转向 Gentoo WSL 环境时遇到的一些问题和解决思路。

这次折腾大概可以概括为：

```text
原计划：
Windows + Gentoo 真机双系统
Gentoo 使用 OpenRC / LLVM / XLibre / SonicDE / NVIDIA / Secure Boot

后来调整：
Windows 作为唯一主系统
Linux 相关工作迁移到 WSL
Gentoo WSL 主要作为开发环境
```

因为手头只有一台笔记本，如果真机 Linux 的 GRUB、Secure Boot、NVIDIA、桌面环境一起出问题，排错成本会比较高。所以最后选择了更务实的路线： **保留 Windows，Linux 工作尽量放到 WSL 中完成** 。

注意，因本人偏好使用***doas***，如果使用sudo，请在实际使用时替换为**sudo**执行.

## 最初的 Gentoo 真机路线

最开始的目标是继续维护一套比较完整的 Gentoo 真机桌面环境：

```text
OpenRC
LLVM / clang
amd64
XLibre
SonicDE / KDE
NVIDIA
xanmod-kernel
Secure Boot
```

这条路线本身不是不能走，但变量比较多。尤其是 Secure Boot、NVIDIA、xanmod-kernel、SonicDE overlay、LLVM profile 同时存在时，一个小问题容易牵出一串依赖和配置问题。

### xanmod-kernel 与 Secure Boot

一开始 `xanmod-kernel` 编译失败，最初看起来像是内核包本身的问题，但后来发现主要是 Secure Boot 和模块签名配置不完整。

当时涉及到类似这些变量：

```bash
MODULES_SIGN_KEY="/etc/kernel/secureboot/MOK.pem"
MODULES_SIGN_CERT="/etc/kernel/secureboot/MOK.pem"

SECUREBOOT_SIGN_KEY="/etc/kernel/secureboot/MOK.pem"
SECUREBOOT_SIGN_CERT="/etc/kernel/secureboot/MOK.pem"
```

这里要注意：

```text
MOK.pem 适合用于签名
MOK.cer / MOK.der 适合用于导入 MOK
```

如果只有 `MOK.pem`，可以导出证书：

```bash
doas openssl x509 \
  -in /etc/kernel/secureboot/MOK.pem \
  -outform DER \
  -out /etc/kernel/secureboot/MOK.cer
```

然后导入：

```bash
doas mokutil --import /etc/kernel/secureboot/MOK.cer
```

实际使用中，我更倾向把 Secure Boot 相关文件统一放在：

```text
/etc/kernel/secureboot
```

比如：

```text
/etc/kernel/secureboot/MOK.pem
/etc/kernel/secureboot/MOK.cer
/etc/kernel/secureboot/generate_mok.sh
/etc/kernel/secureboot/import_mok.sh
/etc/kernel/secureboot/sign_grub.sh
```

这样比放在 `/root/secureboot` 更方便长期维护。

### chroot 中安装内核的问题

后来 xanmod 编译通过后，又卡在内核安装阶段。`installkernel` 调用 `dracut` 时发现当前在 chroot 环境里，但是没有合适的 kernel cmdline。

这类错误一般会提示：

```text
Chroot detected
Dracut will be run from inside a chroot but no cmdline was configured
```

解决思路是给 `/etc/cmdline` 写入正确的根分区参数。比如 btrfs 子卷是 `@` 时：

```bash
echo 'root=UUID=你的根分区UUID rootfstype=btrfs rootflags=subvol=@ rw' \
  | doas tee /etc/cmdline
```

然后重新执行：

```bash
doas emerge --config '=sys-kernel/xanmod-kernel-7.0.6:7.0.6'
```

这个坑说明，Gentoo 的 dist-kernel / installkernel 体系虽然方便，但在 chroot、Secure Boot、dracut、独立 `/boot` 混合时，需要提前把路径和启动参数都准备好。

## SonicDE / XLibre 的依赖问题

SonicDE overlay 目前还在发展中，安装时遇到了几个比较典型的问题。

### elogind 与 systemd 互斥

`sonic-meta` 有类似这样的 REQUIRED_USE：

```text
exactly-one-of ( elogind systemd )
firewall? ( systemd )
```

这意味着：

```text
OpenRC 用户应选择 elogind
不要同时开启 systemd
如果开启 firewall，则会要求 systemd
```

所以 OpenRC 路线比较适合：

```bash
kde-plasma/sonic-meta elogind -systemd -firewall
```

如果不关 `firewall`，Portage 会继续要求 `systemd`，这和 OpenRC 桌面环境不太一致。

### 9999 live 包带来的依赖链

另一个问题是 SonicDE overlay 中部分包会拉到 `9999` live ebuild，例如：

```text
sonic-workspace-9999
plasma-workspace-9999
libkscreen-9999
```

如果 overlay 中没有对应的 `libkscreen-9999`，依赖解析就会失败。

我的处理方式是：

```text
SonicDE 核心包尽量固定 6.6.5
避免全局接受 */*::sonicde **
只对必要的主题包单独放行 9999
```

比如 `silver-sddm` 只有 live 版本时，可以单独接受：

```bash
=x11-misc/silver-sddm-9999::sonicde **
```

但不建议直接写：

```bash
*/*::sonicde **
```

这样容易把整套 live Plasma 栈拉进来。

## LLVM / clang 环境中的旧 C++ 包问题

在 LLVM / clang 环境下，部分旧软件包会暴露出新的 C++ 标准兼容问题。

### dev-libs/darts

`dev-libs/darts` 编译时出现：

```text
error: no member named 'random_shuffle' in namespace 'std'
```

原因是源码仍使用旧的 `std::random_shuffle`。在较新的 C++ 标准里，这个接口已经不再适合继续使用。

临时处理方式是给它单独使用 GCC 和 C++14：

```bash
doas mkdir -p /etc/portage/env /etc/portage/package.env

cat <<'EOF' | doas tee /etc/portage/env/gcc-cxx14.conf
CC="gcc"
CXX="g++"
CXXFLAGS="${CXXFLAGS} -std=gnu++14"
EOF

cat <<'EOF' | doas tee /etc/portage/package.env/darts
dev-libs/darts gcc-cxx14.conf
EOF
```

然后重新编译：

```bash
doas emerge -av1 dev-libs/darts
```

### app-text/doxygen

`doxygen` 的问题更复杂一些。一开始是 clang / libc++ 环境下 VHDL parser 相关代码编译失败，后来改用 GCC 后，又因为 `doxygen[clang]` 仍然开启，继续链接 LLVM/libclang，导致 ABI 问题。

最后的思路是：

```text
doxygen 本体用 GCC 编译
关闭 doxygen[clang]
必要时用本地 profile mask 禁止它重新打开 clang USE
```

配置类似：

```bash
doas mkdir -p /etc/portage/env /etc/portage/package.env /etc/portage/package.use /etc/portage/profile

cat <<'EOF' | doas tee /etc/portage/env/gcc.conf
CC="gcc"
CXX="g++"
EOF

cat <<'EOF' | doas tee /etc/portage/package.env/doxygen
app-text/doxygen gcc.conf
EOF

cat <<'EOF' | doas tee /etc/portage/package.use/doxygen
app-text/doxygen -clang
EOF

cat <<'EOF' | doas tee -a /etc/portage/profile/package.use.mask
app-text/doxygen clang
EOF
```

这个问题提醒我：
**切换 CC/CXX 和关闭 USE=clang 是两回事。**

```text
CC=gcc CXX=g++ 只是换编译器
USE=clang 决定包是否启用 libclang 支持
```

## GRUB 启动 Windows 卡死

后来还遇到一个比较现实的问题：GRUB 菜单里选择 Windows Boot Manager 后卡死。

手动在 GRUB 命令行中执行：

```grub
set root=(hd1,gpt1)
chainloader /efi/Microsoft/Boot/bootmgfw.efi
boot
```

可以找到 Windows Boot Manager，但 `boot` 之后仍然卡住。

这说明：

```text
GRUB 已经找到了 bootmgfw.efi
问题不一定是路径错误
更可能是 chainload / Secure Boot / 图形模式切换问题
```

考虑到这台笔记本只有一台，且 Windows 仍然是日常主系统，最后我的想法是：

```text
不要强求从 GRUB 启动 Windows
Linux 用 GRUB
Windows 直接走 UEFI Boot Menu
```

如果以后完全切回 Windows 主系统，则可以进一步减少 GRUB、shim、MOK 这类变量。

## 转向 Gentoo WSL

后来我开始考虑更务实的方案：

```text
只保留 Windows 系统
Linux 工作迁移到 WSL
Gentoo WSL 作为开发环境
```

WSL 中的 Gentoo 不需要处理：

```text
GRUB
Secure Boot
NVIDIA kernel module
真实 Linux 内核
SDDM
完整桌面环境
```

这会少很多系统层维护成本。

### 导入 Gentoo WSL 到指定目录

如果有 `gentoo.wsl` 或 rootfs tar 文件，可以用：

```powershell
wsl --shutdown

New-Item -ItemType Directory -Force "D:\WSL\Gentoo"

wsl --import Gentoo "D:\WSL\Gentoo" "D:\Downloads\gentoo.wsl" --version 2
```

查看：

```powershell
wsl -l -v
```

启动：

```powershell
wsl -d Gentoo
```

### profile 选择

在 WSL 中，我最后更倾向选择：

```text
default/linux/amd64/23.0
```

也就是：

```bash
doas eselect profile set 1
```

理由比较简单：

```text
stable
OpenRC 默认
保留 multilib 可能性
不带 desktop/plasma/gnome
不带 systemd
不走 llvm experimental profile
```

WSL 的目标不是再装一套完整 Gentoo 桌面，而是作为开发环境使用。

## Gentoo WSL 中的 Portage / Python 迁移问题

Gentoo WSL stage4 初始环境里，Python 包图可能还停留在 `python3_13`，而当前 profile / Portage 解析已经倾向 `python3_14`。这会导致很多 Python 包出现 slot conflict。

比如：

```text
dev-python/setuptools
dev-python/packaging
dev-python/wheel
dev-python/setuptools-scm
dev-python/vcs-versioning
```

这类包可能同时出现：

```text
已安装实例：python3_13
计划重装实例：python3_14
```

### Portage 半升级问题

有一次 `sys-apps/portage` 更新时出现半升级状态，日志里有：

```text
ModuleNotFoundError: No module named 'portage.dbapi._SyncfsProcess'
```

当时的现象大概是：

```text
新 Portage 的 python3.14 文件已经部分安装
旧 Portage 的 python3.13 进程还在参与卸载
结果中途崩溃
```

修复思路是不要继续 `--resume`，而是先清理队列：

```bash
doas emaint --fix cleanresume || true
```

然后尝试用已经安装进去的 Python 3.14 wrapper 重新安装 Portage：

```bash
doas /usr/lib/python-exec/python3.14/emerge -av1 sys-apps/portage
```

如果依赖解析仍然卡住，可以救援式：

```bash
doas /usr/lib/python-exec/python3.14/emerge -av1 --nodeps sys-apps/portage
```

成功后再检查：

```bash
emerge --version

python3.14 - <<'PY'
import portage
import portage.dbapi._SyncfsProcess
print("Portage OK:", portage.VERSION)
PY
```

### 不要一开始就安装完整 world_packages

我一开始尝试直接：

```bash
emerge -ajvuDN $(cat world_packages.txt)
```

但这会把很多重型包一起拉进来，比如：

```text
nvidia-cuda-toolkit
openjdk-bin
postgresql
typst
pixi
yazi
noto-cjk
nerdfonts
vulkan-tools
```

对于刚迁移完的 WSL Gentoo 来说，这个依赖图太大，很容易把 Python target、license、overlay、LLVM 一起搅进去。

更稳的做法是先准备一个基础包列表：

```bash
cat > world_packages_base.txt <<'EOF'
dev-vcs/git
app-portage/eix
app-eselect/eselect-repository
app-portage/gentoolkit
sys-process/btop
sys-apps/fd
sys-apps/ripgrep
app-shells/zsh
app-admin/doas
app-crypt/gnupg
EOF
```

然后先装基础包：

```bash
doas emerge -avuDN --with-bdeps=y --backtrack=100 $(cat world_packages_base.txt)
```

确认系统基础稳定后，再分批安装：

```text
Emacs / Doom
Rust / uv / pixi
Typst
PostgreSQL
Java
字体
yazi
```

这样排错会轻松很多。

## eix-sync 与 /var/cache/eix 权限问题

在 Gentoo WSL 初始环境里安装好 `eix` 后，我一开始直接尝试：

```bash
doas eix-sync && doas emerge -ajvuDN @world
```

结果 `eix` 在写缓存数据库时失败：

```text
Writing database file /var/cache/eix/portage.eix...
cannot open database file /var/cache/eix/portage.eix for writing (mode = 'wb')
```

继续看前面的日志还能发现另一个信号：

```text
cannot open /var/db/repos/gentoo/profiles/categories: 没有那个文件或目录
```

所以这里不是单纯的 `eix` 数据库损坏，而是两个问题叠在了一起：

```text
Portage tree 还没有同步完整
/var/cache/eix 目录权限不适合写入
```

这种情况下不要急着反复跑 `eix-sync`，先把 Portage 主仓库同步下来：

```bash
doas emerge --sync
```

同步完成后，`gentoo`、`guru`、`gentoo-zh`、`xlibre` 等仓库目录都能正常出现在 `/var/db/repos` 中。此时再执行 `eix-update`，仓库内容已经可以读取，但如果仍然停在：

```text
Writing database file /var/cache/eix/portage.eix...
cannot open database file /var/cache/eix/portage.eix for writing (mode = 'wb')
```

剩下就是 `/var/cache/eix` 的写权限问题。我的处理方式是把 eix 缓存目录交给 `portage` 用户和组管理：

```bash
doas install -d -o portage -g portage -m 0775 /var/cache/eix
doas rm -f /var/cache/eix/portage.eix
doas eix-update
```

修复后可以看到类似输出：

```text
Writing database file /var/cache/eix/portage.eix...
Database contains 21922 packages in 183 categories
```

然后测试搜索：

```bash
eix git
```

可以正常返回包信息。

这个坑的经验是，`eix-update` 报 `cannot open database file for writing` 时，不要只盯着 eix 本身。更稳的排查顺序是：

```text
/var/db/repos/gentoo 是否已经同步完整
/var/cache/eix 目录是否存在
/var/cache/eix 是否允许 portage/eix 写入
```

因此，WSL 初期配置 Gentoo 时，我更倾向先分步执行：

```bash
doas emerge --sync
doas eix-update
doas emerge -ajvuDN @world
```

而不是一开始就直接把 `eix-sync` 和 world 更新串起来。分步执行更容易判断到底是 sync、eix 缓存，还是 world 依赖解析出了问题。

简单来说，这次不是 `eix` 数据库内容坏了，而是 Gentoo WSL 初始环境里 `/var/db/repos` 尚未同步完整，同时 `/var/cache/eix` 权限不适合写入。先同步主仓库，再修正 eix 缓存目录权限即可。

## WSL 中的 CUDA 思路

一开始我把 `dev-util/nvidia-cuda-toolkit` 放进了 Gentoo WSL 的 world 列表里，后来发现这不是很合适。

在 WSL 中，CUDA 更适合这样理解：

```text
Windows 侧：
安装 NVIDIA 驱动，负责 GPU 和 CUDA driver

WSL 侧：
通过 WSL2 暴露的接口访问 GPU

Python 项目：
使用 pip / uv / conda 安装带 CUDA runtime 的 PyTorch / TensorFlow wheel
```

所以 WSL 里不建议一开始就装：

```bash
dev-util/nvidia-cuda-toolkit
x11-drivers/nvidia-drivers
```

测试 GPU 可以先用：

```bash
/usr/lib/wsl/lib/nvidia-smi
```

也可以加入 PATH：

```bash
echo 'export PATH="/usr/lib/wsl/lib:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

然后：

```bash
nvidia-smi
```

如果是 PyTorch，可以使用虚拟环境测试：

```bash
python3 -m venv ~/venvs/torch
source ~/venvs/torch/bin/activate

pip install -U pip
pip install torch torchvision torchaudio
```

测试：

```bash
python - <<'PY'
import torch
print("cuda available:", torch.cuda.is_available())
print("device:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none")
print("torch cuda:", torch.version.cuda)
PY
```

只有当需要 `nvcc` 编译 CUDA C/C++ 程序时，才考虑在 WSL 里安装 CUDA Toolkit。

## PyCharm 连接 Gentoo WSL 失败

后来 PyCharm 连接 Gentoo WSL 时，RemoteDev 部署可以开始，但后端启动失败。

日志里关键错误是：

```text
Failed to initialize graphics environment
libawt_wlawt.so: libxkbcommon.so.0: cannot open shared object file
```

这说明 JetBrains Runtime 缺少运行库。

先安装：

```bash
doas emerge -av x11-libs/libxkbcommon
```

如果还缺其他库，可以检查：

```bash
ldd /home/kl/.cache/JetBrains/RemoteDev/dist/*/jbr/lib/libawt_wlawt.so | grep "not found"
```

也可以一次性补一些常用运行库：

```bash
doas emerge -av \
  x11-libs/libxkbcommon \
  x11-libs/libX11 \
  x11-libs/libXext \
  x11-libs/libXi \
  x11-libs/libXrender \
  x11-libs/libXtst \
  x11-libs/libxcb \
  dev-libs/wayland \
  media-libs/fontconfig \
  media-libs/freetype
```

然后清理 JetBrains RemoteDev 缓存：

```bash
rm -rf ~/.cache/JetBrains/RemoteDev
rm -rf ~/.cache/JetBrains/RemoteDev-PY
```

再从 Windows 侧重新连接。

## Doom Emacs 配置没有自动加载

安装 Emacs 后，Doom Emacs 配置没有自动加载。检查后发现：

```bash
ls -ld ~/.emacs.d ~/.config/emacs ~/.doom.d ~/.config/doom 2>/dev/null

emacs --batch --eval '(message "user-emacs-directory=%s" user-emacs-directory)'
```

输出显示：

```text
user-emacs-directory=~/.emacs.d/
```

但 Doom 本体实际在：

```text
~/.config/emacs
```

所以 Emacs 启动时读的是 `~/.emacs.d`，而不是 Doom。

处理方式是备份旧目录，然后软链接：

```bash
mv ~/.emacs.d ~/.emacs.d.bak
ln -s ~/.config/emacs ~/.emacs.d
```

然后：

```bash
~/.config/emacs/bin/doom sync
emacs --debug-init
```

最终目录可以整理成：

```text
~/.emacs.d      -> ~/.config/emacs
~/.config/emacs Doom 本体
~/.config/doom  Doom 私人配置
```

## 一些配置整理思路

这次我把配置分成了两组：

```text
laptop/
wsl/
```

其中：

```text
laptop：
保留真机 Gentoo 思路
包括 OpenRC、LLVM、NVIDIA、Secure Boot、xanmod、XLibre、SonicDE

wsl：
只保留开发环境思路
不维护内核、GRUB、Secure Boot、NVIDIA 驱动、SDDM、完整桌面
```

文件名方面，我更倾向不用数字编号，例如不再写：

```text
00-base
10-devtools
20-python
```

而是直接按名字找：

```text
base
devtools
python_compat
problem_fixes
wsl_runtime
secureboot_kernel
sonicde
graphics_nvidia
```

这样日后排错时更直观。

## 小结

这次折腾之后，我感觉最大的经验是：

```text
真机 Gentoo 适合完整控制系统
WSL Gentoo 适合作为开发环境
二者不应该使用同一套配置思路
```

真机 Gentoo 可以折腾：

```text
内核
GRUB
Secure Boot
NVIDIA 驱动
桌面环境
OpenRC 服务
```

但 WSL Gentoo 更适合保持简单：

```text
Portage
开发工具
Git / GPG / SSH
Python / uv / pixi
Rust
Emacs / PyCharm / VSCode
少量 GUI 运行库
```

这次最后的取舍是：

```text
Windows 作为唯一主系统
Gentoo WSL 作为主要 Linux 开发环境
真机 Gentoo 配置保留为备份和参考
```

这样并不是放弃 Linux，而是把 Linux 从“整机系统维护”调整为“更稳定的开发工具”。对于只有一台主力笔记本的情况，这个选择更务实，也能减少很多因为启动项、显卡驱动、Secure Boot、桌面环境带来的额外风险。

如果以后还要继续折腾真机 Gentoo，可以单独准备一台备用机器，或者至少保证 Windows Boot Manager 不受影响。否则，WSL 这条路线目前更适合学习、课程、毕设和日常开发。
