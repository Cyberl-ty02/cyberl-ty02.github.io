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
本文用于存储部分软件的配置文件,，更多文件详见[此仓库](https://github.com/Cyberl-ty02/dotfiles)

## doas.conf

```bash
# Do not require passwords for five minutes for all users in the wheel group
permit persist :wheel

# Allow a user to use the reboot command without a password
permit nopass kl cmd reboot
permit nopass kl cmd shutdown
permit nopass kl cmd eix-sync
```

## wsl.conf([参见这里](https://wiki.gentoo.org/wiki/Gentoo_in_WSL))

```ini
[boot]
# https://learn.microsoft.com/en-us/windows/wsl/wsl-config#boot-settings
# Set a command to run when a new WSL instance launches.
# To enable systemd, if the system Gentoo profile supports it, uncomment the following line:
# systemd = true
# Additional commands. e.g. Run OpenRC:
command = /sbin/openrc default
```

## .zimrc

```bash
# Install p10k theme
zmodule romkatv/powerlevel10k
```

## .zshrc

```bash
# For using github
proxy () {
        export https_proxy="http://127.0.0.1:2080"
        export http_proxy="http://127.0.0.1:2080"
        export all_proxy="sock5://127.0.0.1:2080"
        echo "HTTP Proxy on: 127.0.0.1"
}

nproxy () {
    unset http_proxy
    unset https_proxy
    unset all_proxy
    echo "HTTP Proxy off"
}
```
