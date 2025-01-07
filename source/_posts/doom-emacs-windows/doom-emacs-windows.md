---
title: Doom Emacs Windows安装
comments: true
toc: true
donate: true
share: true
date: 2025-01-07 11:42:15
categories: 段落摘抄
tags:
- 摘抄
---
# Doom Emacs 实用命令

原文来自[Installing Doom Emacs on Windows - DEV Community](https://dev.to/scarktt/installing-doom-emacs-on-windows-23ja)，现在对其中的命令进行一些整理。

## 原生命令

来自[doomemacs/docs/getting_started.org at master · doomemacs/doomemacs](https://github.com/doomemacs/doomemacs/blob/master/docs/getting_started.org#the-bindoom-utility)

1. Don't forget to run 'doom sync' and restart Emacs after modifying init.el or
   packages.el in ~/.config/doom. This is never necessary for config.el.
2. If something goes wrong, run `doom doctor` to diagnose common issues with
   your environment, setup, and config.
3. Use 'doom upgrade' to update Doom. Doing it any other way will require
   additional steps (see 'doom help upgrade').
4. Access Doom's documentation from within Emacs via 'SPC h d h' or 'C-h d h'
   (or 'M-x doom/help').

## 适用于Windows的命令——整理版

USER=users文件夹里**你的用户名**

mklink /j "C:\Users\USER\\.emacs.d" "C:\Users\USER\AppData\Roaming\\.emacs.d"

```shell
git clone https://github.com/doomemacs/doomemacs C:\Users\USER\AppData\Roaming\\.emacs.d
```

```shell
cd C:\Users\USER\AppData\Roaming\\.emacs.d

.\bin\doom install

.\bin\doom sync

.\bin\doom doctor

.\bin\doom upgrade

.\bin\doom up
```

*P.S.* 后续在C:\Users\USER\\.emacs.d执行"**.\bin\*doom**"之类的命令即可
