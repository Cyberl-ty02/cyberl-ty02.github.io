---
title: Gentoo world 清单与按角色恢复
comments: false
toc: true
donate: false
share: true
date: 2026-02-21 17:00:49
categories: Linux 与 BSD
tags:
- Linux
- Gentoo
---

Gentoo 的 `/var/lib/portage/world` 记录用户明确选择的包或 set，不是已安装依赖的完整快照。早期版本的本文只演示把整个 world 文件交给 `xargs emerge`；当前 dotfiles 已增加按角色拆分的清单，这更适合新系统分阶段恢复。

> **更新说明（2026-10-04）**
> 真机 world 与公开的 `gentoo_setting/pc/world_packages.txt` 逐行一致，共 95 项。这个数字只是本次核验快照，不是推荐安装数量。Emacs、GRUB、genkernel 与 pnpm 等旧示例已经从本文移除；当前内核为 Gentoo-Zh XanMod，用户编辑器为 Neovim/LazyVim。

## world 文件适合做什么

查看和保存当前显式选择：

```bash
cat /var/lib/portage/world
LC_ALL=C sort -u /var/lib/portage/world > world_packages.txt
```

不要用 `qlist -IC` 或 `/var/db/pkg` 生成 world：它们包含依赖，会把一次重建变成对旧依赖图的永久固化。

完整 world 适合审计已有机器，按角色清单更适合安装新机器。当前仓库把可选项目拆成：

```text
core          Git、doas、chezmoi、Neovim、Portage 与 shell 基础
development   Bun、Rust、uv、Pixi、Typst、PostgreSQL、mold 等
desktop       SonicDE、XLibre、Fcitx、字体、网络与桌面基础
nvidia        NVIDIA、CUDA、固件与验证工具
pc-host       XanMod、rEFInd、shim、mokutil 与 EFI 工具
wsl           WSL 使用的 LLVM 工具链
optional      办公、通信、媒体等按需应用
```

这些文件是从 PC/WSL world 中整理出的角色，不是任一机器 world 的副本，也不会自动安装软件。

## 新系统按角色预览

先选择与机器用途相符的清单。例如最小的公共基础：

```bash
cd /path/to/dotfiles
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/core.txt
```

实体桌面可以随后分别预览：

```bash
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/pc-host.txt
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/desktop.txt
xargs emerge --pretend --verbose --noreplace \
  < gentoo_setting/manifests/nvidia.txt
```

每一轮都应先解决 profile、overlay、USE、关键字和 license 问题，再把同一条命令中的 `--pretend` 改为 `--ask`。不要把全部 manifest 合并后一次安装，尤其不要默认加入 `optional.txt`。

PC 与 WSL 也不能互换系统策略：前者包含真实内核、桌面、NVIDIA 与 Secure Boot，后者没有这些硬件和引导职责。共享的用户配置由 chezmoi 管理，Portage 配置仍分别保存在 `gentoo_setting/pc/` 和 `gentoo_setting/wsl/`。

## 完整复原已有机器

需要尽量复原当前 PC 时，仍可以使用经过审核的完整清单：

```bash
cd /path/to/dotfiles/gentoo_setting/pc
xargs emerge --pretend --verbose --noreplace < world_packages.txt
```

确认计划后再安装，并重新对齐依赖图：

```bash
xargs emerge --ask --verbose --noreplace < world_packages.txt
emerge --ask --update --deep --newuse @world
emerge --ask @preserved-rebuild
```

这会改变目标机器的 world，应先确认仓库与 profile 已配置正确。不要直接覆盖 `/var/lib/portage/world`：让 `emerge --noreplace` 正常记录选择，才能保留 Portage 的语义与错误检查。

## 比较真机与仓库

只读比较可以避免把临时安装误收进公开清单：

```bash
LC_ALL=C sort -u /var/lib/portage/world > /tmp/gentoo-live-world.txt
LC_ALL=C sort -u gentoo_setting/pc/world_packages.txt \
  > /tmp/gentoo-repo-world.txt
comm -3 /tmp/gentoo-live-world.txt /tmp/gentoo-repo-world.txt
```

没有输出才表示集合一致。若有差异，应逐项判断是要更新仓库、清理 world，还是保留主机专属选择；不要让脚本自动决定。

最后运行仓库验证：

```bash
gentoo_setting/scripts/verify.sh pc
```

它会检查清单排序、atom 语法、shell/JSON 配置、doas 语法和 chezmoi dry run；在可读取真机 world 时还会报告是否与 PC 清单不同。

## 参考

- [Gentoo Wiki：World set](https://wiki.gentoo.org/wiki/World_set_(Portage))
- [dotfiles：Gentoo role manifests](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/manifests/README.md)
- [dotfiles：Gentoo configuration layout](https://github.com/Cyberl-ty02/dotfiles/blob/main/gentoo_setting/README.md)
