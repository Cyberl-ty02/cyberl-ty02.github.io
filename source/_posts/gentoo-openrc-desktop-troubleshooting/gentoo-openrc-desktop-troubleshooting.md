---
title: Gentoo OpenRC 桌面排错：中文字体、KDE 托盘与 PipeWire
comments: true
toc: true
donate: true
share: true
date: 2026-08-05 19:15:00
categories: 实用技巧
tags:
- 技巧
---

这篇文章记录 Gentoo OpenRC 桌面环境中的两组问题：中文界面全部落到旧文鼎字体，以及 KDE/SonicDE 中音量托盘缺失。字体问题已经完成修复和验证；音量部件部分只记录已确认的组件关系与待验证方案。

> **适用环境**
> Gentoo amd64、OpenRC、KDE Plasma 或 SonicDE、XLibre/X11、fontconfig 与 PipeWire。

对应的完整字体配置保存在 dotfiles 仓库的 [`local.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/desktop/fontconfig/local.conf)，本文只解释关键判断和验证方式。

## 中文界面全部显示成楷体

最初的现象并不限于一个应用。SDDM、VSCodium、Firefox 和 Plasma/SonicDE 界面的中文都显示成文鼎楷体或宋体。

使用 `fc-match` 检查通用字体族时，结果类似：

```text
sans-serif            -> 文鼎 PL 简中楷
sans-serif:lang=zh-cn -> 文鼎 PL 简中楷
system-ui             -> 文鼎 PL 简中楷
serif                 -> 文鼎 PL 简报宋
monospace             -> 文鼎 PL 简中楷
```

这说明应用本身没有同时选择同一种字体，而是它们共同依赖的 fontconfig fallback 已经偏向旧文鼎字体。

## 原因：generic family fallback 被抢占

问题不是 Noto 或 HarmonyOS 字体没有安装，而是以下 generic family 的匹配顺序不合适：

```text
sans-serif
system-ui
serif
monospace
```

现代桌面应用通常请求 `system-ui` 或 `sans-serif`，并不直接写死某个中文字体。如果 fontconfig 把这些通用族优先映射到文鼎楷体，那么不同工具包的应用也会呈现相同问题。

先确认候选字体确实存在：

```bash
fc-list : family file |
  grep -Ei 'HarmonyOS|Noto Sans CJK|Noto Sans Mono CJK' |
  sort -u

fc-match "HarmonyOS Sans SC"
fc-match "Noto Sans CJK SC"
fc-match "Noto Sans"
fc-match "Noto Sans Mono CJK SC"
```

只有字体文件和 family 名称已经被 fontconfig 识别，调整 fallback 才有意义。

## 实际修复 fontconfig

我在 `/etc/fonts/local.conf` 中为四类 generic family 设置优先顺序，并为简体中文补充 HarmonyOS Sans SC 与 Noto Sans CJK SC。完整文件可直接查看仓库中的 [`desktop/fontconfig/local.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/desktop/fontconfig/local.conf)。

核心思路可以概括为：

```text
sans-serif：Noto Sans → HarmonyOS Sans SC → Noto Sans CJK SC
system-ui：Noto Sans → HarmonyOS Sans SC → Noto Sans CJK SC
serif：Noto Serif → Noto Serif CJK SC
monospace：Noto Sans Mono → Noto Sans Mono CJK SC
```

修改系统级配置前应先备份原文件：

```bash
doas cp -a /etc/fonts/local.conf /etc/fonts/local.conf.backup
```

更新缓存：

```bash
doas fc-cache -f -v
rm -rf ~/.cache/fontconfig
fc-cache -f
```

本次运行中出现过 `looped directory detected`。它表示缓存扫描遇到重复目录，并不自动等于更新失败；最后出现 `fc-cache: succeeded`，而且匹配结果正确，因此没有继续把它当作根因。

## 字体修复验证

重新检查：

```bash
fc-match sans-serif
fc-match 'sans-serif:lang=zh-cn'
fc-match system-ui
fc-match serif
fc-match monospace
```

实际恢复为：

```text
sans-serif            -> Noto Sans
sans-serif:lang=zh-cn -> Noto Sans
system-ui             -> Noto Sans
serif                 -> Noto Serif
monospace             -> Noto Sans Mono
```

SDDM 使用独立的 greeter 进程，需要重启显示管理器或系统后再观察。VSCodium 和 Firefox 也要完全退出所有进程后重开，单纯刷新页面不一定重新载入字体配置。

## KDE/SonicDE 音量图标缺失

另一个现象是网络托盘正常，但音量图标没有出现。这里容易把 `plasma-nm` 与音频组件混为一谈：

```text
plasma-nm：NetworkManager 网络托盘
plasma-pa：Plasma 音频音量部件
```

因此，网络图标存在只能说明 `plasma-nm` 正常，不能证明音频托盘组件已经安装。

先检查包与用户会话：

```bash
qlist -Iv | grep -E 'plasma-pa|pipewire|wireplumber|pulseaudio'
pgrep -a pipewire
pgrep -a wireplumber
pgrep -a pipewire-pulse
wpctl status
pactl info
```

OpenRC 管理系统服务，但 PipeWire 和 WirePlumber 在桌面环境中经常由用户会话启动。因此，只查看 `rc-service` 不能完整判断音频会话状态。

## 待验证：安装 plasma-pa

> **待验证**
> 已确认音量部件来自 `kde-plasma/plasma-pa`，但当时尚未完成安装后的最终反馈，不能写成已经通过此步骤恢复。

候选安装命令为：

```bash
doas emerge -av kde-plasma/plasma-pa
```

安装后仍应检查：

```text
PipeWire、WirePlumber 与 pipewire-pulse 是否处于同一用户会话
wpctl status 是否能看到输出设备与音频流
系统托盘设置中“音频音量”是否被设为隐藏
重新登录 Plasma 后部件是否加载
```

Portage 的桌面和 SonicDE 配置可以对照 [`package.use/desktop`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/desktop) 与 [`package.use/sonicde`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/sonicde)，但这些文件反映的是本文环境，不应整份复制到另一台机器。

## 小结

字体问题的关键是 fontconfig generic family 匹配，而不是逐个修改应用字体。音量图标问题则需要区分网络托盘、Plasma 音频部件和 PipeWire 用户会话。

```text
字体：已修复并通过 fc-match 与桌面应用验证
音频托盘：组件关系已确认，安装后的最终结果仍待验证
```

关于同一台 Gentoo 的启动链修复，参见：[Gentoo 在 Btrfs 与 rEFInd 环境下的启动修复记录](/posts/gentoo-refind-btrfs-rescue/)。
