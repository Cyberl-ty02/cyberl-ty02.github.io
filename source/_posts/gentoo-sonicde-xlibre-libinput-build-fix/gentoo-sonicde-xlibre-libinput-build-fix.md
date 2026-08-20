---
title: Gentoo SonicDE + XLibre 编译失败：追踪 kcm_mouse 缺失的 xorg-libinput 依赖
comments: true
toc: true
donate: true
share: true
date: 2026-08-09 19:30:00
categories: 实用技巧
tags:
- 技巧
---

这次更新 SonicDE 时，`sonic-desktop` 在编译鼠标设置模块时停在了 `libinput-properties.h`。表面看像缺少开发头文件，实际情况却相反：头文件已经安装，`pkg-config` 和 CMake 也都找到了 `xorg-libinput`，只是依赖没有传到真正编译失败的 `kcm_mouse` target。

> **适用范围**
> 本文记录 Gentoo、SonicDE、XLibre/X11 组合中已经复现并验证的一次构建问题。补丁修复的是这里确认的 target 依赖遗漏，不代表能够解决所有 SonicDE 或 XLibre 问题。

运行期的中文字体 fallback、音量托盘及 PipeWire 排查另见：[Gentoo OpenRC 桌面排错：中文字体、KDE 托盘与 PipeWire](/posts/gentoo-openrc-desktop-troubleshooting/gentoo-openrc-desktop-troubleshooting/)。

## 现象不是“系统里没有头文件”

失败位置来自：

```text
kcms/mouse/backends/x11/x11_input_properties.h
```

它包含了：

```cpp
#include <libinput-properties.h>
```

编译器随即报告找不到该头文件。第一步不是立刻重装包，而是确认文件和 `pkg-config` 元数据：

```bash
find /usr/include -name 'libinput-properties.h' -print

pkg-config --cflags xorg-libinput
pkg-config --libs xorg-libinput
```

本机确认到头文件位于：

```text
/usr/include/xorg/libinput-properties.h
```

而 `pkg-config --cflags xorg-libinput` 能给出包含 `/usr/include/xorg` 的参数。这两项结果已经排除了“头文件包没有安装”和“pkg-config 数据缺失”。CMake 配置阶段同样识别到了 `xorg-libinput`，问题因此缩小为：为什么特定编译命令没有收到已经探测到的 include path？

## 对比 CMake target 定位遗漏

在源码树中搜索依赖的声明和使用位置：

```bash
grep -Rni 'XORGLIBINPUT' .
grep -Rni 'PkgConfig::XORGLIBINPUT' .
```

对比相关 target 后可以看到，触摸板 target 获得了 `PkgConfig::XORGLIBINPUT`，编译鼠标后端的 `kcm_mouse` 却没有。于是出现了一个容易误判的状态：

```text
头文件已经安装
pkg-config 返回正确的 include path
CMake 已经找到 xorg-libinput
但 kcm_mouse 没有链接对应的 imported target
```

也就是说，探测成功并不等于每个需要它的构建目标都继承了依赖。缺少的是 target 之间的关联，而不是系统包。

## 维护者给出的补丁

我把完整现象、两组 target 的编译参数对比以及最小编译测试提交到了 [`sonicde-gentoo/portage` issue #15](https://github.com/sonicde-gentoo/portage/issues/15)。维护者感谢了这份详细报告，并建议把 `PkgConfig::XORGLIBINPUT` 明确链接到 `kcm_mouse`。本机实际测试的补丁如下：

```diff
diff --git a/kcms/mouse/backends/CMakeLists.txt b/kcms/mouse/backends/CMakeLists.txt
index fa7f752016..47d057a8a0 100644
--- a/kcms/mouse/backends/CMakeLists.txt
+++ b/kcms/mouse/backends/CMakeLists.txt
@@ -16,4 +16,7 @@ if (BUILD_KCM_MOUSE_X11)
     if (TARGET XOrg::Evdev)
         target_link_libraries(kcm_mouse PRIVATE XOrg::Evdev)
     endif()
+    if (XORGLIBINPUT_FOUND)
+        target_link_libraries(kcm_mouse PRIVATE PkgConfig::XORGLIBINPUT)
+    endif()
 endif()
```

`PkgConfig::XORGLIBINPUT` 是 CMake 的 imported target。把它加入 `target_link_libraries` 后，CMake 会把 `xorg-libinput` 所需的 include 与 link 元数据传播给 `kcm_mouse`，其中就包括保存 `libinput-properties.h` 的 `/usr/include/xorg`。

## 作为 Gentoo user patch 验证

初次验证时没有直接改 Portage 展开的临时源码，而是使用 Gentoo user patch。该临时补丁未收进公开 dotfiles，因此这里只给出当时的目录规则，不伪造仓库链接：

```text
/etc/portage/patches/<category>/<package>-<version>/
```

对应本例可按实际被安装的版本放置，例如：

```text
/etc/portage/patches/sonicde-base/sonic-desktop-<version>/
```

文件名只要以 `.patch` 结尾并位于 Portage 对该包识别的 user-patch 目录中即可。版本和实际原子应以当次 `emerge` 输出为准，不应照抄占位符。相关的编译环境与 USE 配置可对照 dotfiles 中的 [`package.env/sonicde`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.env/sonicde) 和 [`package.use/sonicde`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/sonicde)。

应用补丁后重新进行完整 `emerge`，`sonicde-base/sonic-desktop-6.7.3.2` 成功编译并安装；成功结果也反馈给了维护者。这里的验证链条是完整构建成功，而不只是单独编译某个源文件。

维护者随后把补丁加入 overlay，并说明本地 user patch 已经可以删除；[issue #15](https://github.com/sonicde-gentoo/portage/issues/15) 也以 completed 状态关闭，同时再次感谢问题报告。因此，上面的 user-patch 流程是这次修复进入 overlay 之前的验证记录。读者更新到包含该修复的 overlay 后，不应继续重复保留同一补丁；只有旧版本仍未包含修复时，才需要按实际包版本判断是否临时应用。

## 小结

这次问题最有价值的区别是：

```text
missing header package       ×
missing target dependency    ✓
```

遇到类似 CMake 报错时，如果文件存在、`pkg-config` 正常、configure 阶段也已找到依赖，就应该继续比较失败 target 与正常 target 的 include/link 元数据。重新安装已经存在的包不会补上构建系统中遗漏的 target 关系。
