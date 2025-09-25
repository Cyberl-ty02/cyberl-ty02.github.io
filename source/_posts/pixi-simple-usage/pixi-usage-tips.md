---
title: Python Pixi 简单使用
comments: true
toc: true
donate: true
share: true
date: 2025-08-24 13:20:01
categories: 实用技巧
tags:
- 技巧
---
本篇文章将简单记述搭建pixi环境。

# 1. 安装pixi

官方网站详见[这里](https://pixi.sh/latest/)，点击[安装指南](https://pixi.sh/latest/installation/)即查询如何可快速安装

## 1.1 安装命令

以下仅列出部分安装命令，其他方法请点击安装指南进一步查看

### 1.1.1 Windows

```powershell
# 使用Power Shell
powershell -ExecutionPolicy ByPass -c "irm -useb https://pixi.sh/install.ps1 | iex"

# 使用 scoop (注意pixi已经存在于main bucket里面)
scoop install pixi
```

### 1.1.2 Linux/Mac等

```bash
# 使用curl
curl -fsSL https://pixi.sh/install.sh | sh

# 使用wget
wget -qO- https://pixi.sh/install.sh | sh
```

## 1.2 验证安装是否成功

```bash
#执行以下命令，检查是否有输出
pixi --version
```



# 2. 创建示例项目

以下文字说明主要针对笔者示例所用环境(**windows 11**)进行说明，可能与linux/Mac等环境有区别，敬请注意, 另请时长查阅最新文档，及时跟进

## 2.1 使用Pycharm创建示例项目

### 2.1.1 生成并初始化项目

```bash
# 在当前目录一键式生成子文件夹并在其中创建项目
pixi init my-pixi-project --format pyproject
```

操作完成后，启动PyCharm, 用它打开my-pixi-project这个项目文件夹

### 2.1.2 安装附属包，使PyCharm将其处理为Conda

本步操作安装[pixi-pycharm](https://github.com/pavelzw/pixi-pycharm),可以更加方便地在PyCharm里面使用Pixi

```bash
# 请注意，以下的操作命令可能会更新，请及时点击链接查阅文档

# 请切换到项目文件夹内安装
cd my-pixi-project
# 安装附加组件
pixi add pixi-pycharm

# 在项目文件夹内生成与Conda命令兼容的可执行文件
# on Linux/macOS
pixi run 'echo $CONDA_PREFIX/libexec/conda'
# on Windows
pixi run 'echo $CONDA_PREFIX\\libexec\\conda.bat'

```

注意，因[文档时刻更新](https://pixi.sh/latest/integration/editor/jetbrains/#pycharm)，关于如何把PyChram当前解释器替换为pixi的，请**实时查阅**，跟着文档最新方法来

## 2.2 使用VSCode创建项目

### 2.2.1 创建并进入项目目录

```bash
# 创建目录
mkdir my-pixi-project
# 进入指定目录
cd my-pixi-project
```

### 2.2.2 添加 Python和pixi环境

#### 初始化 Pixi

```bash
pixi init
```

#### 将 Python 添加到目录

```bash
# 默认已安装版本
pixi add python

# 某个特定版本
pixi init --python=3.11 # 替换为你想要的python版本
```

### 2.2.3 激活 Pixi 环境

#### Bash

```bash
pixi shell
```

#### Power Shell

```powershell
# 确保你在项目根目录，即包含 pixi.toml 文件的目录
# 然后执行：
pixi shell-hook | Out-String | Invoke-Expression

# 简便版写法
Invoke-Expression -Command (pixi shell-hook)
```

你会注意到终端的提示符发生了变化，通常会在前面显示你的项目名（如 **my-pixi-project** ），这表示你现在正处在一个*由 pixi 管理的独立环境*中。

# 3. 编写运行示例代码

## 3.1 编写 Python 代码

我们将创建一个简单的 Python 文件，你可以在终端里用 VSCode 打开当前项目，也可以手动创建。

创建一个名为***hello.py***的python文件，写入如下代码:

```python
print("Hello, World from Pixi!")
```

随后，保存此文件。

## 3.2 运行 Python 代码

以下为可能的运行方式(方法不唯一)

### 3.2.1 IDE (如VSCode, PyCharm)

* 在 hello.py 文件中，点击右上角“播放”按钮  (▶)
* 在编辑器内右键选择 "Run Python File in Terminal"

### 3.2.2 在命令行中运行

```bash
python hello.py
```

## 3.3 输出结果

你应该会看到终端输出形如:

```txt
Hello, World from Pixi!
```

# 4. 结尾

如果要上传到github等代码托管平台，比如类似本文的样例, 您的仓库只需包含**最精要的资产**(比如.gitignore, pixi.toml, pixi.lock, 源码等)，而将所有依赖项交由 pixi 管理。有助于仓库的整洁与专业，有力保障可复现性。

未来，任何一位开发者克隆您的项目后，无需担忧环境配置的琐碎问题，只需简单的：

```bash
pixi install
pixi run python hello.py
```

一个与您完全一致的环境就已准备就绪，现在就开始您的高效开发之旅吧！
