---
title: FreeBSD KDE 桌面黑屏与 Xorg / XLibre 调试记录
comments: true
toc: true
donate: true
share: true
date: 2026-05-17 04:29:19
categories: 实用技巧
tags:
- 技巧
- ai
---
本文章由ChatGpt协助整理和写作，简单记录一次在 FreeBSD 上安装 KDE Plasma 桌面时遇到的 Xorg / XLibre / SDDM 黑屏问题，以及最后的解决思路。

## 最初的问题：XLibre 与 Xorg 包冲突

最开始尝试安装 KDE 桌面时，执行了类似下面的命令：

```bash
pkg install xlibre kde sddm webcamd noto
```

这里的原因比较直接：

* `xorg-server` 是传统 Xorg 显示服务器
* `xlibre-server` 是 XLibre 显示服务器
* 二者都提供 X11 显示服务，不能同时安装
* 输入驱动 `xf86-input-libinput` 和 `xlibre-xf86-input-libinput` 也互相冲突

需要注意的是，这不一定代表系统里已经安装了传统 Xorg。
有时只是 pkg 在解析依赖时，同时计划安装 Xorg 和 XLibre，最后导致依赖求解失败。

也就是说：

```text
kde meta package 可能会拉取传统 Xorg
手动指定 xlibre 又会拉取 XLibre
两套 X server 互相冲突
```

因此在 FreeBSD 桌面初装阶段，建议先不要同时混用 Xorg 和 XLibre。
为了减少变量，可以先使用传统 Xorg 路线，把 KDE 桌面跑起来后再考虑替换。

### SDDM 可以显示，但登录后黑屏

后来切换到 XLibre 后，SDDM 登录界面可以正常出现，也可以输入密码登录，但是登录后出现黑屏，只剩鼠标。

这种现象说明：

```text
SDDM 本身已经可以启动
密码认证大概率没有问题
图形会话也可能已经进入
但 KDE Plasma 桌面没有正常显示
```

进一步查看日志后，发现关键问题是：

```text
open /dev/dri/card0: No such file or directory
scfb(0): Using default device
```

这说明 Intel 核显的 DRM/KMS 驱动没有正确加载，系统没有生成正常的显卡设备：

```text
/dev/dri/card0
/dev/dri/renderD128
```

在这种情况下，Xorg 或 XLibre 只能退回到 `scfb` 帧缓冲驱动。

`scfb` 可以显示很基础的画面，例如 SDDM 登录界面，但 KDE Plasma / KWin 对图形环境要求更高，所以很容易出现登录后黑屏。

因此，当时真正的问题不是：

```text
KDE 密码错误
SDDM 完全坏掉
XLibre 完全不能用
```

而是：

```text
Intel KMS/DRM 没有起来，导致 KDE 无法在正常图形加速环境下运行
```

### 安装并加载 Intel KMS/DRM 驱动

如果机器使用 Intel 核显，可以安装以下包：

```bash
pkg install drm-kmod gpu-firmware-intel-kmod
```

然后设置开机加载 Intel KMS 驱动：

```bash
sysrc kld_list+=i915kms
```

也可以手动测试加载：

```bash
kldload i915kms
```

检查是否成功：

```bash
kldstat | grep -E "i915|drm"
ls /dev/dri
dmesg | grep -iE "i915|drm|firmware"
```

理想情况下，`/dev/dri` 下应该能看到类似：

```text
card0
renderD128
```

如果 `/dev/dri/card0` 出现，说明显卡 KMS/DRM 已经基本正常。

## 切回传统 Xorg 路线

由于初装阶段 XLibre 变量较多，为了先让桌面成功启动，最后选择先回到传统 Xorg 路线。

先停止 SDDM：

```bash
service sddm stop
```

删除 XLibre 相关包：

```bash
pkg delete xlibre xlibre-server xlibre-xf86-input-libinput
```

如果提示某些包不存在，一般可以忽略。

然后安装传统 Xorg、KDE、SDDM 和常用字体：

```bash
pkg install xorg-server xf86-input-libinput xorg kde sddm dbus noto
```

启用必要服务：

```bash
sysrc dbus_enable=YES
sysrc sddm_enable=YES
sysrc kld_list+=i915kms
```

将普通用户加入 `video` 组。这里以用户名 `cyb` 为例：

```bash
pw groupmod video -m cyb
```

如果需要，也可以加入其他常用组：

```bash
pw groupmod wheel -m cyb
pw groupmod operator -m cyb
```

然后重启：

```bash
reboot
```

在 SDDM 登录界面中，建议优先选择：

```text
Plasma X11
```

暂时不要先选择 Wayland。
在 FreeBSD 上，尤其是桌面刚装好的时候，X11 通常比 Wayland 更容易排错。

### 进入会话后仍然黑屏：Plasma bash 没有正常启动

在 KMS/DRM 修复后，系统已经可以进入图形会话，但是仍然出现黑屏。
这时可以通过快捷键尝试打开运行框：

```text
Alt + Space
```

或者：

```text
Alt + F2
```

如果能打开运行框，可以输入：

```bash
konsole
```

如果 Konsole 能打开，说明：

```text
X server 正常
SDDM 登录成功
用户图形会话已经进入
只是 Plasma 桌面壳没有正常显示
```

这时可以在 Konsole 中手动启动 Plasma bash：

```bash
plasmabash --replace &
```

如果窗口管理器也有问题，可以执行：

```bash
kwin_x11 --replace &
```

这次调试中，手动执行 `plasmabash --replace` 后，桌面成功显示出来。

这说明当时的问题已经从底层图形驱动问题，转变为 KDE 用户会话或 Plasma 组件启动问题。

### 清理 KDE 用户配置

在多次切换 Xorg / XLibre、反复黑屏、手动启动 Plasma 后，用户目录中的 Plasma 配置可能会变得比较混乱。

可以备份并清理部分 KDE 配置：

```bash
mkdir -p ~/kde-config-backup

mv ~/.config/plasma* ~/kde-config-backup/ 2>/dev/null
mv ~/.config/kwinrc ~/kde-config-backup/ 2>/dev/null
mv ~/.config/kglobalshortcutsrc ~/kde-config-backup/ 2>/dev/null
mv ~/.local/share/plasma* ~/kde-config-backup/ 2>/dev/null
mv ~/.cache/plasma* ~/kde-config-backup/ 2>/dev/null

rm -f ~/.Xauthority ~/.ICEauthority
```

然后用 root 修复用户目录权限：

```bash
chown -R cyb /home/cyb
```

这里的 `cyb` 需要替换成自己的用户名。

### 确认 dbus 和 procfs

KDE Plasma 依赖 dbus，因此需要确认 dbus 已经启用：

```bash
sysrc dbus_enable=YES
service dbus restart
```

同时可以检查 `/proc` 是否挂载：

```bash
mount | grep proc
```

如果没有输出，可以编辑 `/etc/fstab`：

```bash
ee /etc/fstab
```

加入：

```fstab
proc    /proc    procfs    rw    0    0
```

然后挂载：

```bash
mount /proc
```

### 补充：Plasma 组件不完整时的处理

如果日志中出现类似：

```text
Could not find required file "mainscript" for package ... org.kde.plasma.icontasks
```

可能是 Plasma 组件不完整或用户配置损坏。

可以尝试强制重装 KDE / Plasma 相关包：

```bash
pkg install -f kde plasma6-plasma plasma6-workspace plasma6-kwin sddm dbus
```

如果某些包名不存在，可以先搜索：

```bash
pkg search plasma6
pkg search workspace
pkg search kwin
```

也可以通过 `pkg which` 查询文件属于哪个包：

```bash
pkg which /usr/local/share/plasma/plasmoids/org.kde.plasma.icontasks
pkg which /usr/local/share/plasma/plasmoids/org.kde.plasma.icontasks/contents/ui/main.qml
```

然后再重装对应包。

## 最终状态

最后，桌面成功进入并正常显示。
这次问题的主要解决路线可以概括为：

```text
1. 不再混装 Xorg 和 XLibre
2. 修复 Intel KMS/DRM，确保 /dev/dri/card0 出现
3. 先使用传统 Xorg + Plasma X11
4. 确认 dbus、sddm、i915kms 正常启用
5. 修复用户权限与 KDE Plasma 配置
6. 必要时手动启动 plasmabash --replace
```

可以用下面几条命令检查最终状态：

```bash
pkg info | grep -E "xorg|xlibre|plasma|kde|sddm|drm|gpu-firmware"
kldstat | grep -E "i915|drm"
ls /dev/dri
sysrc kld_list
sysrc dbus_enable
sysrc sddm_enable
```

## 对 XLibre 的一点展望

虽然这次最后暂时回到了传统 Xorg 路线，但我个人对 XLibre 仍然是比较期待的。

Xorg 本身已经非常成熟，也承载了 Linux / BSD 桌面环境很多年的历史。
但是随着桌面环境、显卡驱动、输入设备和安全需求不断变化，传统 Xorg 的维护模式和代码历史包袱也越来越明显。

XLibre 的出现，某种程度上说明 X11 生态仍然有人希望继续整理和延续，而不是简单地让所有用户马上转向 Wayland。
对于 FreeBSD 这类系统来说，这一点其实挺有意义。因为 FreeBSD 桌面生态和 Linux 不完全一样，Wayland 的适配、显卡驱动、桌面组件体验并不总是一步到位。

如果 XLibre 未来能够稳定维护，并且逐渐改善以下方面：

```text
与 KDE Plasma / SDDM 的兼容性
与 FreeBSD drm-kmod 的配合
输入驱动与桌面会话的稳定性
包依赖和传统 Xorg 之间的迁移体验
文档和故障排查资料
```

那么它可能会成为 FreeBSD 桌面环境中的一个有趣选择。

不过就目前个人体验而言，在 FreeBSD 桌面初装阶段，还是建议优先使用传统 Xorg。
等系统桌面、显卡驱动、KDE、输入法、浏览器等基础环境都稳定后，再单独尝试 XLibre 会更加稳妥。

这次调试给我的感觉是：

```text
XLibre 本身值得关注
但初装系统时不适合作为第一优先级变量
先把桌面跑起来，再尝试替换显示栈
```

毕竟桌面环境排错最怕多个变量叠在一起。
当 KDE、SDDM、显卡 KMS、用户权限、Plasma 配置和 X server 同时出问题时，排查成本会很高。

因此，目前的建议是：

```text
日常使用：传统 Xorg
后续测试：单独尝试 XLibre
长期关注：XLibre 在 FreeBSD 桌面生态中的发展
```

## 小结

这次 FreeBSD KDE 桌面黑屏问题，表面上看是 Xorg / XLibre 或 SDDM 的问题，但真正的关键点首先是 Intel KMS/DRM 没有正常加载，导致 `/dev/dri/card0` 不存在。

在修复显卡驱动后，又遇到了 Plasma bash 没有自动显示的问题，最后通过清理 KDE 配置、确认 dbus、手动执行 `plasmabash --replace` 等方式恢复了桌面。

总体而言，FreeBSD 桌面环境仍然需要比主流 Linux 发行版更多的手动配置和耐心排错。
但正因为如此，把每一次问题记录下来也比较有价值。以后遇到类似的黑屏、SDDM 登录失败、KDE 不显示等问题时，可以按本文的顺序逐步排查。
