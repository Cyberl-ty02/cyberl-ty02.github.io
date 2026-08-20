---
title: Gentoo 中 Firefox 与 CUDA 安装被旧 LLVM 构建失败阻塞的排查
comments: true
toc: true
donate: true
share: true
date: 2026-08-05 19:45:00
categories: 实用技巧
tags:
- 技巧
---

> **待验证**
> 本文记录的是已确认的故障路径与尚待最终验证的修复方向。LLVM 重新编译、Firefox 源码版和 CUDA Toolkit 是否最终安装成功，仍需补充后续结果。

这次在 Gentoo 上计划安装 Firefox 与 CUDA Toolkit 时，Portage 构建被旧 LLVM slot 阻塞。日志可以证明 LLVM 19 的 32 位构建在 Hexagon 相关代码中失败，但不能证明 Firefox 或 CUDA 自身已经进入编译，更不能简单得出“关闭 Hexagon 一定修好”的结论。

对应的 Portage 配置可以查看 dotfiles 仓库中的 [`package.use/development`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.use/development)、[`package.env/llvm`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/package.env/llvm) 与 [`profile/package.use.force/llvm`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/profile/package.use.force/llvm)。

## 已确认的日志事实

构建日志能够确认：

```text
Portage 尝试安装 llvm-core/llvm-19.1.7:19
构建编译器为 Clang 22.1.8
C++ 标准库为 libc++
正在构建 abi_x86_32
当时大量 LLVM targets 被启用
错误路径进入 Hexagon 相关代码
此前 LLVM 21 也出现过相似的 libc++ 模板报错
```

这些事实说明失败发生在旧 LLVM 的特定构建组合中。它们没有证明：

```text
Firefox 源码已经开始编译
CUDA Toolkit 本体已经开始编译
Hexagon 是唯一根因
LLVM 19 一定由 CUDA 直接依赖
```

Portage 的合并计划可能在目标软件之前先构建依赖或处理 world/rebuild 中的其他包，所以必须继续查看依赖树。

## make.conf 与实际预览不一致

当时 `/etc/portage/make.conf` 已经包含：

```bash
ABI_X86="32 64"
LLVM_TARGETS="NVPTX WebAssembly X86"
```

但 LLVM 19 的 emerge 预览仍显示大量括号化 target，而且 `abi_x86_32` 无法通过普通 `package.use` 关闭。这说明最终配置还受到 profile 层的影响。

## Profile 强制的 32 位 ABI

自定义 profile 中存在类似：

```text
llvm-core/llvm abi_x86_32 abi_x86_64
llvm-core/clang abi_x86_32 abi_x86_64
llvm-runtimes/clang-runtime abi_x86_32 abi_x86_64
llvm-runtimes/compiler-rt abi_x86_32 abi_x86_64
llvm-runtimes/libcxxabi abi_x86_32 abi_x86_64
llvm-runtimes/libcxx abi_x86_32 abi_x86_64
```

仓库中的实际强制项见 [`profile/package.use.force/llvm`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/portage/profile/package.use.force/llvm)。当 flag 被 profile force 后，只在 `/etc/portage/package.use` 写：

```text
llvm-core/llvm:19 -abi_x86_32
```

通常不会产生预期效果。必须先理解 profile 的继承与强制关系。

## 为什么不直接全局关闭 multilib

全局移除 `ABI_X86=32` 虽然可能缩小 LLVM 构建面，却会影响需要 32 位用户空间的 Steam、Wine 或显卡库。这台系统仍有 multilib 使用场景，因此不适合把整个系统改成纯 64 位来绕过一个旧 LLVM slot。

同样，不应为了这次错误直接：

```text
把完整 LLVM/libc++ 工具链切回 GCC/libstdc++
卸载当前主 LLVM 22
删除所有自定义 profile 强制项
把 firefox-bin 当作源码依赖问题已经解决的证明
认定 CUDA Toolkit 必然需要 LLVM 19
```

## 待验证方案一：只解除旧 LLVM 的 32 位 force

> **待验证**
> 这是缩小故障面的候选方案，尚缺少完整重编译结果。

思路是保持系统整体 multilib，只针对旧 LLVM slot 撤销继承的 `abi_x86_32` force，再在 package.use 中关闭该 flag。不要直接修改 `/etc/portage/make.profile` 符号链接指向的仓库 profile 文件；本地覆盖应放在 `/etc/portage/profile/` 中。

具体语法需要结合当前 Portage profile 结构确认。修改后首先运行：

```bash
emerge -pv llvm-core/llvm:19
```

只有预览中 `abi_x86_32` 确实不再启用，才进入重编译。不能因为配置文件写入成功，就假设 Portage 已接受覆盖。

## 待验证方案二：追踪 LLVM targets 来源

全局已经设置 `LLVM_TARGETS="NVPTX WebAssembly X86"`，但预览仍出现更多 target，因此需要搜索所有 Portage 层级：

```bash
grep -RnsE \
  'LLVM_TARGETS|llvm_targets_' \
  /etc/portage \
  /var/db/repos/gentoo/profiles
```

可能来源包括：

```text
仓库 profile 默认值或 force
本地 profile
package.use 文件
依赖根据自身需求拉入的 llvm_targets_* flag
旧配置残留
```

只有找到最终生效来源，才能判断是否应关闭 Hexagon 等无关后端。

## 待验证方案三：检查真实依赖树

先分别预览两个目标包，并查询 LLVM 19 的反向依赖：

```bash
emerge -pvt www-client/firefox
emerge -pvt dev-util/nvidia-cuda-toolkit
equery d llvm-core/llvm:19
```

需要回答的问题包括：

```text
是谁要求保留 LLVM 19
Firefox 是否可以使用当前 LLVM 22
CUDA 是否因为某个 clang USE 或间接依赖拉入旧 slot
LLVM 19 是否只是 world/rebuild 计划中的遗留项
CUDA host compiler 是否可以使用其支持范围内的 GCC
```

如果没有这一步，就无法区分“目标软件的必要依赖”与“系统维护计划顺带重建的旧包”。

## 当前结论

目前可以可靠写下的结论是：

```text
失败发生在 LLVM 19 的 abi_x86_32 构建阶段
错误路径涉及 Hexagon 与新 Clang/libc++ 编译旧 LLVM 的组合
profile force 使普通 package.use 无法关闭 32 位 ABI
缩减旧 slot 的 ABI 或 target 是合理排查方向
最终修复仍需 emerge 预览和完整重编译验证
```

等 LLVM 19、Firefox 源码版和 CUDA Toolkit 的实际结果确认后，再补充成功方案与验证输出，避免把一次合理推断写成既成事实。

关于同一 Gentoo 环境的桌面排错，参见：[Gentoo OpenRC 桌面排错：中文字体、KDE 托盘与 PipeWire](/posts/gentoo-openrc-desktop-troubleshooting/gentoo-openrc-desktop-troubleshooting/)。
