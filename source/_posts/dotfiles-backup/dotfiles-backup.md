---
title: 配置文件备份
comments: true
toc: true
donate: true
share: true
date: 2025-01-07 11:43:31
categories: 段落摘抄
tags:
- 摘抄
---

本文保留几份常用配置片段。当前维护中的完整配置以 [Cyberl-ty02/dotfiles](https://github.com/Cyberl-ty02/dotfiles) 仓库为准；下方每节标题直接指向对应文件。部分片段自 2025 年初写下后已经与当前配置不同，相关位置会明确标为历史或最小示例。

## [`doas.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/doas_dot_conf)

当前文件仍保留 wheel 组的 `persist`，并允许指定用户免密码执行重启与关机。早期片段还曾免密开放 `eix-sync`；当前配置已经把这一行注释，因此下面同步为现状：

```conf
# Do not require passwords for five minutes for all users in the wheel group
permit persist :wheel

# Allow a user to use the reboot command without a password
permit nopass kl cmd reboot
permit nopass kl cmd shutdown
# permit nopass kl cmd eix-sync
```

用户名属于本机策略，复制前应改成自己的账户或使用更合适的规则。

## [`wsl.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/wsl/wsl.conf)

当前维护的是 Gentoo OpenRC WSL 环境使用的 [`/etc/wsl.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/wsl/wsl.conf)。它保持 WSL 启动简单，不默认拉起完整 OpenRC，并明确配置 automount、interop、用户和网络行为：

```ini
[boot]
systemd = false
# command = /sbin/openrc default

[automount]
enabled = true
root = /mnt/
options = "metadata,umask=22,fmask=11"
mountFsTab = false

[interop]
enabled = true
appendWindowsPath = false

[user]
default = kl

[network]
generateHosts = true
generateResolvConf = true
```

公开模板中的用户名仍应按本机情况修改。WSL/Gentoo 的通用说明可参考 [Gentoo Wiki 的 Gentoo in WSL 文档](https://wiki.gentoo.org/wiki/Gentoo_in_WSL)，各字段语义则见 [Microsoft WSL 配置文档](https://learn.microsoft.com/windows/wsl/wsl-config)。

## [`.zimrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zimrc)

最初文章只记录了 Powerlevel10k：

```zsh
zmodule romkatv/powerlevel10k
```

这行仍存在，但当前 [`.zimrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zimrc) 还加载 environment、git、completion、syntax highlighting、history substring search 和 autosuggestions 等模块。因此这里的单行内容只是历史最小片段，不等同于完整现行文件。

## [`.zshrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zshrc)

早期版本把地址和端口直接写进函数。当前 [`.zshrc`](https://github.com/Cyberl-ty02/dotfiles/blob/main/dot_zshrc) 允许通过参数或环境变量覆盖 host、HTTP 与 SOCKS 端口，并同时处理大小写代理变量：

```zsh
proxy() {
    local proxy_host="${1:-${PROXY_HOST:-127.0.0.1}}"
    local http_port="${2:-${PROXY_HTTP_PORT:-2080}}"
    local socks_port="${3:-${PROXY_SOCKS_PORT:-${http_port}}}"

    export http_proxy="http://${proxy_host}:${http_port}"
    export https_proxy="${http_proxy}"
    export all_proxy="socks5h://${proxy_host}:${socks_port}"
    export HTTP_PROXY="${http_proxy}"
    export HTTPS_PROXY="${https_proxy}"
    export ALL_PROXY="${all_proxy}"
    export no_proxy="${NO_PROXY:-localhost,127.0.0.1,::1}"
    export NO_PROXY="${no_proxy}"
}

nproxy() {
    unset http_proxy https_proxy all_proxy no_proxy
    unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY
}
```

完整函数还包含状态提示，以仓库文件为准。代理地址与端口是本机选择，不应当被理解为通用默认值。
