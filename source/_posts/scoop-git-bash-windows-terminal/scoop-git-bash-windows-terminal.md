---
title: 为 winget Git 配置 Windows Terminal，并让 Git Bash 正确启动 Doom Emacs
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

这篇文章最初记录 Scoop Git 的 Windows Terminal profile。2026-10-17 重新核验时，当前 Windows 已改用 winget 安装的 Git for Windows，Scoop Git 已移除；Scoop 仍可继续管理其他工具，但不再承担 Git。

目前的结论是：Windows Terminal 使用独立 Fragment 添加 Git Bash 与 Gruvbox 配色，主 `settings.json` 只增量合并少量偏好；Git Bash 中的 Doom Emacs 则通过 `~/.local/bin` 包装器启动，避免 POSIX 风格 `HOME` 干扰原生 Windows 的 AppData 布局。

## 当前路径与核验

当前 Git Bash 与图标路径为：

```text
%ProgramFiles%\Git\bin\bash.exe
%ProgramFiles%\Git\mingw64\share\git\git-for-windows.ico
```

路径可能随安装方式或 Git for Windows 版本变化。写入 Terminal 配置前，先在 PowerShell 中检查当前机器：

```powershell
Get-Command git

$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
$icon = Join-Path $env:ProgramFiles 'Git\mingw64\share\git\git-for-windows.ico'

Test-Path -LiteralPath $bash
Test-Path -LiteralPath $icon
```

当前使用 `%ProgramFiles%`，不是旧 Scoop 目录。如果图标不存在，可以先省略 `icon`；不要因为一个可选图标路径失效就覆盖整份 Terminal 配置。

## 使用独立的 Windows Terminal Fragment

当前 dotfiles 中的 [Fragment](https://github.com/Cyberl-ty02/dotfiles/blob/main/windows_setting/AppData/Local/Microsoft/Windows%20Terminal/Fragments/dotfiles/dotfiles.json) 位于：

```text
%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\dotfiles\dotfiles.json
```

文件内容如下，profile 的路径、GUID、名称与 Gruvbox 配色均来自当前实际配置：

```json
{
  "profiles": [
    {
      "commandline": "\"%ProgramFiles%\\Git\\bin\\bash.exe\" --login -i",
      "guid": "{5b8b2d9f-5655-4d9a-a427-cf494de4e17a}",
      "hidden": false,
      "icon": "%ProgramFiles%\\Git\\mingw64\\share\\git\\git-for-windows.ico",
      "name": "Git Bash",
      "startingDirectory": "%USERPROFILE%"
    }
  ],
  "schemes": [
    {
      "background": "#282828",
      "black": "#282828",
      "blue": "#458588",
      "brightBlack": "#928374",
      "brightBlue": "#83A598",
      "brightCyan": "#8EC07C",
      "brightGreen": "#B8BB26",
      "brightPurple": "#D3869B",
      "brightRed": "#FB4934",
      "brightWhite": "#EBDBB2",
      "brightYellow": "#FABD2F",
      "cursorColor": "#EBDBB2",
      "cyan": "#689D6A",
      "foreground": "#EBDBB2",
      "green": "#98971A",
      "name": "GruvboxDark",
      "purple": "#B16286",
      "red": "#CC241D",
      "selectionBackground": "#665C54",
      "white": "#A89984",
      "yellow": "#D79921"
    }
  ]
}
```

Fragment 由 Windows Terminal 自动合并，因此不需要在主 `settings.json` 中维护完整的 `profiles.list`。dotfiles 的 [偏好合并脚本](https://github.com/Cyberl-ty02/dotfiles/blob/main/windows_setting/.chezmoiscripts/run_after_merge-windows-terminal-settings.ps1.tmpl) 只更新复制行为、默认 profile、主题、profile defaults 和几项快捷键，并移除早期由 dotfiles 写入主配置的旧 Git Bash/Gruvbox 副本。

Azure、Visual Studio、WSL 和其他软件生成的 profile 仍由本机维护，不会被 Fragment 或增量脚本整份覆盖。

## 为什么使用 `bin\bash.exe --login -i`

Fragment 的启动命令是：

```text
"%ProgramFiles%\Git\bin\bash.exe" --login -i
```

`git-bash.exe` 更像启动器，通常会建立独立的 Mintty 窗口；Windows Terminal profile 需要的是在当前终端窗格内运行的 shell，因此直接调用 `bin\bash.exe`。

其中 `--login` 让 Bash 加载登录配置，`-i` 表示交互模式。这样 `~/.bash_profile` 中的 PATH、编辑器变量和 Doom 包装函数才能按预期加载。

## 从 Git Bash 启动 Doom Emacs

Git Bash 会设置 POSIX 风格的 `HOME`，但原生 Windows Emacs/Doom 的当前布局位于 `%APPDATA%`。因此 Bash profile 不应直接裸跑 `emacs.exe`，而是把 `%USERPROFILE%\.local\bin` 加入 PATH，再通过包装器调用：

```bash
if command -v doom-editor.cmd >/dev/null 2>&1; then
    export EDITOR=doom-editor.cmd VISUAL=doom-editor.cmd GIT_EDITOR=doom-editor.cmd
    doom() { doom.cmd "$@"; }
    alias e=doom-emacs.cmd
fi
```

`doom.cmd` 只在自身进程中清除 Bash 传入的 `HOME`，并调用 `%APPDATA%\.emacs.d\bin\doom.ps1`。终端编辑器与 GUI 包装器在没有现成 server 时分别转发到：

```text
doom.cmd emacs -- -nw
doom.cmd emacs --
```

这样 Doom CLI 会为框架补充正确的 `--init-directory`。直接在 Git Bash 中运行裸 `emacs.exe -nw` 可能只显示 GNU Emacs 默认欢迎页，而不是 Doom。

可以在 Git Bash 中做只读核验：

```bash
type doom
type doom-editor
type git
doom --version
```

更完整的启动、环境快照和字体排查见站内文章：[Doom Emacs 安装、同步与清理](/posts/doom-emacs-windows/doom-emacs-windows/)。

## 历史方案：Scoop Git

早期版本使用 Scoop Git，并分别处理用户级、全局安装目录和 `ucrt64` 图标路径。这些内容只适用于当时的安装，已经不是当前配置。迁移后应避免同时保留 winget Git 与 Scoop Git，否则可能出现重复可执行文件、不同 Bash 运行时和 PATH 顺序歧义。

## 小结

当前方案使用 winget 提供完整的 Git for Windows，Terminal Fragment 只管理自有 Git Bash profile 与 Gruvbox 配色，偏好脚本则对主配置做有限的增量合并。Git Bash 通过 `doom.cmd`、`doom-editor.cmd` 和 `doom-emacs.cmd` 进入 AppData 中的 Doom，而不是依赖 Bash 的 `HOME` 或直接启动裸 Emacs。

这种分层既保留 Windows Terminal 自动生成的 profile，也避免 Scoop Git 与 winget Git 并存造成的 PATH 歧义。
