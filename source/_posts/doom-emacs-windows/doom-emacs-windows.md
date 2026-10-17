---
title: Doom Emacs 安装、同步与清理
comments: true
toc: true
donate: false
share: true
date: 2025-01-07 11:42:15
categories: 开发工具
tags:
- Linux
- 开发工具
---

这篇文章最初只整理 Windows 下的 Doom Emacs 命令，后来曾因主力编辑器切换而归档。2026-10-17 重新核验后，Gentoo PC 与 Windows 都已经完成 Doom Emacs 部署；Gentoo WSL 当前没有安装，仓库中的 WSL 配置只保留作以后重建的输入。本文分别记录 Linux XDG 布局与 Windows AppData 布局，不把其中一套目录规则套到另一套系统。

> **当前核验状态（2026-10-17）**
> Gentoo PC 安装 `app-editors/emacs-31.1-r2`，框架位于 `~/.config/emacs`，私人配置位于 `~/.config/doom`。Windows 使用 Scoop Emacs 31.1 与 Doom 2.2.4，框架位于 `%APPDATA%\.emacs.d`，私人配置入口位于 `%APPDATA%\.config\doom`，后者是指向 dotfiles `dot_config\doom` 的目录联接。两端框架 origin 都是官方 `https://github.com/doomemacs/core`。Windows 已通过 `doom sync --env`、`doom doctor` 和 `early-init.el` 完整加载核验；doctor 剩余的 native compilation、fontconfig、Windows symlink、Markdown 编译器与 shellcheck 提示属于可选能力，不表示框架安装失败。版本号和路径只是本次机器快照。

## 当前目录边界

Gentoo 使用 XDG 路径：

```text
~/.config/emacs   Doom 框架、包、生成状态与 bin/doom
~/.config/doom    可审阅的私人配置
~/.local/share    可能存在的 Doom/Emacs 用户数据
~/.local/state    可能存在的 Emacs 运行状态
~/.cache/emacs    可重新生成的缓存
```

Windows 不设置全局 `EMACSDIR` 或 `DOOMDIR`，也不永久覆盖用户的 `HOME`。框架和私人配置仍使用 AppData 布局，但启动时必须经过 Doom 的 profile 入口，由 `doom emacs` 为当前框架补充正确的 `--init-directory`：

```text
%APPDATA%\.emacs.d       Doom 框架、包与生成状态
%APPDATA%\.config\doom  指向 dotfiles\dot_config\doom 的目录联接
%USERPROFILE%\.local\bin  Doom 命令与编辑器包装器
```

dotfiles 只维护 `~/.config/doom` 中的 `init.el`、`config.el`、`custom.el`、`packages.el` 和说明文件。普通用户与 root 使用同一份经过审阅的私有配置内容，但部署后分别由各自账户拥有；Doom 框架、插件 checkout、缓存和生成状态也各自独立，root 不会执行普通用户可改写的目录。

这也解释了目录大小的差异。2026-10-13 的真机快照中，私有配置约 20 KiB，普通用户的 Doom 框架和插件约 424 MiB；前者适合进入 Git，后者数百 MiB 属于可重建状态，不应连同编译缓存一起同步。

## 在 Gentoo 中部署

当前 PC world、仓库保留的 WSL world 快照与 `manifests/core.txt` 都选择 `app-editors/emacs`。这里的 WSL 文件只表示未来重建选择，不表示当前存在可运行的 WSL。Gentoo 安装 Emacs 后，在 dotfiles 根目录运行：

```bash
gentoo_setting/scripts/deploy-doom.sh
```

脚本会把已审核的私人配置部署到 `~/.config/doom`。如果 `~/.config/emacs` 尚不存在，它会从 `doomemacs/core` 浅克隆 Doom；如果路径已经存在但不是 Git checkout，或 origin 是无法识别的个人 fork，脚本会拒绝覆盖。旧的 `doomemacs/doomemacs` 与 `hlissner/doom-emacs` origin 会迁移到当前官方地址。

需要为 root 建立完全独立的框架、包和状态时：

```bash
gentoo_setting/scripts/deploy-doom.sh --root
```

升级 Doom 自身及其管理的包后再同步：

```bash
gentoo_setting/scripts/deploy-doom.sh --upgrade
```

不要让 root 直接加载普通用户可写的 `~/.config/emacs` 或 `~/.config/doom`。

root 初次恢复时曾因为私有配置没有完整部署——包括缺少 `custom.el` 或同步未完成——导致启动页与普通用户不一致。当前脚本会复制并逐个比较全部受管文件，再运行 `doom sync --env`；这次问题已经通过重新部署解决，不应继续描述成 Doom 插件安装失败。自定义行为只放在私有配置层，不直接修改 `~/.config/emacs` 中的上游框架。

## 日常命令

修改 `init.el` 或 `packages.el` 后运行：

```bash
doom sync
```

排查配置与外部工具：

```bash
doom doctor
```

跟随 Doom 上游并更新其管理的包：

```bash
doom upgrade
```

当前配置使用 Doom One、Evil、Corfu、Vertico、Magit、Org、Markdown 与 shell 模块。终端编辑缓冲区继承终端背景，但 GUI frame 与 dashboard 保留主题背景；机器身份和本机私有路径不写进共享配置。

从 Neovim 保留下来的通用习惯——相对行号、分屏方向、回收站删除和少确认提示等——已经改写为 Emacs Lisp。Linux 目标配置不再依靠一份 Neovim 中间层维持映射关系。

### 如何理解 `doom doctor` 提示

`doom doctor` 会同时检查 Doom、启用模块和外部命令。Symbola 字体、Markdown 编译器、`shellcheck` 缺失或 `PATH changed` 一类提示，应按对应功能判断是否需要处理；它们不等同于 Doom 框架或插件没有安装。真正的同步检查仍包括：

```bash
git -C ~/.config/emacs remote get-url origin
doom sync --env
doom doctor
emacs --batch --eval \
  '(message "user-emacs-directory=%s" user-emacs-directory)'
```

## 完整清理

下面的命令会永久删除文件。先关闭所有 Emacs/Doom 进程，并确认没有未保存的 buffer。框架和缓存可以重建，`~/.config/doom` 或旧的 `~/.doom.d` 却可能包含唯一的私人配置，不能在没有备份时删除。

先列出实际存在的目录：

```bash
ls -ld \
  ~/.config/emacs ~/.config/doom \
  ~/.emacs.d ~/.doom.d \
  ~/.cache/emacs \
  ~/.local/share/doom ~/.local/share/emacs \
  ~/.local/state/emacs \
  2>/dev/null
```

### 删除当前 Doom 主程序

当前布局的主程序目录是：

先确认 `realpath -e ~/.config/emacs` 的结果确实位于当前账户的 home，并确认其中没有未提交修改，再使用带一次确认提示的 `rm -rI -- ~/.config/emacs`。这是不可恢复操作；如果输出路径不符合预期，就不要继续。

如果使用的是旧布局，主程序才可能位于：

同样先用 `realpath -e ~/.emacs.d` 核对旧目录，再按实际需要手动删除；不要把 `~/.config/emacs` 与 `~/.emacs.d` 同时当作现行框架目录。

### 删除可重新生成的数据与缓存

不同 Emacs/Doom 版本可能使用其中一部分目录；只删除上一步已经核对过的路径：

逐项用 `realpath -e` 查看目标后，再对确实属于当前账户且可重建的目录使用 `rm -rI -- <已核对的单一路径>`。不要把列表直接交给一条批量递归删除命令。

### 删除私人配置

如果希望以后恢复当前配置，先建立一份不与目标重名的备份：

```bash
test ! -e ~/doom-config-backup && \
  cp -a -- ~/.config/doom ~/doom-config-backup
```

确认备份可读后，才删除当前私人配置：

确认备份后，再对已经核对的 `~/.config/doom` 使用 `rm -rI -- ~/.config/doom`。如果它是符号链接，先用 `readlink` 确认目标；删除链接与删除其目标不是同一件事。

旧环境还可能使用 `~/.doom.d`；同样只有在确认已备份或不再需要时才清理：

先用 `realpath -e ~/.doom.d` 或 `readlink ~/.doom.d` 判断它是目录还是链接，再决定是否删除，不要照抄一条同时覆盖新旧布局的清理命令。

删除这些目录不会从 Gentoo world 移除 Emacs。若还要卸载软件包，应先用 `emerge --deselect app-editors/emacs` 调整显式选择，再预览依赖清理；本文不建议自动执行真实 `depclean`。

## Windows 已完成的部署

Windows 由 Scoop 提供 Emacs 31.1，[`windows_setting/install_doom.ps1`](https://github.com/Cyberl-ty02/dotfiles/blob/main/windows_setting/install_doom.ps1) 负责安装、修复和同步 Doom。首次部署在 dotfiles 根目录运行：

```powershell
.\windows_setting\install_doom.ps1
```

脚本会核验 `dot_config\doom` 的受管文件，按需克隆官方 `doomemacs/core` 到 `%APPDATA%\.emacs.d`，并把 `%APPDATA%\.config\doom` 联接到仓库中的私人配置。日常拉取 dotfiles 变更后再次运行同一命令即可同步；`-SkipSync` 只适用于离线调整联接或 origin、明确不希望执行 `doom sync` 的场景，`-Upgrade` 则用于主动跟随 Doom 框架及其管理的包，不应混入每次普通同步。

chezmoi 还部署三个位于 `~/.local/bin` 的包装器：

- `doom.cmd` 只在自身进程内清除 Git Bash 传入的 `HOME`，再调用 `%APPDATA%\.emacs.d\bin\doom.ps1`；
- `doom-editor.cmd` 优先在当前终端连接 Emacs server；没有 server 时调用 `doom.cmd emacs -- -nw`；
- `doom-emacs.cmd` 优先建立 GUI client frame；没有 server 时调用 `doom.cmd emacs --`。

PowerShell 和 Git Bash 把 `doom-editor.cmd` 用作 `EDITOR`、`VISUAL` 与 `GIT_EDITOR`；Git 的 `core.editor` 也指向它。Yazi 的 `edit` opener 使用终端包装器，PowerShell/Git Bash 中的 `e` 则使用 GUI 包装器。这样可以共享入口，但不会把 Linux 的框架、包 checkout 或缓存复制到 Windows。

### 三类现象不要混在一起

Windows 上遇到启动或显示异常时，可以先按界面特征区分：

- 出现 GNU Emacs 默认欢迎页：Doom profile 没有被正确引导；
- Doom 已经加载，但 Backtrace 报 `Could not run Git` 或 `Searching for program: No such file or directory, git`：Doom 的环境快照仍保存旧 `PATH`；
- modeline 出现 `0F0C`、`0F3E` 一类十六进制方块：当前字体缺少 Nerd Font 私用区 glyph，不是文本编码损坏。

这三类问题分别属于启动入口、环境快照和字体，不能用同一条“重装 Doom”结论代替排查。

### 为什么必须经过 `doom emacs`

Doom 2.2.4 与 Emacs 31.1 的当前组合中，直接运行裸 `emacs.exe` 或 `emacs.exe -nw`，可能只进入原生 GNU Emacs，而没有加载 Doom profile。`doom emacs` 会为这份 Doom 框架补充正确的 `--init-directory`，因此包装器在没有可连接的 server 时也必须继续通过 Doom CLI 启动，而不是退回裸 Emacs。

Git Bash 会设置 POSIX 风格的 `HOME`，原生 Windows Emacs/Doom 则使用 AppData 布局。`doom.cmd` 因而使用 `setlocal`，只在包装器进程及其子进程中清除 `HOME`；不要在系统环境变量、PowerShell profile 或 Bash profile 中全局删除、永久覆盖用户的 `HOME`。

### 刷新过期的 Doom 环境快照

Doom 生成的 `05-doom-env.load.el` 可能保存旧 `PATH`。从 Scoop Git 迁移到 winget 安装的 Git for Windows 后，即使系统 `PATH` 已经更新，旧 Emacs 进程中的 Magit 仍可能找不到 `git`。

Doom 2.2.4 不应再使用旧式、不带输出文件参数的 `doom env`。先在当前 PowerShell 中确认 Git 和相关路径：

```powershell
Get-Command git
$env:Path -split ';' | Where-Object { $_ -match 'Git|pnpm' }
```

当前快照应包含 `C:\Program Files\Git\cmd`，并且不再残留旧 Scoop Git 或已经退役的 pnpm 路径。确认当前用户与机器的 `PATH` 正确后刷新环境：

```powershell
doom sync --env
doom doctor
```

包装器会在自己的进程中补充 `%ProgramFiles%\Git\cmd`，避免父进程尚未刷新机器 `PATH` 时立即失败；但持久环境仍应在当前机器上核验，不能长期依赖这一层兜底。

### 修复 modeline 字体方块

`0F0C`、`0F3E` 等方块对应 Nerd Font 私用区字符缺字。当前 Windows 已安装 `IntoneMono NFM`，共享 Doom 配置通过 `doom-font` 在 GUI frame 中显式选择该字体。

修改字体或启动配置后，应完全关闭旧 Emacs server、GUI frame 和终端实例，再重新启动。已经运行的 Emacs 进程不会自动重新执行启动配置，仅新建一个 client frame 也不一定能验证改动。

### 日常核验

PowerShell 中可以检查：

```powershell
doom --version
doom doctor
doom sync --env
Get-Command git
```

Git Bash 中确认函数与终端编辑器包装器已经加载：

```bash
type doom
type doom-editor
doom --version
```

这里不依赖内部 Lisp 变量判断 Doom 版本；`doom --version` 与实际启动结果更适合作为日常核验入口。

Windows Neovim 配置、数据和临时缓存已经清理，`dot_config/nvim` 与 `windows_setting/install_nvim.ps1` 也已从 dotfiles 删除。这里只说明配置退役，不据此声称 Neovim 程序本体已经卸载。

### Windows 清理前的边界

Windows 的私人配置路径是目录联接。任何删除前先关闭 Emacs，列出路径并检查联接目标：

```powershell
$paths = @(
  "$env:APPDATA\.emacs.d"
  "$env:APPDATA\.config\doom"
)
Get-Item -LiteralPath $paths -Force -ErrorAction SilentlyContinue |
  Format-List FullName, Attributes, LinkType, Target
```

只有 `%APPDATA%\.config\doom` 的 `Target` 明确指向当前 dotfiles 的 `dot_config\doom` 时，才能把它当作可重建联接处理；不要对联接目标执行递归删除。`%APPDATA%\.emacs.d` 可能包含尚未同步的框架修改，删除不可恢复，必须先检查 `git status` 并单独备份需要保留的内容。

## 参考

- [Doom Emacs Getting Started](https://github.com/doomemacs/core/blob/master/docs/getting_started.org)
- [Doom Emacs FAQ](https://github.com/doomemacs/core/blob/master/docs/faq.org)
- [dotfiles：Doom Emacs configuration](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_config/doom/README.md)
- [dotfiles：deploy-doom.sh](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/scripts/deploy-doom.sh)
- [dotfiles：Windows Doom installer](https://github.com/Cyberl-ty02/dotfiles/blob/main/windows_setting/install_doom.ps1)
