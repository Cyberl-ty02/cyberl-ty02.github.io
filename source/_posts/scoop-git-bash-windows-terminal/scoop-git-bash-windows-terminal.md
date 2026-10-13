---
title: 为 Scoop 版 Git 添加 Windows Terminal 的 Git Bash 配置
comments: true
toc: true
donate: false
share: true
date: 2026-06-17 18:55:00
categories: Windows
tags:
- Windows
- 开发工具
---
在 Windows 上，我更倾向使用 Scoop 安装 Git，而不是直接使用官方 exe 安装包：

```powershell
scoop install git
```

这样做的好处是安装、更新、卸载都比较干净。不过它也有一个小差异：官方 Git for Windows 安装包通常会自动在 Windows Terminal 中添加 **Git Bash** 配置文件，而 Scoop 安装的 Git 不一定会自动添加。

所以，如果想在 Windows Terminal 的下拉菜单中直接打开 Git Bash，需要补充一个 profile。单机可以手动添加；需要迁移时，更适合使用 Windows Terminal Fragment，让自定义 profile 与系统、Visual Studio、WSL 及其他软件生成的 profile 分开。

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

路径不能只靠“普通安装”或“全局安装”推断。先让 Scoop 返回当前前缀，再检查 Bash 与图标是否真实存在：

```powershell
$gitRoot = scoop prefix git
$bash = Join-Path $gitRoot 'bin\bash.exe'
$icon = Join-Path $gitRoot 'ucrt64\share\git\git-for-windows.ico'

$gitRoot
Test-Path -LiteralPath $bash
Test-Path -LiteralPath $icon
```

2026-10-13 的当前 Scoop Git 使用 `ucrt64\share\git\git-for-windows.ico`，旧的 `mingw64` 路径已经不适用。这个目录仍只是核验快照；其他 Scoop 构建或未来版本可能改变布局。图标不存在时，省略 `icon` 比填写未经核验的路径更稳妥。

实际写 Windows Terminal 配置时，普通用户安装可以用 `%USERPROFILE%` 代替真实用户名，这样更干净，也更适合写进笔记：

```text
%USERPROFILE%\scoop\apps\git\current
```

## 优先使用 Fragment

当前 dotfiles 把 Git Bash profile 与 Gruvbox 配色放在独立的 [Fragment](https://github.com/Cyberl-ty02/dotfiles/blob/main/windows_setting/AppData/Local/Microsoft/Windows%20Terminal/Fragments/dotfiles/dotfiles.json) 中：

```text
%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\dotfiles\dotfiles.json
```

Fragment 由 Windows Terminal 自动合并，不需要维护完整的 `profiles.list`。仓库另用 [chezmoi 脚本](https://github.com/Cyberl-ty02/dotfiles/blob/main/windows_setting/.chezmoiscripts/run_after_merge-windows-terminal-settings.ps1.tmpl) 把 `terminal/preferences.json` 中少量偏好增量写入已有 `settings.json`。Azure、Visual Studio、WSL 以及第三方自动生成的 profile 继续留在本机，不会因同步 dotfiles 被整份覆盖或删除。

这种拆分适合跨机器迁移，但 Fragment 中使用 `%USERPROFILE%\scoop`，所以仍需先运行 `scoop prefix git` 核验安装范围。若实际是全局 Scoop，应为该机器调整命令路径，不能假定 `C:\ProgramData` 永远成立。

## 手动添加单个 profile

不使用 Fragment 时，可以打开 Windows Terminal，进入：

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

然后只在 `list` 数组中添加一个新的配置对象。不要用示例替换整个 `settings.json`，也不要清空看似陌生的自动生成 profile。

### 普通 Scoop 用户安装版配置

如果 Git 安装在用户目录下，可以添加：

```json
{
  "guid": "{d1f2a8c5-6b7e-4f9a-9c2e-8a7b3f6d9012}",
  "name": "Git Bash (Scoop)",
  "commandline": "\"%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe\" --login -i",
  "startingDirectory": "%USERPROFILE%",
  "icon": "%USERPROFILE%\\scoop\\apps\\git\\current\\ucrt64\\share\\git\\git-for-windows.ico",
  "hidden": false
}
```

保存后重启 Windows Terminal，就可以在下拉菜单中看到：

```text
Git Bash (Scoop)
```

这里使用 `current` 目录的好处是，后续 Git 更新时它会继续指向当前版本，一般不需要频繁修改 Windows Terminal 配置。

### 全局 Scoop 安装版配置

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
  "icon": "C:\\ProgramData\\scoop\\apps\\git\\current\\ucrt64\\share\\git\\git-for-windows.ico",
  "hidden": false
}
```

### 为什么不用 git-bash.exe

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

### 最小可用配置

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

Scoop 版 Git 本身没有问题，只是未必像官方 exe 安装包那样自动帮 Windows Terminal 注册 Git Bash profile。当前 dotfiles 使用 Fragment 添加 Git Bash/Gruvbox，并只增量合并少量偏好；手动编辑则适合单机临时配置。

手动添加后，核心配置其实就是：

```json
"commandline": "\"%USERPROFILE%\\scoop\\apps\\git\\current\\bin\\bash.exe\" --login -i"
```

`current` 目录会跟随 Scoop 更新，但其内部的 `ucrt64` 等布局仍可能改变。更新后若图标失效，重新执行 `scoop prefix git` 与 `Test-Path`；无法确认图标时直接省略 `icon`，不要为修复一个图标而覆盖完整 Terminal 配置。
