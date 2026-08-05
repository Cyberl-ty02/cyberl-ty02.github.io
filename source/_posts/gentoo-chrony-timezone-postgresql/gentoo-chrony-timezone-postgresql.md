---
title: Gentoo OpenRC 的时间同步、时区切换与 PostgreSQL 18 初始化
comments: true
toc: true
donate: true
share: true
date: 2026-08-05 19:30:00
categories: 实用技巧
tags:
- 技巧
---

这篇文章整理 Gentoo OpenRC 环境中的三项相关配置：用 chrony 同步多组时间源、绕过 KDE 日期时间模块手工切换时区，以及初始化 PostgreSQL 18 并收紧本机认证。

> **隐私说明**
> 文中的 IP、地区与密码均未使用真实值。`Asia/Shanghai` 是标准 IANA 时区名称，不代表现实居住位置。

可复用的示例文件保存在 dotfiles 仓库：[`chrony.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/services/chrony/chrony.conf) 与 [`pg_hba.conf.example`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/services/postgresql/pg_hba.conf.example)。

## Chrony 多源同步配置

当时使用的时间源组合为：

```conf
pool 2.gentoo.pool.ntp.org iburst maxsources 4
server time.windows.com iburst
server time.apple.com iburst
server ntp.ntsc.ac.cn iburst

driftfile /var/lib/chrony/drift
makestep 1.0 3
rtcsync
rtconutc
```

其中 `iburst` 会在初次建立同步时加快样本收集；`makestep 1.0 3` 允许 chronyd 在启动后的前三次更新中，对超过一秒的偏差直接步进校正。`rtconutc` 与 Windows/Gentoo 双系统中将硬件时钟保持为 UTC 的策略一致。

完整示例见 [`services/chrony/chrony.conf`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/services/chrony/chrony.conf)。实际部署前应根据网络位置和组织策略选择时间源。

## 理解 chronyc sources 状态

这次观察到 Apple 的欧洲节点最终成为 `^*`，Gentoo pool 与 Microsoft 节点显示为 `^+` 或 `^-`。中国国家授时节点可以解析出多个 IPv4 地址，一次性的五秒测试曾超时，但后台 chronyd 后来仍从其中一个地址获得样本。

```text
^*：当前选中的主时间源
^+：有效并参与时间组合
^-：有效，但未参与当前组合
^?：尚不可用、不可达或样本不足
```

`Reach` 是八进制可达性记录，新加入的源通常从 `1`、`3`、`7` 逐步增长，稳定时可达到 `377`。一次短暂超时不足以证明服务器永久不可用，应结合后台轮询结果判断。

跨洲节点通常具有更高的延迟和 root dispersion。这里没有为了固定使用某个品牌或地区节点而添加 `prefer`，而是让 chrony 根据实际样本选择。

验证命令：

```bash
chronyc activity
chronyc sources -v
chronyc tracking
```

成功状态包括：

```text
Leap status : Normal
System time 接近 0
sources 中至少有一个 ^*
```

## KDE 无法更改 NTP 设置

KDE 日期与时间模块曾显示：

```text
无法更改 NTP 设置
```

在这次 OpenRC + chrony 环境中，图形模块可能期望通过 systemd-timedated 管理 NTP，而实际同步由 chronyd 负责。因此图形界面修改失败时，chronyd 仍然可以正常同步。

这只是本文环境中的解释，不代表所有 KDE/OpenRC 组合都会出现相同行为。最终应以 `chronyc tracking` 和 `chronyc sources -v` 为准。

## 手工切换时区

切换为北京时间可使用：

```bash
doas ln -snf /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
echo 'Asia/Shanghai' | doas tee /etc/timezone
date
```

切换到伦敦时区可以使用以下命令（请根据自己实际时区调整）：

```bash
doas ln -snf /usr/share/zoneinfo/Europe/London /etc/localtime
echo 'Europe/London' | doas tee /etc/timezone
date
```

`Europe/London` 是有效的 IANA 时区名称，会自动处理英国夏令时。其他地区请根据自己实际时区调整，并先在 `/usr/share/zoneinfo/` 中确认目标文件存在。

## PostgreSQL 18 初始化

安装完成后执行 Gentoo 包提供的初始化流程：

```bash
emerge --config dev-db/postgresql
```

当时选择的配置如下：

```text
配置目录：/etc/postgresql-18/
数据目录：/var/lib/postgresql/18/data
编码：UTF8
Locale：zh_CN.UTF-8
时区：Asia/Shanghai
数据页校验和：开启
```

初始化时出现过：

```text
无法为 zh_CN.UTF-8 找到合适的文本搜索配置
默认文本搜索配置设置为 simple
```

这不是初始化失败。它表示 PostgreSQL 没有为该 locale 自动选择专用的默认全文搜索配置，因此使用 `simple`；UTF-8 中文存储本身不受影响。

## 启动 OpenRC 服务

```bash
rc-service postgresql-18 start
rc-update add postgresql-18 default
```

随后检查时区和数据页校验和：

```bash
su - postgres -c 'psql -c "SHOW timezone;"'
su - postgres -c 'psql -c "SHOW data_checksums;"'
```

实际结果为：

```text
TimeZone       = Asia/Shanghai
data_checksums = on
```

## 收紧默认 trust 认证

初始化后的本机规则最初允许 `trust`：

```conf
local all all trust
host  all all 127.0.0.1/32 trust
host  all all ::1/128 trust
```

为了避免本机任意用户无密码冒充数据库角色，我将 Unix socket 改为 `peer`，本机 TCP 改为 `scram-sha-256`：

```conf
local   all           all                         peer
host    all           all   127.0.0.1/32          scram-sha-256
host    all           all   ::1/128               scram-sha-256

local   replication   all                         peer
host    replication   all   127.0.0.1/32          scram-sha-256
host    replication   all   ::1/128               scram-sha-256
```

修改前先备份实际的 `pg_hba.conf`。仓库中的 [`pg_hba.conf.example`](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/pc/services/postgresql/pg_hba.conf.example) 仅包含本文规则，不应覆盖发行版生成文件中的其他必要条目。

可以从数据库内部检查解析结果：

```sql
SELECT
  line_number,
  type,
  database,
  user_name,
  address,
  auth_method,
  error
FROM pg_hba_file_rules
ORDER BY line_number;
```

确认 `error` 为空后重载：

```bash
rc-service postgresql-18 reload
```

## 验证 peer 与 SCRAM

使用当前普通 Linux 用户执行：

```bash
psql -U postgres
```

得到：

```text
peer authentication failed
```

这是预期结果，因为 Unix socket + `peer` 要求系统用户名与数据库角色匹配。

改用 TCP：

```bash
psql -h 127.0.0.1 -U postgres -d postgres
```

输入数据库角色的 SCRAM 密码后成功连接，说明两种认证路径都按预期工作。密码不应写进 shell 历史、配置仓库或博客。

## 小结

```text
chrony：通过多个来源自动选择当前质量较好的时间源
KDE NTP：图形设置失败不等于 chronyd 没有同步
PostgreSQL：初始化成功后仍要检查时区、校验和与 pg_hba.conf
认证：本机 socket 使用 peer，本机 TCP 使用 scram-sha-256
```

关于这套 Gentoo 的启动修复，参见：[Gentoo 在 Btrfs 与 rEFInd 环境下的启动修复记录](/posts/gentoo-refind-btrfs-rescue/)。
