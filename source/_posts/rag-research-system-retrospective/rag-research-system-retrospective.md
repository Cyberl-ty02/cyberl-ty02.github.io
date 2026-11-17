---
title: 一个能运行的 RAG 系统，离可复现实验还有多远？
comments: true
toc: true
donate: false
share: true
date: 2026-11-18 02:05:51
categories: 随笔与摘录
tags:
- 随笔
---

这篇复盘来自我完成一个长期研究型 AI 项目后的整理。项目从机构信息问答原型开始，处理制度、流程和服务说明这类 institutional information。最初关心的是能不能接入资料、回答问题，再给它一个可以交互的界面。等到需要冻结实验、比较 baseline、开展真人研究并解释实现时，我才逐渐意识到：功能能运行，只是这类系统的一个起点。

后来真正占用精力的，是把几个看似相近的问题分开：我到底比较了什么，哪些证据支持结论，哪些限制必须保留，以及实验完成以后应该怎样留下一个可以追溯的状态。这篇文章记录这些认识如何影响实现。

> 本文是一个研究型 AI 项目完成后的个人技术复盘，不是论文的公开版本，也不是正式机构指导。部分实现、数据与流程细节因研究伦理、隐私、资料许可和长期维护边界被有意省略。

<!-- more -->

## 一个能运行的系统，为什么还不够

能演示一次问答，只说明这条路径在当时的条件下跑通了。可复现实验还需要保留输入、执行条件与结果的对应关系，使后来的人能够判断自己重现的是哪一次比较。

我用下面的表达提醒自己。它是个人工程记忆法，不是学术定理：

$$
\begin{gathered}
\text{A working demo}\\
\neq\\
\text{A reproducible experiment}
\end{gathered}
$$

## Prototype 与 research system 的分界

早期我探索过现成 chatbot 和 framework 方案。这个阶段的价值很直接：先验证机构资料能不能进入问答流程，哪些交互方式值得继续做。原型帮助我尽早看到一个可运行的方向。

但正式研究需要回答另一些问题。同一个问题换一次配置，差异来自 retrieval、prompt、generator，还是 corpus 已经变了？一个 baseline 看起来关掉了 RAG，实际有没有继续沿用只适用于 RAG 的指令？如果界面各自维护一套流程，后面比较的是 interface，还是多个实现之间的差异？

为了控制这些变量，项目后来转向自研的 modular backend，把问答核心组织在 shared Q&A service 周围。终端、浏览器聊天界面、API 和 Avatar 共用这一核心，没有为每个入口分别维护一套 RAG pipeline。

```text
Interface adapters
        ↓
Shared Q&A service
        ↓
Retrieval
        ↓
Prompt / provider
        ↓
Typed response
```

这张图只表达组件关系。Avatar 在这里承担 presentation / interaction layer 的职责，不是另一套 AI intelligence。界面可以改变答案怎样呈现、用户怎样输入，但问答能力仍来自共用的后端。

我后来理解，prototype 的目标是尽快证明“能不能做”；research system 还必须能够说明“到底做了什么、比较了什么”。为此，需要一起冻结 code、corpus、configuration、baseline、provider、evaluation procedure 和 runtime policy。模块化有助于守住这些边界，但架构图本身并不构成研究结论。

## 不会报错的错误：configuration drift

项目中的一个实际风险是 configuration drift：开发运行时曾使用 `TOP_K=3`，而冻结实验使用 `TOP_K=5`。两边都可以正常运行，也未必出现明显错误，却已经不再使用同样的检索深度。

这类差异比 crash 更容易被忽略。程序还能回答问题，界面看起来也没变化，但研究比较的条件可能已经发生偏移。我把它理解为 silent methodological drift：软件没有坏，实验定义却可能悄悄变了。

后续 audit 将默认检索深度对齐到 5，并通过 participant runtime 的配置核验和 fail-closed validation 保持正式研究边界：必要条件不满足时拒绝启动，而不是继续用一个“差不多”的配置。

这里记录的是开发阶段发现并处理的配置风险，不是说最终实验已经因此失效。早期候选配置、冻结实验配置和最终 participant runtime 必须分别看待，不能从一份历史说明直接推断最后执行了什么。

从这个案例出发，我会把需要防范的变化分为三类。下面是一般性的检查框架，不是声称项目实际发生过全部三类问题：

- **Code drift**：实现或依赖发生变化，需要核对运行的是不是产生结果的实现。
- **Data drift**：corpus、question set 或 reference 发生变化，需要核对输入与评估依据是否仍是冻结版本。
- **Protocol drift**：baseline、sampling、logging 或 evaluation procedure 发生变化，需要核对比较条件与执行规则是否仍一致。

这次经历让我更愿意在程序入口检查实验条件。与其依赖自己记得改环境变量，不如让系统明确核验 corpus identity、检索参数、provider 和 runtime policy。对研究系统来说，这些设置也是实验定义的一部分。

## Baseline 其实是在定义“比较什么”

实验设计需要先回答：what exactly is the treatment？对一个实现完整的 RAG 系统，比较条件不能只用“LLM 加不加 context”来概括。

两个正式 conditions 的边界是：

- **`with_rag`**：执行检索，提供保留的 chunks，并使用 RAG 专用约束指令（grounding instructions）。
- **`base_llm`**：不执行检索，不提供检索上下文，也不使用这些约束指令。

同一个 generator 下，其余主要 setup 保持匹配，包括模型、Persona、回答语言规则、输出上限和 provider 默认采样设置。最终 `base_llm` 是 true no-RAG system-level baseline。

项目早期还有一个历史 `without_rag` 条件：把空 context 交给原来的 RAG prompt。这是 empty-context ablation，不能和最终 `base_llm` 混用，也不能把早期结果并入正式比较。

这个区别改变了我解释实验的方式。正式比较估计的是完整 implemented RAG package 的效果，其中包含 retrieval、context 和相应的 grounding instructions；它没有单独隔离 context 这个变量的纯因果效应。baseline 如果定义不清，后面即使有很多数字，也难以说明差异究竟来自哪里。

因此，这次比较更准确的表述是 implemented RAG system 对 matched base generation system，即 system-level ablation。如果想回答某个组件贡献了多少，还需要另外设计 component ablation，明确只改变哪些因素、固定哪些因素。两种实验的 attribution boundary 不同，不能用前者的结果直接替后者作答。

## 720 次回答为什么不是 720 个独立样本

正式 technical evaluation 使用 24 个冻结问题、2 个 conditions、5 次 repetitions 和 3 个 generators，总回答数为：

$$
24 \times 2 \times 5 \times 3 = 720
$$

五次 repetition 用于观察 stochastic generation 的波动，并不意味着有 120 个独立问题。分析时先在同一问题、condition 和 generator 内汇总重复回答，再比较问题层面的结果。重复生成增加了观察波动的机会，没有扩大问题集合本身。

720 描述的是回答记录总量，不是独立研究样本量。若把同一问题的多次生成当成新的独立问题，就会引入 pseudo-replication，让记录数量看起来像额外的独立证据。这里真正需要解释的是 analysis unit，而不只是运行次数。

## Retrieval success 不是一个二元事件

Technical evaluation 使用的冻结 corpus 包含 21 个 sources、48 个 chunks。该实验的 nominal chunk size 为 900 characters，overlap 为 150，similarity threshold 为 0.25，`TOP_K=5`。这些是本次实验采用的设置，不代表已经证明它们最优。

source-level retrieval 的 headline results 为 Hit@5 = 22/24，约为 0.9167；MRR 约为 0.7604。前者表示在这组问题中，标注相关来源进入保留 top-5 的比例；后者描述相关来源的排序位置。**Hit@5 不是答案 accuracy。** `TOP_K=5` 也只是上限，阈值过滤后不一定还剩五个 chunks。

后来做 failure analysis 时，我需要区分至少三类情况：

- **Ranking miss**：相关来源存在，但排在 top-k 之外。
- **Threshold-filtered miss**：原始排名足够靠前，分数却低于阈值，因此没有进入最终上下文。
- **Evidence-coverage / chunk failure**：来源命中了，但保留片段没有覆盖回答所需的完整证据。

第三类尤其容易被一个漂亮的命中率掩盖。知道“找到了哪份资料”，不等于知道“交给模型的那段资料是否足够回答问题”。即使片段足够，模型仍可能遗漏条件、错误概括，或者把有依据的内容说得过满。

我现在更倾向于按四层检查一次回答：是否找到 relevant source，retained chunk 是否包含 required evidence，模型是否忠实利用 evidence，以及 source 本身是否仍然 authoritative / current。前面一层成功，并不会自动保证后面几层。

```text
来源发现：是否相关？
        ↓
证据覆盖：片段是否充分？
        ↓
证据利用：生成是否忠实？
        ↓
来源有效：权威且当前有效？
        ↓
最终回答：综合以上检查
```

这是检查框架，不是声称 source validity 只能在生成之后核验。下面的 explanatory notation 也只是提示“不能直接推出”，不是统计模型或学术定理：

$$
\begin{gathered}
\text{检索命中} \not\Rightarrow \text{证据充分} \\
\text{证据充分} \not\Rightarrow \text{回答正确} \\
\text{忠实利用} \not\Rightarrow \text{来源有效}
\end{gathered}
$$

## Automatic metrics 到底在测什么

整理评估时，我需要先确定每一层究竟在问什么，再选择指标，而不是把所有分数排在一起：

| Layer | Question |
| --- | --- |
| Retrieval | 找到了什么？ |
| Evidence coverage | 找到的内容够不够？ |
| Generation | 是否正确利用 evidence？ |
| Reference-based evaluation | 与 reference 多接近？ |
| Human / source validation | 实际是否正确、完整、当前有效？ |

这次评估让我更谨慎地使用指标名称。Semantic Similarity 和 Response Relevancy 描述不同侧面；automatic Factual Correctness 虽然名字里有 correctness，也仍然是自动评估分数，不能直接改写成现实世界中答案正确的比例。

在这组冻结问题上，三个 generators 的 Semantic Similarity 和 automatic Factual Correctness 平均分都在 RAG 条件下增加，但 Response Relevancy 没有一致改善。这个结果支持有边界的比较，不能概括成“所有指标都提高了”，也不能因为用了三个 generators 就声称已经证明普遍适用性。

Faithfulness、Context Precision、Context Recall 和 Context F1 则继续拆解上下文的使用与覆盖情况。它们与 Hit@k、MRR 一起帮助定位问题，但不能合成一个万能的“系统正确率”。自动指标可以规模化提供 evidence，不是 truth，也不能替代对 source 当前有效性的核实。

这些分数对应的是各自的 operational definition：给定 reference、context、评估规则和 evaluator，什么样的回答会得到什么分数。对于依赖自动 evaluator 的指标，评估器本身也是测量条件的一部分。evaluator dependency 应被记录和解释，不能因为输出是数字就把它看作脱离这些条件的现实真相。这是测量边界，并非本项目新增的一组实验结果。

同样，记录到的 generation latency 也有测量边界：它没有包含完整 retrieval、自动评估或 Avatar / speech 的端到端体验。托管和本地 generator 的网络、计算环境不同，我不能把这些数字直接当成通用的模型速度排名，更不能把整个系统说成完全本地运行。

如果以后补充更强的 correctness evaluation，我会优先保留已经冻结的 answer set，预先定义 rubric，引入 independent human reviewers，在可行范围内隐藏 model / condition，并使用 authoritative sources、inter-rater agreement 和预定 adjudication 流程。这里说的是后续设计；本次项目没有完成覆盖全部 720 条最终回答的独立盲评，不能把它算进已取得的证据。

## Faithful to evidence，不代表 evidence 仍然有效

沿着这些层次继续追问，就会遇到 source governance。系统能够 retrieve 一份机构资料，只说明它进入了当前索引，不说明它今天仍然适合作为正式指导。大学政策、企业制度、产品支持文档和行政流程，都可能面对这种 dynamic institutional knowledge 问题；这里是对适用场景的类比，不是说本项目评估过这些领域。

冻结资料对实验有价值：它让多次运行面对同一份证据。但 reproducibility 与 freshness 是两个不同目标。历史版本可以帮助重现当时的结果，却不能因为保存完整就被当成 current guidance；忠实复述一份失效资料，也不能让回答重新有效。

如果以后把这个原型继续发展为面向真实服务的系统，我希望 source 更新经过下面的流程：

```text
authoritative source
→ responsible owner
→ current / superseded check
→ review / approval
→ versioned ingestion
→ reindex
→ validation
→ rollback if needed
```

这是一条 future production design，不是冻结实现已经全部具备的功能。source-status metadata、current/historical routing 和 production rollback pipeline 都不应从这张流程图反推为现成功能。

如果 source currency 无法确认，直接重新抓取、重新建索引并不能解决可信度问题。我更希望系统允许停在 insufficient-evidence 或 source-validity boundary，必要时指向 responsible official service。“更新得更快”不一定比“知道什么时候不该更新”更可靠。

## Subjective evidence 与 technical evidence 不可互换

加入 Avatar 后，项目多了一层显眼的展示，但它没有增加第二套问答 intelligence。它仍然是共享核心之上的 presentation adapter。我真正需要观察的是：这种呈现方式是否改变 perceived usability 和 interaction experience。

早期 UI 曾经较复杂，后来我简化了 visual hierarchy 和 participant interface。这个过程让我看到，功能丰富与交互清楚之间没有自动对应关系。把更多控制项放在页面上，并不意味着 participant 更容易理解下一步。

真人研究使用另一套更广的冻结 participant corpus，服务于交互任务，与前面的 technical corpus 用途不同。前面 720 条回答的 metrics 不能移到这套 corpus 上，更不能当作 participant runtime 的直接性能测量。

这是一项 small paired participant study，每位 participant 都体验 Avatar 和 No-Avatar 两种呈现条件。配对比较关注同一人两种体验之间的差异；多题、多条件的评分也不能直接当成更多独立参与者。观察到的差异总体较小、方向混合，ties 较多。

因此，我能保留的结论是：**这次研究没有观察到一致的 Avatar advantage。** 这不能推出“Avatar 无效”，也没有证明它普遍改善体验。小样本、当前实现和当前任务都限制了解释范围。

技术评估与真人研究由此成为两条分开的 evidence streams。前者讨论 retrieval、generation behaviour、自动指标和失败案例；后者讨论 perceived usability、interaction experience 与主观反馈。用户觉得答案清楚，不代表 factual correctness 已被验证；自动分数较高，也不代表交互体验一定更好。

关于 modularity 的证据也需要单独解释：依据是架构边界、共享核心和实现复用，没有通过 participant study 得到定量证明。presentation layer 与 intelligence layer 分开，使问题更容易研究，却不会自动证明某种呈现方式更好。

## Ethics 为什么会改变软件架构

研究记录记载了 formal ethics approval。获批并不意味着软件已经准备好开展真人研究；启动条件和实际执行是否符合批准范围，仍要分别核验。

具体实现却不能只靠这句话。rehearsal / test runtime 与真实 participant runtime 必须分开。一个排练入口能跑通，不等于它适合处理真实 participant 内容。

研究边界影响了 participant identifier handling、logging、语音输入、data retention、researcher supervision 和 fail-closed startup。最终 participant runtime 可使用 STT，但 participant TTS disabled；普通 Q&A transcript 不作为 research data 留存，generic session logging 也不用于真实 participant runtime。这里没有把“不保存普通对话”扩大成“系统和服务商完全没有任何元数据”。

`store=False` 是 request-level minimisation，不能被解释成 guaranteed Zero Data Retention，也不能替代对 provider-side logging 或 retention 的判断。这同样是我在项目后期才更明确区分的层次：应用发出了什么请求，和服务商账户最终具备什么数据保留保障，不是同一项承诺。请求参数与账户级控制的区别，可参照[公开的 API 数据控制说明](https://developers.openai.com/api/docs/guides/your-data)；这里不据此推断任何账户已经获得相应资格。

我不会在这里公开参与者级资料或审批材料。对这篇复盘有意义的是设计如何因伦理要求而改变：测试和真实运行不能混用，必要检查失败时不能默认继续，调试方便也不能成为无限保留内容的理由。

因此，ethics 在这里实际成为 software architecture requirement：入口隔离、数据流、保留策略和失败行为，都要在代码中落实。

## 能画 architecture，不等于能解释 implementation

在一次项目技术讨论中，我被要求不要只停留在 architecture，而要沿实际 execution path 解释系统。

“多个 interface 共用一个 Q&A core”是 architecture 层的答案：组件怎样组织、谁依赖谁、共享核心在哪里。要解释 core 里面怎么执行，就需要切换到 implementation path。

例如，一次 query 怎样进入服务，语言与 Persona 怎样选择，retrieval 怎样排序、应用 top-k 和 threshold，retained evidence 怎样进入 prompt，provider 怎样生成，以及答案、sources、mode、language 和 latency 怎样通过 typed response contract 返回。这些内容需要我沿真实执行路径说明，不能一直停留在组件名称上。

以后我会按下面的层次准备介绍系统：

```text
Why
 ↓
Architecture
 ↓
Implementation
 ↓
Evidence
 ↓
Limitation
```

这要求 implementation ownership：研究者能够用自己的语言解释实际执行、技术决策和失败路径，再说明证据支持到哪里。熟悉架构图只是入口，不能代替对实现的掌握。

## Freeze 的对象是实验身份，不是仓库

实验完成之后仍然可以发现值得整理的地方，但继续修改，不应改变已经冻结的 experiment identity。它不等于 latest code state；否则“后来更好看的代码”和“产生研究结果的代码”很容易变成两回事。

我后来把 experiment identity freeze 与后续 archival 分开处理：保留产生结果的 code state，把后续整理作为可追溯的变化，而不是重写冻结 checkpoint。需要留下的包括配置、数据身份、manifests、hashes、环境信息、provenance 和 last known-good state，同时明确 archival boundary。不能用后来更漂亮的实现悄悄替换产生结果的版本。

下面只是我的个人工程记忆法，不是学术公式，也不是可以计算的评分：

$$
\begin{gathered}
\text{Reproducibility}\\
\approx\\
\text{Code}+\text{Data Identity}\\
+ \text{Configuration}\\
+ \text{Environment}\\
+ \text{Provenance}
\end{gathered}
$$

能重新打开一个 demo，与能说明当时用什么条件产生某组结果，仍然有距离。归档也不等于承诺未来外部模型和服务永远逐字生成相同回答。它首先要保住已知输入、执行条件和结果的来源，让后续的人能够判断复现到了哪一层。

归档边界还决定了哪些材料能够复现、哪些内容受到隐私或许可限制。这里讨论的是如何保存来源关系，不提供研究归档或材料的发布入口。项目完成以后，我更需要的是一个清楚的停止点，而不是无限 refactor。

## 如果重新做一次，我会更早确定什么

最想提前的并不是更复杂的界面，而是 evaluation design 和 baseline。先明确问题、比较条件和分析单位，后面很多实现决策才有依据。technical corpus 与 participant corpus 也应该尽早区分，避免临近评估时才解释为什么两套数字不能互用。

我还会更早设计 corpus identity、source governance、configuration drift validation 和 archival / provenance；把 independent human evaluation 当作需要资源和方法准备的独立工作，而不是自动指标跑完后随手补的一步。

架构边界确定后，则需要一边实现、一边练习解释 implementation path。能从 query 一直讲到返回值，再接到 evidence 和 limitation，比只熟悉图上的模块更能检验自己是否真正掌握系统。

更丰富的 embodiment，我会放到核心、隐私、安全和 evaluation 都成熟之后再考虑。

## 最后留下的是可追溯性

回头看，这个研究系统最值得保留的，是回答与输入、配置、执行过程之间可追溯的关系。我更清楚地知道该怎样定义比较、怎样检查证据、怎样说明实现，以及什么时候应该承认边界并 freeze。比起继续给 demo 增加一个功能，这些认识更值得带到下一个项目里。
