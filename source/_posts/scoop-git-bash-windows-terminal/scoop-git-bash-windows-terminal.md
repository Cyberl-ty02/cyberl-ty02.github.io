---
title: 为 Scoop 版 Git 添加 Windows Terminal 的 Git Bash 配置
comments: true
toc: true
donate: true
share: true
date: 2026-06-17 18:55:00
categories: 实用技巧
tags:
- 技巧
---
在 Windows 上，我更倾向使用 Scoop 安装 Git，而不是直接使用官方 exe 安装包：

```powershell
scoop install git
```

这样做的好处是安装、更新、卸载都比较干净。不过它也有一个小差异：官方 Git for Windows 安装包通常会自动在 Windows Terminal 中添加 **Git Bash** 配置文件，而 Scoop 安装的 Git 不一定会自动添加。

所以，如果想在 Windows Terminal 的下拉菜单中直接打开 Git Bash，就需要手动添加一个 profile。

## 确认 Scoop Git 的安装路径

先在 PowerShell 中执行：

```powershell
scoop prefix git
```

如果是普通用户安装，通常路径类似：

```text
%USERPROFILE%\scoop\apps\git\current
```

如果是全局安装，则可能是：

```text
C:\ProgramData\scoop\apps\git\current
```

实际写 Windows Terminal 配置时，普通用户安装可以用 `%USERPROFILE%` 代替真实用户名，这样更干净，也更适合写进笔记：

```text
%USERPROFILE%\scoop\apps\git\current
```

## 打开 Windows Terminal 配置文件

打开 Windows Terminal，进入：

```text
设置 -> 打开 JSON 文件
```

找到类似下面的位置：

```json
"profiles": {
  "list": [
    ...
  ]
}
```

然后在 `list` 数组中添加一个新的配置对象。

## 普通 Scoop 用户安装版配置

如果 Git 安装在用户目录下，可以添加：

```json
{
  "guid": "{d1f2a8c5-6b7e-4f9a-9c2e-8a7b3f6d9012}",
  "name": "Git Bash (Scoop)",
  "commandline": "\"%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe\" --login -i",
  "startingDirectory": "%USERPROFILE%",
  "icon": "%USERPROFILE%\\scoop\\apps\\git\\current\\mingw64\\share\\git\\git-for-windows.ico",
  "hidden": false
}
```

保存后重启 Windows Terminal，就可以在下拉菜单中看到：

```text
Git Bash (Scoop)
```

这里使用 `current` 目录的好处是，后续 Git 更新时它会继续指向当前版本，一般不需要频繁修改 Windows Terminal 配置。

## 全局 Scoop 安装版配置

如果 Git 是通过全局 Scoop 安装的，路径可能在：

```text
C:\ProgramData\scoop\apps\git\current
```

那么可以改成：

```json
{
  "guid": "{9a0cfae1-3318-4a6e-a7c7-61f8f8f4c21b}",
  "name": "Git Bash (Scoop Global)",
  "commandline": "\"C:\\ProgramData\\scoop\\apps\\git\\current\\bin\\bash.exe\" --login -i",
  "startingDirectory": "%USERPROFILE%",
  "icon": "C:\\ProgramData\\scoop\\apps\\git\\current\\mingw64\\share\\git\\git-for-windows.ico",
  "hidden": false
}
```

## 为什么不用 git-bash.exe

一开始可能会想到直接调用：

```text
git-bash.exe
```

但在 Windows Terminal 中，更推荐直接调用：

```text
bin\bash.exe --login -i
```

原因是 `git-bash.exe` 更像一个启动器，可能会拉起独立的 Mintty 窗口；而 `bash.exe --login -i` 更适合作为 Windows Terminal 的 shell profile。

其中：

```text
--login
```

表示以登录 shell 启动。

```text
-i
```

表示交互模式。

这样启动后的体验更接近正常的 Git Bash。

## 最小可用配置

如果图标路径出问题，可以先删掉 `icon` 字段，只保留最小配置：

```json
{
  "guid": "{d1f2a8c5-6b7e-4f9a-9c2e-8a7b3f6d9012}",
  "name": "Git Bash (Scoop)",
  "commandline": "\"%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe\" --login -i",
  "startingDirectory": "%USERPROFILE%"
}
```

这样也可以正常启动 Git Bash。

## 小结

Scoop 版 Git 本身没有问题，只是没有像官方 exe 安装包那样自动帮 Windows Terminal 注册 Git Bash profile。

手动添加后，核心配置其实就是：

```json
"commandline": "\"%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe\" --login -i"
```

这个方案比较干净，也符合 Scoop 的使用习惯。后续 Git 更新时，`current` 目录会自动指向当前版本，通常不需要再改配置。
