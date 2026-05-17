---
title: VSCodium 同步插件简单配置
comments: true
toc: true
donate: true
share: true
date: 2026-05-12 18:03:17
categories: 实用技巧
tags:
- 技巧
- ai
---
本文章由ChatGpt协助整理和写作，主要描述了一些使用VSCodium同步设置的问题和解决方法
参考了 VSCodium 迁移/扩展文档、Zokugun Sync Settings 项目说明。

## 为什么使用 Sync Settings？

[VSCodium](https://vscodium.com/) 是 VS Code 的开源二进制构建版本。相比微软版 VS Code，它默认使用 Open VSX 扩展源，因此部分微软专有功能或者扩展可能不完全一致。

如果想在 Windows、Linux、Gentoo、Code-OSS、VSCodium 之间同步配置，可以考虑使用第三方插件。

本文使用的插件为[Sync Settings](https://github.com/zokugun/vscode-sync-settings)：

该插件可以同步：

```text
settings
keybindings
snippets
tasks
extensions
```

并且支持多种同步方式，例如：

```text
local file
local git
remote git
rsync
webdav
```

本文主要记录使用 GitHub remote git 仓库同步的方法。

## 创建 GitHub 同步仓库

首先在 GitHub 创建一个新的私有仓库，例如：

```text
settings
```

假设仓库地址为：

```text
# 实际执行前换成你自己的仓库地址
git@github.com:Cyberl-ty02/settings.git
```

注意，如果仓库是空仓库，可能需要先建立一次初始提交，否则部分同步插件可能无法正常识别 main 分支。

可以在本地执行：

```bash
mkdir -p ~/tmp-vscodium-sync
cd ~/tmp-vscodium-sync

git init -b main
echo "# VSCodium Sync Settings" > README.md

git add README.md
git commit -m "init settings repository"

#注意执行本命令前替换成你自己的用户名
git remote add origin git@github.com:Cyberl-ty02/settings.git
git push -u origin main
```

如果 git 提示没有设置用户名和邮箱，可以先执行：

```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的GitHub邮箱"
```

## 配置 Sync Settings

在 VSCodium 中安装 Sync Settings 插件后，打开命令面板：

```text
Ctrl + Shift + P
```

然后输入：

```text
Sync Settings: Open the repository settings
```

可以写入以下配置：

```yaml
# current machine's name, optional
hostname: "gentoo-legion"

# selected profile, required
profile: main

# sync on remote git
repository:
  type: git
  #注意替换成你自己的用户名
  url: git@github.com:Cyberl-ty02/settings.git
  branch: main
```

如果是在 Windows 上，可以写成：

```yaml
hostname: "windows-legion"

profile: main

repository:
  type: git
  #注意替换成你自己的用户名
  url: git@github.com:Cyberl-ty02/settings.git
  branch: main
```

其中：

```text
hostname
```

主要用于区分不同机器，方便查看提交记录或排查问题。

## GitHub SSH 测试

因为使用的是 [git@github.com](mailto:git@github.com) 形式的 SSH 地址，所以需要提前配置 SSH key。

可以在 VSCodium 内置终端中执行：

```bash
which git
git --version
which ssh
ssh -T git@github.com
#注意执行命令前替换成你自己的用户名
git ls-remote git@github.com:Cyberl-ty02/settings.git
git ls-remote --heads git@github.com:Cyberl-ty02/settings.git main
```

正常情况下，`ssh -T git@github.com` 会显示类似：

```text
Hi Cyberl-ty02! You've successfully authenticated, but GitHub does not provide shell access.
```

如果第一次连接 GitHub，会提示：

```text
The authenticity of host 'github.com (...)' can't be established.
ED25519 key fingerprint is:
SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

确认指纹和 GitHub 官方文档一致后，输入：

```text
yes
```

GitHub 官方 ED25519 指纹为：

```text
SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU
```

之后再次执行：

```bash
git ls-remote git@github.com:Cyberl-ty02/settings.git
```

如果能正常输出 commit hash 和 refs，说明 SSH 和 GitHub 仓库访问基本正常。

## 常见问题

### Host key verification failed

可能报错：

```text
Sync Settings: Error: Host key verification failed.
fatal: Could not read from remote repository.
```

这个通常不是插件本身的问题，而是本机 SSH 还没有信任 GitHub 主机密钥。

解决方法是在 VSCodium 内置终端中执行：

```bash
ssh -T git@github.com
```

然后根据提示输入：

```text
yes
```

如果之前记录过错误的 known_hosts，可以执行：

```bash
ssh-keygen -R github.com
ssh -T git@github.com
```

然后重新确认 fingerprint。

### Permission denied publickey

如果出现：

```text
Permission denied (publickey).
```

说明 GitHub 没有接受当前机器使用的 SSH key。

可以检查本机是否有 SSH key：

```bash
ls -al ~/.ssh
```

如果没有，可以生成：

```bash
ssh-keygen -t ed25519 -C "你的GitHub邮箱"
```

然后查看公钥：

```bash
cat ~/.ssh/id_ed25519.pub
```

把输出内容添加到 GitHub：

```text
GitHub -> Settings -> SSH and GPG keys -> New SSH key
```

如果有多把 key，可以检查 SSH 实际使用了哪一把：

```bash
ssh -vT git@github.com
```

重点查看类似下面的输出：

```text
Offering public key: /home/xxx/.ssh/id_ed25519
```

### The repository wasn't successfully initialized

可能报错：

```text
Sync Settings: Error: The repository wasn't successfully initialized so the current operation can't continue. Please check the previous error.
```

这个报错有时只是后续报错，真正原因一般在 previous error 中。

常见原因包括：

```text
1. SSH 之前失败过
2. GitHub 仓库是空仓库
3. main 分支不存在
4. 插件本地缓存的仓库副本初始化失败
5. GUI 启动的 VSCodium 没有拿到 ssh-agent 环境
```

可以先在 VSCodium 内置终端执行：

```bash
ssh -T git@github.com
git ls-remote git@github.com:Cyberl-ty02/settings.git
git ls-remote --heads git@github.com:Cyberl-ty02/settings.git main
```

如果这些命令都有正常输出，建议先执行：

```text
Ctrl + Shift + P
Developer: Reload Window
```

然后再执行：

```text
Sync Settings: Download (repository -> user)
```

如果仍然不行，可以尝试重启 VSCodium。

如果重启后还是失败，可以清理插件缓存。Gentoo / Linux 下可以备份：

```bash
mv ~/.config/VSCodium/User/globalStorage/zokugun.sync-settings \
   ~/.config/VSCodium/User/globalStorage/zokugun.sync-settings.bak
```

然后重新打开 VSCodium，再次确认 repository settings，之后执行：

```text
Sync Settings: Download (repository -> user)
```

### Gentoo 中外部终端正常，但 VSCodium 插件失败

Gentoo / OpenRC / Xfce / KDE 环境中，可能出现外部终端 SSH 正常，但从桌面菜单启动的 VSCodium 没有正确继承 ssh-agent 的情况。

可以先从终端启动 VSCodium 测试：

```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
ssh -T git@github.com
codium
```

然后在这个 VSCodium 窗口中运行：

```text
Sync Settings: Download (repository -> user)
```

如果这样正常，说明主要是 GUI 启动环境没有拿到 ssh-agent。

也可以强制 git 使用指定 key：

```bash
git config --global core.sshCommand "ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes"
```

然后重新测试：

```bash
git ls-remote git@github.com:Cyberl-ty02/settings.git
```

### 第一次同步应该 Upload 还是 Download

如果 GitHub 仓库里已经有整理好的配置，那么新机器第一次应该执行：

```text
Sync Settings: Download (repository -> user)
```

不要先 Upload，否则可能把空配置推送到远程仓库。

推荐流程：

```text
主力机器：Upload
新机器：Download
确认无误后：再根据情况 Upload
```

### VSCodium 和 VS Code 配置目录不同

如果要从微软版 VS Code 迁移到 VSCodium，可以参考 VSCodium 官方迁移文档。

VS Code 用户配置目录：

```text
Windows: %APPDATA%\Code\User
Linux: ~/.config/Code/User
macOS: ~/Library/Application Support/Code/User
```

VSCodium 用户配置目录：

```text
Windows: %APPDATA%\VSCodium\User
Linux: ~/.config/VSCodium/User
macOS: ~/Library/Application Support/VSCodium/User
```

可以手动复制：

```text
settings.json
keybindings.json
snippets
tasks.json
```

也可以在 VS Code 中导出 Profile，再在 VSCodium 中导入。

命令为：

```text
Profiles: Export Profile
Profiles: Import Profile
```

导入后可以将 profile 命名为：

```text
默认
```

## 定时同步设置

Sync Settings 支持通过 crons 定时执行同步任务。

可以打开 VSCodium 的用户设置 JSON：

```text
Ctrl + Shift + P
Preferences: Open User Settings (JSON)
```

添加类似配置：

```json
{
  "syncSettings.confirmSync": true,
  "syncSettings.openOutputOnActivity": true,
  "syncSettings.showFinishAlert": true,
  "syncSettings.showErrorAlert": true,

  "syncSettings.resources": [
    "extensions",
    "keybindings",
    "settings",
    "snippets",
    "tasks"
  ],

  "syncSettings.keybindingsPerPlatform": true,

  "syncSettings.crons": {
    "download": "0 */6 * * *",
    "review": "30 */2 * * *"
  }
}
```

以上配置含义大致为：

```text
download: 每 6 小时自动从远程仓库下载一次
review: 每 2 小时的第 30 分钟检查一次差异
```

我个人更建议先只开启：

```text
download
review
```

而不要一开始就开启自动 upload。

如果确认 Windows 和 Gentoo 的配置都比较稳定，再考虑添加：

```json
"upload": "0 22 * * *"
```

即每天晚上 22:00 自动上传一次。

## 建议忽略的设置

如果 Windows 和 Linux 同步同一套配置，建议忽略部分系统相关设置，例如终端、字体、Python 解释器路径、代理等。

可以添加：

```json
{
  "syncSettings.ignoredSettings": [
    "terminal.integrated.fontFamily",
    "terminal.integrated.defaultProfile.windows",
    "terminal.integrated.defaultProfile.linux",
    "python.defaultInterpreterPath",
    "python.venvPath",
    "window.zoomLevel",
    "http.proxy",
    "remote.SSH.remotePlatform"
  ],
  "syncSettings.keybindingsPerPlatform": true
}
```

原因是这些配置经常与具体系统有关。

例如：

```text
Windows 的 PowerShell / Git Bash
Gentoo 的 zsh / bash
Windows 的 Python venv 路径
Linux 的 Python venv 路径
不同系统的字体名称
不同系统的代理端口
```

如果全部同步，很容易出现 Windows 和 Linux 之间互相污染配置的问题。

## 推荐同步流程

个人建议流程如下：

```text
1. 在主力机器整理好 VS Code / VSCodium 配置
2. 执行 Sync Settings: Upload
3. 在 GitHub 仓库中确认已经生成同步文件
4. 在另一台机器安装插件
5. 配置相同的 repository settings
6. 先测试 ssh -T git@github.com
7. 再执行 Sync Settings: Download
8. 确认配置正常后，再考虑定时 review / download
```

如果后续遇到问题，可以优先检查：

```bash
ssh -T git@github.com
git ls-remote git@github.com:Cyberl-ty02/settings.git
git ls-remote --heads git@github.com:Cyberl-ty02/settings.git main
```

这几个命令能够快速判断是 GitHub SSH 问题，还是 Sync Settings 插件本身的问题。

## 小结

通过 Sync Settings 插件，可以比较方便地在 VSCodium / VSCode-OSS / VS Code 之间同步配置。

本文使用的是：

```text
VSCodium / VSCode-OSS
Zokugun Sync Settings
GitHub private repository
SSH key
Windows 11 + Gentoo Linux
```

整体体验如下：

```text
1. GitHub remote git 方式比较稳定
2. SSH key 配好后跨系统使用较方便
3. 第一次连接 GitHub 时需要确认 fingerprint
4. Gentoo 中如果插件初始化失败，可以先 Reload Window 或清理插件缓存
5. 新机器第一次同步建议 Download，不要直接 Upload
6. 自动同步建议先开启 review/download，不要立刻开启自动 upload
```

相比直接依赖微软版 VS Code 的同步功能，这种方式更适合 VSCodium / VSCode-OSS，也更方便和 GitHub 仓库、坚果云 WebDAV、dotfiles 等个人配置管理方式结合。
