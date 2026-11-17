---
title: 联盟如何分配价值：Shapley 值与 Banzhaf 指数
comments: true
toc: true
donate: false
share: true
date: 2026-11-17 23:04:00
categories: 随笔与摘录
tags:
- 随笔
---

多个参与者共同完成一项工作时，按人数平分、按单独产出分配、按加入联盟带来的增量分配，会得到不同结果。投票系统里也类似：名义权重较大，不代表决定结果的能力与权重成正比。

本文构造一个三人价值博弈和一个四人加权投票博弈，从边际贡献计算 Shapley 值与 Banzhaf 指标。重点是先说清平均的对象和分母，而不是把所有指标都归一化成总和 1。

<!-- more -->

## 特征函数描述联盟能够创造什么

可转移效用合作博弈（transferable-utility game，TU game）写成 $(N,v)$，其中 $N$ 是玩家集合，特征函数（characteristic function）$v(S)$ 表示联盟 $S\subseteq N$ 可创造的总价值，约定 $v(\varnothing)=0$。

TU 假设价值可以在成员间分配；它不是说成员一定愿意接受任何分法，也不自动保证大联盟形成。玩家 $i$ 加入一个不含自己的联盟时，边际贡献（marginal contribution）为：

$$
\Delta_i(S)=v(S\cup\{i\})-v(S),\qquad i\notin S.
$$

构造三个提供互补能力的参与者 $A,B,C$，联盟价值如下。它们是示意价值单位，不是来自真实项目的数据：

| 联盟 | $\varnothing$ | $A$ | $B$ | $C$ |
| --- | --- | --- | --- | --- |
| 价值 | 0 | 3 | 1 | 0 |

| 联盟 | $AB$ | $AC$ | $BC$ | $ABC$ |
| --- | --- | --- | --- | --- |
| 价值 | 10 | 8 | 5 | 18 |

单独价值不是全部贡献。虽然 $v(C)=0$，$C$ 加入 $AB$ 时仍增加 8，不能据此把它称为没有贡献的玩家。

## Shapley 值：平均所有加入顺序

设 $n=|N|$。Shapley 值把所有 $n!$ 个玩家排列视为等可能，每个人获得自己加入时的边际贡献，再取平均。等价公式为：

$$
\begin{aligned}
\phi_i(v)&=\sum_{S\subseteq N\setminus\{i\}}a_S\Delta_i(S),\\
a_S&=\frac{|S|!(n-|S|-1)!}{n!}.
\end{aligned}
$$

系数的来源很具体：如果 $S$ 恰好是 $i$ 的前驱集合，$S$ 内可排列 $|S|!$ 种，后面的玩家可排列 $(n-|S|-1)!$ 种。这里等概率的是**排列**，不是所有前驱子集。定义与排列解释可对照[合作博弈公开资料](https://ocw.mit.edu/courses/14-16-strategy-and-information-spring-2016/resources/mit14_16s16_cooperative/)。

对本例列出全部排列，贡献列始终按 $A,B,C$ 排列：

| 加入顺序 | $A$ 的贡献 | $B$ 的贡献 | $C$ 的贡献 |
| --- | --- | --- | --- |
| $ABC$ | 3 | 7 | 8 |
| $ACB$ | 3 | 10 | 5 |
| $BAC$ | 9 | 1 | 8 |
| $BCA$ | 13 | 1 | 4 |
| $CAB$ | 8 | 10 | 0 |
| $CBA$ | 13 | 5 | 0 |

因此：

$$
\begin{aligned}
\phi_A&=\frac{49}{6},\\
\phi_B&=\frac{17}{3},\\
\phi_C&=\frac{25}{6},\\
\phi_A+\phi_B+\phi_C&=18.
\end{aligned}
$$

每个排列的贡献之和都沿着联盟形成过程望远镜相消，等于 $v(N)-v(\varnothing)$。平均后仍然是 18，这就是效率性（efficiency）的直接检查。

## 四个性质，以及 dummy 的术语边界

在本文采用的约定下，Shapley 值满足：

- **Efficiency**：全部分配之和等于 $v(N)$。
- **Symmetry**：若两人在每个不含他们的联盟上的增量相同，则分配相同。
- **Dummy**：若玩家 $i$ 对任意联盟的边际贡献恒等于 $v(\{i\})$，则分配为该单独价值。
- **Additivity**：对同一玩家集合上的两个价值函数，$\phi(v+w)=\phi(v)+\phi(w)$。

Null player 是边际贡献处处为 0 的玩家，是上述 dummy 且单独价值为 0 的特例。有些资料把 dummy 一词直接用于 null player，阅读时必须看定义，不能只对照名称。

例如，在本例额外加入一个玩家 $d$，令其对所有联盟都固定增加 2，则 $d$ 是 dummy，Shapley 值为 2，但不是 null player。原玩家的边际贡献不因 $d$ 是否在场而改变，其 Shapley 值也不变。

这些公理提供一种分配依据，并不意味着分配必然满足任何现实公平标准。Shapley 值一般也不保证属于核心（core）；若要判断联盟会不会阻止某种分配，还需要检查相应的稳定性条件。

## Banzhaf value：平均子集，而不是排列

一般 TU 博弈的概率型 Banzhaf value 可定义为：

$$
\beta_i(v)=\frac1{2^{n-1}}
\sum_{S\subseteq N\setminus\{i\}}\Delta_i(S).
$$

这里等权的是其他玩家的全部子集。与 Shapley 不同，大小不同的联盟不会因其可对应的排列数而得到不同权重。

对每位玩家枚举其他人的全部子集，可以把平均之前的计算完整列出：

| 玩家 | 前驱子集（按顺序） | 对应边际贡献 | 合计 |
| --- | --- | --- | --- |
| $A$ | $\varnothing$、$B$、$C$、$BC$ | $3$、$9$、$8$、$13$ | 33 |
| $B$ | $\varnothing$、$A$、$C$、$AC$ | $1$、$7$、$5$、$10$ | 23 |
| $C$ | $\varnothing$、$A$、$B$、$AB$ | $0$、$5$、$4$、$8$ | 17 |

例如，$B$ 加入 $AC$ 的贡献为 $v(ABC)-v(AC)=18-8=10$。每行都有四个等权子集，因此分别除以 4：

$$
\begin{aligned}
\beta_A&=\frac{33}{4},\\
\beta_B&=\frac{23}{4},\\
\beta_C&=\frac{17}{4},\\
\sum_i\beta_i&=\frac{73}{4}\ne18.
\end{aligned}
$$

因此这一 Banzhaf value 不满足一般的效率性。不能为了让它看起来像分配份额，就悄悄改成总和 1 或总和 $v(N)$；那是在引入另一个变换。一般 TU 博弈还可能有负贡献或零总和，归一化更不能不加条件地进行。

## 简单投票博弈的两种分母

简单投票博弈的特征函数只取 0 或 1，分别表示联盟失败或获胜，并满足单调性。玩家加入使失败联盟变为获胜联盟时，是一次 swing；设这样的其他玩家子集共有 $\eta_i$ 个。

常见的两种 Banzhaf 指标是：

$$
\begin{aligned}
\beta_i^{\mathrm{abs}}&=\frac{\eta_i}{2^{n-1}},\\
\beta_i^{\mathrm{norm}}&=\frac{\eta_i}{\sum_j\eta_j}.
\end{aligned}
$$

第一种对应“其他人各自以 $1/2$ 概率加入联盟”的模型，因而所有其他人子集等可能；它不要求各玩家指标总和为 1。第二种是相对于总 swing 次数的份额，才归一化为总和 1。这种机会模型也不等于真实投票行为的统计预测。两种分母的明确区分可参见[投票权力研究](https://www.lse.ac.uk/cpnss/assets/documents/voting-power-and-procedures/publications/2002/leech7.pdf)。

## 原创加权投票案例

用 $[8;5,3,2,1]$ 表示四个玩家权重分别为 $5,3,2,1$，联盟权重至少为 8 才获胜：

$$
v(S)=\mathbf1\!\left\{\sum_{i\in S}w_i\ge8\right\}.
$$

全部获胜联盟为 $AB,ACD,ABC,ABD,ABCD$。极小获胜联盟只有 $AB$ 和 $ACD$；“极小”意味着移除任何成员都会失败，不等于人数最少。

玩家在某个获胜联盟中是关键成员（critical player），指移除他后联盟失败。下表列出不含玩家本人的、加入后发生 swing 的子集：

| 玩家 | 前驱联盟 | $\eta_i$ | 相对指标 |
| --- | --- | --- | --- |
| $A$ | $B$、$BC$、$BD$、$CD$、$BCD$ | 5 | $1/2$ |
| $B$ | $A$、$AC$、$AD$ | 3 | $3/10$ |
| $C$ | $AD$ | 1 | $1/10$ |
| $D$ | $AC$ | 1 | $1/10$ |

绝对指标向量为 $(5/8,3/8,1/8,1/8)$，总和是 $5/4$，不是 1。$C,D$ 虽然权重不同，结构性权力却相同。权重 5 也不能直接解释成 $5/11$ 的决策权力。

$A$ 不在场时，其余权重总和只有 6，达不到门槛，所以 $A$ 拥有否决权（veto power）。但 $A$ 单独也不能通过决议，因此不是独裁者。拥有 veto 不等于可以独立决定通过。

若改为随机排列玩家，首次把前缀联盟变为获胜联盟的玩家叫 pivotal player。例如，顺序 $C,D,A,B$ 的累计权重为 $2,3,8,11$；在 $A$ 加入时首次达到门槛，所以这个排列中 $A$ 是 pivotal player，后面的 $B$ 不再改变胜负。

枚举本例全部 24 个排列，得到：

| 玩家 | Pivotal 排列数 | Shapley–Shubik 指数 |
| --- | --- | --- |
| $A$ | 14 | $14/24=7/12$ |
| $B$ | 6 | $6/24=1/4$ |
| $C$ | 2 | $2/24=1/12$ |
| $D$ | 2 | $2/24=1/12$ |

计数之和为 24，因为每个排列恰好有一个首次越过门槛的玩家。这个指数就是简单博弈的 Shapley 值。它按等概率排列计数，同一个前驱子集可能对应多个排列；Banzhaf 则等权考虑其他玩家的子集。因此两者分别得到 $(7/12,1/4,1/12,1/12)$ 和归一化的 $(1/2,3/10,1/10,1/10)$，并不矛盾。

## 独立核验与结论边界

价值博弈分别通过六个排列和组合权重公式计算 Shapley 值，再枚举各玩家的全部四个前驱子集计算 Banzhaf value。另以附加 dummy、交换玩家标签和价值函数相加检查性质。

投票例枚举全部 16 个联盟，检查获胜与极小获胜联盟；独立统计加入与移除的临界次数，并枚举 24 个排列核对 pivotal 计数。所有分数使用精确有理数，避免四舍五入伪造“总和差一点”。

选择指标前，应先问：这里要分配可转移价值，还是衡量结构性投票权力？平均的是排列还是子集？是否又做了一次相对归一化？这三个问题确定后，公式的分母才有意义。

## 延伸阅读

- [合作博弈与 Shapley 值](https://ocw.mit.edu/courses/14-16-strategy-and-information-spring-2016/resources/mit14_16s16_cooperative/)：比较排列解释与公理。
- [投票权力的 Banzhaf 口径](https://www.lse.ac.uk/cpnss/assets/documents/voting-power-and-procedures/publications/2002/leech7.pdf)：区分绝对指标与相对归一化指标。

阅读资料用于核对通用概念；本文价值表、加权投票系统与枚举表均为独立构造。

相关笔记：[策略式博弈与纳什均衡](/posts/game-theory-utility-nash-equilibrium/game-theory-utility-nash-equilibrium/)讨论单边偏离；[扩展式博弈与逆向归纳](/posts/game-theory-extensive-form-backward-induction/game-theory-extensive-form-backward-induction/)讨论行动顺序。本文的联盟模型处理的是另一种问题，不能直接替代前两种模型。
