---
title: 如何提高AUR部分软件编译速度
comments: true
toc: true
donate: false
share: true
date: 2025-09-13 18:03:47
categories: 实用技巧
tags:
- 技巧
---
本篇文章将简单记录AUR (Arch User Repository)的一些优化事项，方便在WSL优化调整。

## 多线程优化

这个部分主要介绍使用多线程编译大型软件(比如AUR里的第三方内核)

```bash
nano /etc/makepkg.conf #进入编译设置文件
```

注意，以下部分参数可以从Arch wiki里的[makepkg相关文档](https://wiki.archlinux.org/title/Makepkg)中找到

```bash
# 自动使用计算机最多线程数编译，处理器较老建议改为“-j4"之类的小数字,否则容易内存溢出
MAKEFLAGS="-j$(nproc)"

# 允许根据计算机架构进行优化，特别是"-march=native"
CFLAGS="-march=native -O2 -pipe ..."

# 优化Rust编译, 特别是新增"-C target-cpu=native"部分
RUSTFLAGS="... force-frame-pointers=yes -C target-cpu=native"

# 以下命令需额外安装部分软件: pigz,pbzip2和plzip,优化压缩指令
COMPRESSZST=(zstd -c -T0 --auto-threads=logical -)
COMPRESSGZ=(pigz -c -f -n)
COMPRESSBZ2=(pbzip2 -c -f)
COMPRESSLZ=(plzip -c -f)
```


## 小结

通过查阅相关文档，加速了aur包编译速度，更充分的利用计算机的性能
