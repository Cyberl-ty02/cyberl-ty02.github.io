---
title: Gentoo OpenRC 迁移到 SonicDE 6.7.5：登录管理器、Portal 与应用边界
comments: true
toc: true
donate: false
share: true
date: 2026-10-13 16:30:00
categories: Linux 与 BSD
tags:
- Linux
- Gentoo
---

这篇文章整理一次 Gentoo OpenRC 桌面迁移：以 SonicDE 6.7.5 作为桌面主体，替换旧的 SDDM 登录链，补齐 XDG Desktop Portal 与 `libei`，同时保留仍有明确用途的 KDE 应用。目标不是为了“纯度”删除全部 KDE 软件，而是让每个组件都有清楚的职责和可验证的回退方式。

> **核验范围（2026-10-13）**
> 当前系统使用 Qt 6.11.2、SonicDE 6.7.5、OpenRC 与 XLibre/X11；Sonic Login Manager 已加入 `default` runlevel。版本会继续变化，以下命令中的版本号只表示本文快照。

对应的 Portage、Portal、登录管理器补丁和软件清单保存在 [dotfiles 的 Gentoo PC 目录](https://github.com/Cyberl-ty02/dotfiles/tree/main/gentoo_setting/pc)。本文解释选择与边界，不建议整目录照搬。

## Stage 1：先定义迁移边界

这次从 Plasma 为主转向 SonicDE，主要是为了使用正在持续维护的 Sonic Workspace、窗口管理器与配套桌面组件，并把先前混杂的登录及 Portal 配置收敛成一条可复核路径。迁移不是因为 Plasma 应用本身“不可用”，所以成熟、没有等价替代品或更符合既有操作习惯的 KDE 应用仍然保留。

### 当前桌面栈

| 层级 | 当前选择 | 说明 |
| --- | --- | --- |
| 桌面主体 | SonicDE 6.7.5 | `sonic-desktop-interface`、`sonic-win`、`sonic-workspace` 等 |
| 显示协议 | XLibre/X11 | Xwayland 仍为部分组件提供兼容能力 |
| 登录管理器 | Sonic Login Manager 6.7.5.3 | OpenRC 服务名为 `soniclogin` |
| Portal | SonicDE 为默认后端 | 通知交给 Plasma，Secret 继续使用 KWallet |
| 邮件 | Thunderbird ESR | KMail/Akonadi/Kontact 不再属于当前安装集合 |
| 浏览器 | Firefox ESR 源码包 | 与 Thunderbird 都按 LLVM 22 构建 |
| 防火墙 | firewalld 及其 GUI | 不启用当前仅支持 systemd 的 Sonic firewall 组合 |

### 最大化 SonicDE 不等于删除 KDE

SonicDE 与 KDE/Qt 生态仍有交叉依赖。当前保留 Dolphin、Ark、Gwenview、Yakuake、Discover、KWallet Manager、打印管理等有明确用途的应用；Sonic Terminal 已安装，但它不能替代 Yakuake 的下拉终端交互。

另外，SonicDE overlay 中有一些与 Plasma 同名的 dummy 包，用来满足仍引用 KDE 包名的依赖。看到 `kde-plasma/*` atom 不能直接推断正在运行完整 Plasma 桌面，更不能用 `emerge --depclean` 前的包名搜索替代依赖图判断。

### 稳定基础与 overlay 关键字

主系统仍以 stable profile 为基础，只对 SonicDE overlay 设定仓库范围的 `~amd64`：

```text
*/*::sonicde ~amd64
```

这里的 `::sonicde` 很重要。不要为了安装桌面而把无仓库限定的 `*/* ~amd64` 加进系统，也不要把整个系统切换为测试分支。其他需要测试版的应用继续逐个 atom 接受关键字。

升级前先预览：

```bash
emerge --sync
emerge --pretend --verbose --update --deep --newuse @world
emerge --pretend --depclean
```

最后一条只用于审计，不应在尚未检查 reverse dependencies 时直接去掉 `--pretend`。

## Stage 2：Qt、浏览器与邮件客户端

### Qt 6.11.2 与 SonicDE 6.7.5

桌面迁移和 Qt 大版本更新应分阶段执行。本文环境最终收敛到 Qt 6.11.2 与 SonicDE 6.7.5，但排错时仍建议先确认计划中的 Qt 子包版本一致，再更新 SonicDE：

```bash
qlist -ICv | grep -E '^(dev-qt|sonicde-)'
emerge -pv @world
```

若同一轮同时出现 Qt ABI、桌面组件、显卡栈和登录管理器的大量变更，应拆开安装和验证，避免一次失败留下过多变量。

### 从 KMail/Akonadi 转向 Thunderbird

当前软件清单中保留 Thunderbird，不再安装 KMail、Akonadi 或 Kontact。这描述的是软件选择，不等同于“邮件数据已经自动迁移”：

- IMAP 邮件通常可由服务器重新同步；
- 本地文件夹、过滤规则、地址簿、日历和凭据需要分别导出、导入或核对；
- 删除 Akonadi 前应确认不再有其他 PIM 应用依赖其中的数据。

可用以下命令检查边界：

```bash
qlist -ICv | grep -E 'kmail|akonadi|kontact|thunderbird'
emerge -pv mail-client/thunderbird
```

### Firefox 与 Thunderbird 的 ESR 边界

当前 Firefox 和 Thunderbird 都是 Gentoo 源码构建的 ESR 153.4.0，并选择 LLVM slot 22。ESR 的意义是较长的维护周期，而不是不再更新；实际版本和安全更新仍应以 Portage 计划为准。

```bash
emerge -pv www-client/firefox mail-client/thunderbird
```

源码浏览器会显著增加编译时间与临时空间需求。本文机器通过 `lowjobs`、关闭不必要的 LTO，以及 zram swap 缓解资源峰值；这不是所有机器都必须复制的全局策略。

## Stage 3：从 SDDM 迁移到 Sonic Login Manager

### 旧 SDDM 故障只作为诊断背景

迁移前曾遇到 SDDM 在 VT、会话权限和手工 TTY 启动之间表现不一致。那些测试适合用来区分 X Server、PAM、Seat 与显示管理器问题，但不应继续当作当前启动方案。

### OpenRC 服务名冲突

Sonic Login Manager 的 OpenRC 脚本原先声明了通用的 `xdm` / `display-manager` provide 名称，会和 `gui-libs/display-manager-init` 冲突。当前配置使用一个很小的本地 Portage 补丁，移除冲突声明，并直接启用真实服务名 `soniclogin`。

补丁只在上游 ebuild 仍有相同问题时才需要。每次版本更新都应先检查最新 ebuild 和服务文件，不要永久假定上游尚未修复：

```bash
emerge -pv sonicde-base/sonic-login-manager
grep -R "provide.*\(xdm\|display-manager\)" \
  /var/db/repos/sonicde/sonicde-base/sonic-login-manager \
  /etc/init.d/soniclogin 2>/dev/null
```

若检查确认仍需要补丁，再把它放到 Portage 支持的包级补丁目录并重装：

```text
/etc/portage/patches/sonicde-base/sonic-login-manager/
```

### 切换服务

先安装并确认服务文件存在，再切换 runlevel：

```bash
doas emerge -av sonicde-base/sonic-login-manager
doas rc-update del sddm default
doas rc-update add soniclogin default

rc-update show default | grep -E 'soniclogin|sddm'
doas rc-service soniclogin status
```

本文环境已经通过关机后的冷启动验证登录链。迁移自己的机器时，仍应保留可用 TTY、LiveCD 与原配置备份；完成一次冷启动前不要删除所有旧显示管理器配置。

## Stage 4：Portal、输入设备与会话兼容

### 明确 Portal 路由

当前 `/etc/xdg/xdg-desktop-portal/portals.conf` 的职责分配如下：

```ini
[preferred]
default=sonicde
org.freedesktop.impl.portal.Notification=plasmanotify
org.freedesktop.impl.portal.Secret=kwallet
```

这不是“混装失败”的迹象：默认文件选择器、屏幕共享等能力交给 SonicDE，通知和 Secret 则继续使用当前已验证的后端。Portal 会按桌面环境及配置文件选择实现，修改后需要重新登录用户会话。

Sonic overlay 当前没有完整声明 portal 构建所需的 `dev-libs/libei`，因此世界清单暂时显式保留它。上游依赖修正后，应重新评估是否仍需作为直接 world 项，而不是永远保留临时绕行。

```bash
qlist -ICv | grep -E 'xdg-desktop-portal|libei|kwallet'
pgrep -a xdg-desktop-portal
```

### `XDG_CURRENT_DESKTOP=KDE` 的兼容含义

当前 X11 会话中仍可能看到：

```bash
printf '%s\n' "$XDG_CURRENT_DESKTOP"
```

输出 `KDE` 并不自动表示 SonicDE 没有运行。SonicDE 继承 Qt/KDE 生态的多项会话约定，一些应用也据此选择 Portal 或样式。判断实际桌面组件应结合进程、包版本和 Portal 配置，而不是只看一个环境变量。

## Stage 5：桌面卡死、Fcitx 与语言混杂

迁移期曾同时出现桌面卡死、输入法状态异常和界面中英混杂。它们可能在同一时间发生，却不应被未经证据地归为同一个根因。

### 第一层：确认系统是否仍可响应

```bash
Ctrl+Alt+F3
ps -eo pid,stat,comm,args | grep -E 'sonic|kwin|Xorg|fcitx|portal'
dmesg | tail -n 100
```

若 TTY 仍可用，优先保存日志和进程状态；若整个系统无响应，再检查内核、GPU reset、内存压力和磁盘 I/O。不要因为鼠标不动就直接断言是输入法或桌面翻译问题。

### 第二层：输入法和用户会话

```bash
pgrep -a fcitx5
fcitx5-diagnose
printf '%s\n' "$XMODIFIERS" "$GTK_IM_MODULE" "$QT_IM_MODULE"
```

Fcitx5 应由普通用户会话启动。root、TTY 和显示管理器环境中的变量不能替代实际桌面会话结果。

### 第三层：locale 与翻译包

```bash
locale
locale -a | grep -E 'C\.utf8|zh_CN\.utf8|en_US\.utf8'
qlist -ICv | grep -E 'l10n|language|sonic'
```

中英混杂可能来自组件尚无翻译、语言包版本不一致或 locale fallback。先判断是哪一个包的界面，再查对应翻译资源；不要为了“全中文”设置不一致的全局环境变量。

更早的字体与音频托盘问题仍单独保留在 [Gentoo OpenRC 桌面排错记录](/posts/gentoo-openrc-desktop-troubleshooting/gentoo-openrc-desktop-troubleshooting/)，避免把不同故障写成一个故事。

## Stage 6：Flatpak、Discover、Krita 与防火墙

### Flatpak 空仓库也会占空间

当前已安装 Flatpak 并配置 Flathub，但没有安装应用或 runtime；`/var/lib/flatpak` 仍约占 103 MiB。这部分空间包含仓库元数据和 OSTree 对象，不能据此认定卸载失败。

```bash
flatpak remotes --show-details
flatpak list --app
flatpak list --runtime
du -sh /var/lib/flatpak 2>/dev/null
flatpak uninstall --unused
```

最后一条只删除不再被应用引用的 runtime，不是清空全部仓库。若决定完全停用 Flatpak，应先确认 Discover 没有仍需管理的 Flatpak 软件，再按官方方式删除 remote 和数据。

### Discover 和 Krita 的实际角色

Discover 以 `flatpak` USE 构建，可作为图形化前端；它不会把 Portage 和 Flatpak 的所有权自动合并。当前 Krita 6.0.4.1 来自 Gentoo，而不是 Flatpak：

```bash
qlist -ICv media-gfx/krita kde-plasma/discover
flatpak list --app | grep -i krita
```

同一应用只保留一个明确来源，能减少桌面文件、权限、字体和插件路径混淆。

### OpenRC 下继续使用 firewalld GUI

当前 SonicDE overlay 的 firewall 组合需要 systemd，因此 `sonicde-meta` 显式关闭 `firewall` USE；OpenRC 系统继续使用 `net-firewall/firewalld[gui]`。这保留了图形配置能力，同时没有伪装成 Sonic 原生防火墙已经兼容 OpenRC。本文迁移完成后的真机会话已确认 firewalld 正常运行，但复制配置时仍应在自己的启动环境重新核验。

```bash
rc-update show default | grep firewalld
doas rc-service firewalld status
doas firewall-cmd --state
```

若 `rc-service` 与 `firewall-cmd` 结论不一致，应先检查 D-Bus、权限和实际 daemon 日志，不要只以 GUI 是否打开作为防火墙状态。

## Stage 7：验证、回滚与后续维护

### 每次桌面更新后的最小核验

```bash
emerge -pv @world
rc-update show default | grep -E 'dbus|elogind|NetworkManager|firewalld|soniclogin'
qlist -ICv | grep -E 'sonic|xdg-desktop-portal|libei'
pgrep -a 'sonic|xdg-desktop-portal|fcitx5|pipewire|wireplumber'
firewall-cmd --state
```

服务已经加入 runlevel 只表示“配置为开机启动”，不能替代本次启动中的运行状态检查。同理，包已安装不代表用户会话中的 Portal、输入法和音频服务已经正确连接。

### 回滚原则

- 保留 TTY 和 LiveCD；
- 修改登录服务前备份 `/etc/init.d` 与相关 Portage 配置；
- 本地补丁只解决已确认的上游缺口，并在每次升级后重新验证；
- 不把 SDDM、Portal、SonicDE 与 KDE 应用一次性全部删除；
- `emerge --depclean` 永远先运行 pretend 并检查清单。

这套迁移最后形成的是“由 SonicDE 主导、按需复用 KDE 组件、明确标注临时补丁”的桌面，而不是一个靠删包数量衡量完成度的桌面。

## 参考资料

- [SonicDE 官方组织](https://github.com/Sonic-DE)
- [Sonic Login Manager](https://github.com/Sonic-DE/sonic-login-manager)
- [SonicDE Gentoo overlay](https://github.com/sonicde-gentoo/portage)
- [XDG Desktop Portal：portals.conf](https://flatpak.github.io/xdg-desktop-portal/docs/portals.conf.html)
- [Flatpak：Using Flatpak](https://docs.flatpak.org/en/latest/using-flatpak.html)
- [firewalld：firewall-cmd](https://firewalld.org/documentation/utilities/firewall-cmd.html)
- [Mozilla：Firefox release channels](https://firefox-admin-docs.mozilla.org/guides/firefox-channels/)
