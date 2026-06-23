---
title: Typst 长文档与 Python 工具链踩坑记录
comments: true
toc: true
donate: true
share: true
date: 2026-06-23 17:00:00
categories: 实用技巧
tags:
- 技巧
- typst
- python
---

最近使用 Typst 编写较长的技术文档，并用 Python 处理少量构建和检查任务。Typst 的编译速度很快，但“成功生成 PDF”只是第一步：参考文献编码、交叉引用、表格布局、生成文件和 Python 环境仍然可能带来不少问题。

本文只记录通用工具经验。示例均为重新编写的最小案例，不对应任何真实文档、项目或数据。

## BibTeX 文件开头的 UTF-8 BOM

有时 `.bib` 文件看起来完全正常，第一条记录却无法被稳定解析。一个容易忽略的原因是文件开头存在 UTF-8 BOM。

BOM 通常不会显示在编辑器正文中，但可以用 Python 检查文件头：

```python
from pathlib import Path

bib_path = Path("references.bib")
has_bom = bib_path.read_bytes().startswith(b"\xef\xbb\xbf")
print(f"UTF-8 BOM: {has_bom}")
```

如果确认存在 BOM，可以读取后重新保存为普通 UTF-8：

```python
from pathlib import Path

bib_path = Path("references.bib")
content = bib_path.read_text(encoding="utf-8-sig")
bib_path.write_text(content, encoding="utf-8", newline="\n")
```

这里的 `utf-8-sig` 会在读取时移除 BOM，写入时则明确使用不带 BOM 的 UTF-8。修改前应保留版本控制记录，避免编码转换意外改变其他内容。

## 编译成功但参考文献仍然乱码

编码问题并不总会让编译器报错。有些错误文本仍然是合法字符串，因此 Typst 可以生成 PDF，但姓名中的重音字符、弯引号或破折号可能已经损坏。

例如，下面这种文本通常意味着 UTF-8 内容曾被错误地按其他编码解释：

```bibtex
author = {GarcÃ­a, Sample}
```

正确内容应是实际的 Unicode 字符：

```bibtex
author = {García, Sample}
```

遇到这类问题时，不应只修改最终 PDF 或逐项替换乱码。更可靠的顺序是：

```text
确认文献管理器的导出编码
检查 .bib 文件本身是否已损坏
统一保存为 UTF-8
重新导出或修复源数据
重新编译并人工抽查 PDF
```

建议至少检查参考文献列表的第一项、最后一项、包含非 ASCII 姓名的条目，以及 DOI 和 URL。解析成功并不等于内容正确。

## 为交叉引用使用稳定标签

Typst 可以在标题后定义标签，再通过 `@标签` 引用：

```typst
= 概览 <section:overview>

相关说明见 @section:overview。
```

标签最好描述结构角色，而不是直接复制完整标题。章节名称变化时，稳定标签通常不需要跟着修改，也能减少大量无意义的替换。

我现在更倾向使用类似约定：

```text
chapter:method
section:setup
fig:workflow
tab:comparison
eq:objective
```

复制章节、图表或公式后，应立即检查是否带入了重复标签。每次调整结构后重新完整编译，确认引用没有显示为问号或未解析状态。

## 表格没有溢出也可能很难阅读

表格最明显的问题是超出页面，但更常见的问题是窄列造成频繁断词。编译器认为布局有效，阅读体验却已经明显下降。

一个简单的表格骨架如下：

```typst
#table(
  columns: (1fr, auto, 3fr),
  inset: 5pt,
  table.header(
    [*类别*],
    [*影响*],
    [*处理方式*],
  ),
  [项目一], [普通], [这里填写经过简化的描述],
)
```

调整表格时，我通常按下面的顺序处理：

```text
优先把宽度留给说明文字较多的列
删减重复文字
把过大的表格拆成多个小表
再考虑横向页面
最后才缩小字号
```

过早缩小字号往往只是把布局问题变成可读性问题。表格属于必须查看渲染结果的内容，仅检查 Typst 源码很难判断真实行高、断词和分页效果。

## 生成 PDF 后做固定位置抽查

基础编译命令很简单：

```powershell
typst compile manuscript/document.typ output/check.pdf
```

但命令退出码为零，只能说明编译完成，不能证明版面已经适合阅读。我会固定检查几类页面：

```text
文档第一页
第一个正文页面
公式或列表较集中的页面
最宽的表格
参考文献开始和结束的位置
```

这样更容易发现孤立标题、表格过密、引用乱码和分页突变。检查用的截图和中间图片只应保存在临时目录，不要随手提交到仓库。

## 用 Python 统一构建入口

当构建步骤逐渐增加时，可以使用一个很小的 Python 脚本统一路径和错误处理。不要把本机绝对路径写进脚本：

```python
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent
source = root / "docs" / "main.typ"
output = root / "build" / "preview.pdf"

output.parent.mkdir(parents=True, exist_ok=True)

subprocess.run(
    ["typst", "compile", str(source), str(output)],
    cwd=root,
    check=True,
)
```

这里使用参数列表调用命令，而不是拼接一整段 shell 字符串，可以减少空格、引号和转义带来的问题。`check=True` 会在 Typst 编译失败时让脚本立即返回错误，避免后续步骤继续处理旧 PDF。

## Python 环境可以启动，不代表依赖组合正确

Python 工具脚本有时可以启动，却在读取文件、创建网页或调用间接依赖时才失败。这通常发生在解释器版本与依赖锁文件不一致，或者旧虚拟环境经过多次手工升级之后。

与其在旧环境中不断覆盖安装，更稳妥的做法是：

```text
确认项目要求的 Python 小版本
删除并重建虚拟环境
通过锁文件恢复依赖
分别验证导入、文件读取和核心命令
```

如果项目使用 `uv`，可以把 Python 版本和依赖交给项目配置管理，而不是依赖全局环境。例如：

```bash
uv sync --frozen
uv run python scripts/build.py
```

具体命令应以项目实际使用的环境工具为准。关键不是选择哪一种工具，而是避免全局包、虚拟环境和多个锁文件同时参与同一次构建。

## 在动态输入的边界处理 Unknown 类型

严格类型检查经常会把配置文件、JSON 或第三方库返回值标记为 `Unknown`。如果直接把这些值传入核心函数，警告会沿着调用链不断扩散。

更清晰的做法是在读取边界完成验证：

```python
from typing import Any


def require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    return value


raw_config: dict[str, Any] = {"output": "build/preview.pdf"}
output_path = require_string(raw_config.get("output"), "output")
```

这样核心代码接收到的是已经确认过的 `str`，而不是来源不明的动态值。类型检查的目的并非单纯消除提示，而是明确数据从哪里进入可信区域。

## 不要让生成文件淹没 Git 差异

PDF、Typst 缓存、Python 缓存和临时渲染图片都属于可重新生成的文件。将它们与源码一起提交，会让版本差异充满二进制变化。

更适合按输出目录忽略：

```gitignore
/build/
/tmp/
/.venv/
__pycache__/
*.pyc
```

不建议为了省事直接忽略所有 `*.pdf`，因为正式插图或需要长期保存的资料也可能使用 PDF 格式。忽略明确的构建目录通常更安全。

## 公开技术笔记前检查元数据

即使正文没有敏感内容，源文件、日志和 PDF 属性仍可能包含：

```text
作者、邮箱或内部编号
文档标题和关键词
本机用户名与绝对路径
代码托管地址和提交标识
文献附件的本地路径
PDF 的作者与标题属性
```

因此，公开排错记录时不要直接粘贴完整编译日志、真实目录树、文档截图或原始差异。更稳妥的方法是从空白文件重新写一个最小示例，只留下解释故障所必需的几行。

还应注意：已经进入 Git 历史的内容不会因为当前文件被删除而消失。如果误提交了真正的密钥，应先吊销或轮换密钥，再处理仓库历史。

## 最终检查清单

- [ ] `.bib` 使用 UTF-8，文件开头没有 BOM；
- [ ] PDF 中的 Unicode 字符、标点、DOI 和 URL 显示正常；
- [ ] 交叉引用均已解析，标签没有重复；
- [ ] 表格没有越界、过度断词或异常分页；
- [ ] 已人工查看具有代表性的页面；
- [ ] Python 解释器与锁文件一致；
- [ ] 构建脚本不包含本机绝对路径；
- [ ] 构建目录和缓存已被 Git 忽略；
- [ ] 公开示例是重新编写的最小案例；
- [ ] 源码、日志、截图和 PDF 元数据均不含隐私信息。

## 小结

Typst 的快速编译让长文档修改变得轻松，但输入编码、引用数据和最终版面仍然需要单独检查。Python 很适合把这些重复步骤串起来，前提是构建入口、依赖环境和动态数据边界足够明确。

对公开技术笔记而言，最重要的并不是把真实排错过程完整搬上网页，而是重新构造一个能解释问题、又不携带原文和环境信息的最小案例。
