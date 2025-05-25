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
本文用于存储部分软件的配置文件

## ccache.conf

```
# Maximum cache size to maintain
max_size = 4G

# Allow others to run 'ebuild' and share the cache.
umask = 002

# Don't include the current directory when calculating
# hashes for the cache. This allows re-use of the cache
# across different package versions, at the cost of
# slightly incorrect paths in debugging info.
# https://ccache.dev/manual/4.4.html#_performance
hash_dir = false

# Preserve cache across GCC rebuilds and
# introspect GCC changes through GCC wrapper.
#
# We use -dumpversion here instead of -v,
# see https://bugs.gentoo.org/872971.
compiler_check = %compiler% -dumpversion

# Logging setup is optional
# Portage runs various phases as different users
# so beware of setting a log_file path here: the file
# should already exist and be writable by at least
# root and portage. If a log_file path is set, don't
# forget to set up log rotation!
# log_file = /var/log/ccache.log
# Alternatively, log to syslog
# log_file = syslog
log_file = syslogd

# Enable zstd compression
compression = true
compression_level = 1

```

## doas.conf

```bash
# Do not require passwords for five minutes for all users in the wheel group
permit persist :wheel

# Allow a user to use the reboot command without a password
permit nopass kl cmd reboot
permit nopass kl cmd shutdown
permit nopass kl cmd eix-sync
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
