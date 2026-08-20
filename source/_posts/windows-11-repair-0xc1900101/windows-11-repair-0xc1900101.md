---
title: Windows 11 修复安装失败 0xC1900101-0x20017：从 DISM 0x800f0915 到定位 TAP/Wintun 驱动
comments: true
toc: true
donate: true
share: true
date: 2026-08-02 12:00:00
categories: Windows
tags:
- 技巧
---

最近这台 Windows 11 的任务栏、右键菜单等系统组件开始出现异常。最初看起来只是组件存储损坏，但从 DISM 修复失败一路排查到 Windows 就地修复安装，最后经历了两层问题：卡巴斯基残留先造成注册表迁移错误，清理后，旧 TAP-Windows 与 Wintun 网络驱动又导致 SAFE_OS 启动阶段失败。

本文记录这次实际排障过程。不同机器上的 `0xC1900101` 不一定具有相同原因，文中的 OEM INF 编号和服务名也只对应当时的系统，不能直接照抄删除。

## 问题现象

系统最先出现的是任务栏、右键菜单等 Windows 组件异常。以管理员身份运行检查后，DISM 报告组件存储可以修复：

```powershell
DISM /Online /Cleanup-Image /ScanHealth
```

但真正执行修复时失败：

```powershell
DISM /Online /Cleanup-Image /RestoreHealth
```

错误码为：

```text
0x800f0915
在任何位置都找不到修复内容
```

与此同时，SFC 最初并没有发现问题：

```powershell
sfc /scannow
```

```text
Windows 资源保护未找到任何完整性违规。
```

Windows 更新中的“Windows 11, version 25H2（修复版本）”也安装失败。随后尝试就地修复安装，系统在重启后回滚，最终给出：

```text
0xC1900101-0x20017
在 SAFE_OS 阶段，安装在 BOOT 操作过程中失败
```

## 环境与错误码

当时的环境如下：

```text
Windows 11 Pro 25H2
当前映像版本：10.0.26200.8973
DISM 工具版本：10.0.26100.8972
双硬盘 Windows + Gentoo
Windows Boot Manager 与 rEFInd 并存
```

DISM 工具版本与当前映像版本不同曾经是排查中的一个疑点，但仅凭这两个版本号不能认定它就是故障原因。同样，双硬盘、rEFInd 和 Windows Boot Manager 也一度值得检查，最后却没有证据表明它们造成了这次回滚。

微软的 [Windows 升级错误处理文档](https://learn.microsoft.com/en-us/troubleshoot/windows-client/setup-upgrade-and-drivers/windows-10-upgrade-resolution-procedures) 将 `0xC1900101-0x20017` 解释为 SAFE_OS 启动失败，通常与驱动无法迁移、驱动非法操作或非微软磁盘加密软件有关。因此，错误码给出的方向是“驱动或底层软件冲突”，而不是直接指向某一个具体驱动。

## 为什么 SFC 正常但 DISM 仍然失败

SFC 和 DISM 检查的对象并不完全相同。简单来说：

```text
SFC：检查受保护的系统文件，并尝试用组件存储中的副本修复
DISM：检查和修复 Windows 映像及其组件存储
```

因此，SFC 报告没有完整性违规，只能说明它没有发现需要替换的受保护系统文件，并不能证明组件存储的修复元数据、包状态和修复源一定正常。

本次现象正是：

```text
SFC 没有发现受保护系统文件损坏
DISM ScanHealth 判断组件存储可修复
DISM RestoreHealth 却找不到可用的修复内容
```

微软的 [Windows 更新常见错误说明](https://learn.microsoft.com/en-us/troubleshoot/windows-client/installing-updates-features-roles/common-windows-update-errors) 也将找不到包或文件来源归入组件存储和修复源问题。由于在线修复和“修复版本”更新均失败，我最终选择用就地修复安装重建系统组件，但安装本身又暴露了驱动迁移问题。

## 第一次 SetupDiag 定位：卡巴斯基注册表迁移

安装回滚后，最重要的是先保存日志。不要立刻重复运行安装，否则新的安装尝试可能覆盖部分线索。

我使用以下命令复制整个 Rollback 目录：

```powershell
New-Item -ItemType Directory -Force 'C:\SetupLogs-Latest'
robocopy 'C:\$WINDOWS.~BT\Sources\Rollback' 'C:\SetupLogs-Latest\Rollback' /E /COPY:DAT /R:1 /W:1
```

主要检查了：

```text
C:\$WINDOWS.~BT\Sources\Rollback\setupact.log
C:\$WINDOWS.~BT\Sources\Rollback\setuperr.log
setupapi.offline.log
setupapi.upgrade.log
```

[SetupDiag](https://learn.microsoft.com/en-us/windows/deployment/upgrade/setupdiag) 会分析 Windows 安装日志；离线分析时，微软建议保留完整日志目录，而不是只挑一两个文件。复制完成后，可以让 SetupDiag 读取副本：

```powershell
SetupDiag.exe /Output:'C:\SetupLogs-Latest\SetupDiagResults.log' /LogsPath:'C:\SetupLogs-Latest\Rollback'
```

第一次分析得到的关键线索指向：

```text
HKCU\Software\KasperskyLab\AVP21.25
迁移 apply 阶段
Error 5 / Access Denied
```

这说明安装程序迁移用户注册表时无法处理卡巴斯基留下的项目。它是当时已经确认的迁移错误，但还不能据此断言这是整次 `0xC1900101-0x20017` 的唯一根因。

## 清理卡巴斯基残留与孤儿 klids 服务

我先正常卸载卡巴斯基，再使用官方 kavremover 清理残留，并处理了已经确认属于旧版本的 `KasperskyLab` 注册表项。

注册表清理不能只靠名称猜测。删除前应确认路径属于已经卸载的软件，并先导出备份。对于后来发现的驱动服务，我先检查配置与状态：

```powershell
sc.exe qc 'klids.K4W-21-25'
sc.exe query 'klids.K4W-21-25'
```

当时得到的信息包括：

```text
服务名：klids.K4W-21-25
类型：KERNEL_DRIVER
状态：STOPPED
ImagePath：\??\C:\ProgramData\Kaspersky Lab\AVP21.25\Bases\klids.sys
```

对应的 `klids.sys` 文件已经不存在，因此这是一个指向失效路径的孤儿内核驱动服务。确认无误后，先备份它的注册表项：

```powershell
reg export 'HKLM\SYSTEM\CurrentControlSet\Services\klids.K4W-21-25' 'C:\SetupLogs-Latest\klids-backup.reg' /y
```

再删除服务注册：

```powershell
sc.exe delete 'klids.K4W-21-25'
```

这里删除的是已经核实文件不存在、软件也已卸载的孤儿服务。不要仅因为看到第三方服务名，就直接删除仍在工作的安全软件或驱动服务。

## 为什么问题仍然存在

清理卡巴斯基注册表残留与孤儿服务后，早期的迁移访问拒绝不再是主要线索，但修复安装仍然报：

```text
0xC1900101-0x20017
SAFE_OS / BOOT
```

这说明第一次定位确实发现了问题，却没有清除全部阻塞因素。更准确的判断是：

```text
卡巴斯基残留造成了早期迁移错误
系统里还存在另一个影响 SAFE_OS 启动的驱动问题
```

排障过程中也尝试过减少启动项。Clean boot 可以排除许多普通服务和开机程序，但无法保证所有内核驱动都停止加载。网络过滤、虚拟网卡、存储和安全软件驱动可能在用户态服务启动之前就参与系统启动，所以“干净启动后仍失败”不能排除底层驱动。

## 从 SetupAPI 日志继续定位第三方网络驱动

下一步重新检查 `setupapi.offline.log` 和 `setupapi.upgrade.log` 中的驱动迁移记录，并枚举驱动存储里的第三方包：

```powershell
pnputil /enum-drivers
```

同时检查当前加载的驱动与文件系统过滤器：

```powershell
driverquery /v
fltmc filters
```

调查重点放在曾安装过但已不再使用的软件，尤其是第三方安全组件、网络过滤器和虚拟网卡。最终确认两项网络驱动值得移除：

```text
oem148.inf：TAP-Windows Provider V9 / OpenVPN
oem99.inf：Wintun / WireGuard
```

其中 TAP-Windows 是较旧的 Legacy 驱动。这里的判断来自本机日志、驱动版本和实际软件使用情况，不代表 TAP 或 Wintun 在所有 Windows 11 系统上都会导致升级失败。

## 删除 TAP-Windows 与 Wintun

在删除 OEM INF 前，必须先通过 `pnputil /enum-drivers` 核对发布名称、提供商、类、版本和签名者，并确认相应 VPN 或虚拟网络软件已经不再需要。OEM 编号由每台系统自行分配，别人的 `oem148.inf` 在你的电脑上很可能属于完全不同的设备。

确认后，我执行了：

```powershell
pnputil /delete-driver oem148.inf /uninstall
pnputil /delete-driver oem99.inf /uninstall
```

微软的 [驱动包卸载说明](https://learn.microsoft.com/en-us/windows-hardware/drivers/install/using-device-manager-to-uninstall-devices-and-driver-packages) 提醒，驱动包从 Driver Store 删除后，如果设备没有其他匹配驱动，它可能无法继续工作。因此更稳妥的顺序是：

```text
确认 INF 对应的软件与设备
准备好新版驱动或软件安装包
创建系统还原点或其他可用备份
先卸载对应应用和设备
再删除确认无用的驱动包
```

如果普通删除失败，`pnputil` 还提供 `/force`，但它会强制删除驱动包，风险更高。本文不建议把它作为默认选项，更不能批量强删所有第三方 INF；误删存储、网络或输入设备驱动可能造成设备失效，甚至让系统无法正常启动。

卸载这两个已经确认不再需要的驱动包后，我再次执行 Windows 修复安装，这次安装成功完成。

## 修复成功与 DISM/SFC 验证

回到系统后，我没有只根据“能够进入桌面”判断修复完成，而是重新执行组件存储和系统文件检查：

```powershell
DISM /Online /Cleanup-Image /ScanHealth
```

结果为：

```text
未检测到组件存储损坏。
组件存储损坏标志：否
```

随后运行：

```powershell
sfc /scannow
```

结果为：

```text
Windows 资源保护未找到任何完整性违规。
```

任务栏、右键菜单等原先异常的系统组件也恢复正常。

## 最终根因总结

这次修复不是一个错误对应一个根因，而是连续处理了两个层次的问题：

```text
第一层：
卡巴斯基残留注册表项造成迁移 apply 阶段 Error 5 / Access Denied
遗留的 klids 内核驱动服务还指向已经不存在的文件

第二层：
清理安全软件残留后，修复安装仍在 SAFE_OS / BOOT 阶段失败
旧 TAP-Windows 与 Wintun 网络驱动成为后续驱动迁移和启动冲突
卸载这两个驱动包后，修复安装成功
```

因此，最准确的结论是：**卡巴斯基残留造成了早期迁移错误，而旧 TAP/Wintun 网络驱动导致后续 SAFE_OS 启动阶段失败。**

以下因素在排查过程中曾被怀疑，但没有被证实为本次根因：

```text
DISM 工具版本与当前映像版本不同
双硬盘 Windows + Gentoo
rEFInd 与 Windows Boot Manager 并存
```

尤其是引导管理器：最终无需删除 rEFInd、Gentoo 硬盘或 Windows Boot Manager 配置，修复安装也能成功，因此不应把它们写成根因。

## 今后的预防措施

这次排障之后，我会更注意以下几件事：

```text
卸载安全软件时使用厂商清理工具，并检查遗留的驱动服务
升级 Windows 前更新或卸载不再使用的 VPN、虚拟网卡与过滤驱动
保留软件和驱动包用途记录，不根据 OEM 编号盲目删除
安装失败后先复制完整 Rollback 日志，再开始下一轮尝试
把 SetupDiag 结果视为入口，并继续核对 SetupAPI 和原始安装日志
修复完成后同时验证 DISM、SFC 和原先异常的系统功能
```

`0xC1900101` 更像一个排查方向，而不是具体答案。即使日志先暴露出一个确定错误，也要在清理后重新收集日志，因为后面的真正阻塞因素可能只有在前一个问题消失后才会出现。

## 常用命令附录

以下命令均应在管理员终端中运行。

### DISM 与 SFC

```powershell
DISM /Online /Cleanup-Image /ScanHealth
DISM /Online /Cleanup-Image /RestoreHealth
sfc /scannow
```

### 保存回滚日志

```powershell
New-Item -ItemType Directory -Force 'C:\SetupLogs-Latest'
robocopy 'C:\$WINDOWS.~BT\Sources\Rollback' 'C:\SetupLogs-Latest\Rollback' /E /COPY:DAT /R:1 /W:1
```

### 枚举驱动与过滤器

```powershell
pnputil /enum-drivers
driverquery /v
fltmc filters
```

### 检查、备份和删除孤儿服务

以下服务名仅为本次案例，使用前必须替换成自己已经核实的对象：

```powershell
sc.exe qc 'klids.K4W-21-25'
sc.exe query 'klids.K4W-21-25'
reg export 'HKLM\SYSTEM\CurrentControlSet\Services\klids.K4W-21-25' 'C:\SetupLogs-Latest\klids-backup.reg' /y
sc.exe delete 'klids.K4W-21-25'
```

### 删除已经确认无用的驱动包

以下 OEM 编号只属于本次案例，必须先用枚举结果确认，不能直接照抄：

```powershell
pnputil /delete-driver oem148.inf /uninstall
pnputil /delete-driver oem99.inf /uninstall
```

如果仍然失败，应先检查设备是否还在使用该驱动，并考虑从对应软件或设备管理器正常卸载。除非已经准备好恢复方案并完全理解影响，否则不要追加 `/force`。
