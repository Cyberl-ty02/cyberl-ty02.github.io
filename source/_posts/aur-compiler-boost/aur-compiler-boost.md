---
title: 如何提高 AUR 部分软件编译速度
comments: true
toc: true
donate: false
share: true
date: 2025-09-13 18:03:47
categories: 实用技巧
tags:
- 技巧
---
本篇文章简单记录 AUR（Arch User Repository）软件包编译时的一些优化事项，主要用于在 WSL 环境中提高编译效率。

## 多线程优化

这一部分主要介绍如何调整 `makepkg` 配置，让 AUR 包在编译大型软件时使用多线程，例如 AUR 中的 `xanmod-lts` 内核。

```bash
nano /etc/makepkg.conf #进入编译设置文件
```

注意，以下部分参数可以从 Arch Wiki 的 [makepkg 相关文档](https://wiki.archlinux.org/title/Makepkg) 中找到。

```bash
# 自动使用计算机最多线程数编译。处理器较老或内存较小时，建议改为 "-j4" 之类的小数字，否则容易内存溢出
MAKEFLAGS="-j$(nproc)"

# 允许根据计算机架构进行优化，特别是 "-march=native" 和 GCC 的 "-Os" 优化
CFLAGS="-march=native -Os -pipe ..."

# 优化 Rust 编译，特别是新增 "-C target-cpu=native" 部分
RUSTFLAGS="... force-frame-pointers=yes -C target-cpu=native"

# 以下命令需额外安装部分软件：pigz、pbzip2 和 plzip，用于优化压缩指令
COMPRESSZST=(zstd -c -T0 --auto-threads=logical -)
COMPRESSGZ=(pigz -c -f -n)
COMPRESSBZ2=(pbzip2 -c -f)
COMPRESSLZ=(plzip -c -f)
```

## 小结

通过查阅相关文档并调整 `makepkg` 配置，可以加快 AUR 包的编译速度，更充分地利用计算机性能。
