# MulmoTerminal

[English](README.md) · [日本語](README.ja.md) · **简体中文**

**并行跑多个编码智能体会话 —— 一眼看出哪一个在等你。**

一个给**并行 AI 编码智能体**用的**浏览器终端**：多个会话并排，每个占一格，
**在等你的那一个用颜色标出来**。默认是 **Claude Code**，另有六个 CLI 同为一等公民 ——
Codex、Antigravity、Grok、Muse、GitHub Copilot CLI、Cursor CLI。单个智能体的 vibe coding 一个 shell 就够了，
这个工具是给**同时跑好几个、然后分不清谁在等你**的时候用的。会话能挺过刷新（tmux），
工作隔离在 **git worktree** 里，一轮结束时**推送到手机**。

**每一格都是真实的 pty。** `htop`、`lazygit`、开发服务器、Claude Code —— 在这里是同一类东西。
所以「每个 worktree 一个会话」的限制**只对智能体生效**，一个 shell 或 `yarn dev`
可以和正在干活的智能体待在同一个 worktree 里。

## 演示

![MulmoTerminal —— 按状态着色的 Claude Code 会话网格，实时更新](https://raw.githubusercontent.com/receptron/mulmoterminal/main/docs/guide/images/hero.gif)

*实际运行中的网格 —— 每一格标为 **在跑**、**跑完了** 或 **等你**。*

```bash
npx mulmoterminal@latest        # 在 http://localhost:34567 启动并打开浏览器
```

需要 **Node 22.12 以上**，以及 `PATH` 上已登录的
[`claude`](https://claude.com/claude-code) CLI。
`npx mulmoterminal@latest init` 会告诉你缺了什么。

### 为什么不用 tmux + iTerm 分屏？

并行地跑起来从来不是难点，tmux 就能做。丢掉的是**五个里面哪一个在等你**。
一个 pane 是不透明的：在跑、跑完了、卡在权限确认上 —— 不读一遍就分不出来。

在 MulmoTerminal 里，每一格都把自己的状态报告给同一个网格 ——
在跑（蓝）、跑完了（绿）、**等你**（琥珀）。屏幕外的格子变琥珀时会响一声。
还有一个**每个会话一行的 cockpit roster**，所以你在回答其中一个的时候，
不会丢掉另外四个的位置。

装了 tmux 的话它就跑在 tmux **之上**，[重启也不会丢](#会话持久化-tmux)。

## 为什么你会想要它

- **一眼看完所有智能体。** 按状态着色的会话网格 —— 在跑（蓝）、**被权限挡住 / 等你**（琥珀）、
  **跑完但还没看**（蓝）、空闲。配上提示音和工具栏计数，屏幕外卡住的智能体不会溜过去。
  不用再守着一个终端，改成监督十个。放大其中一个，**cockpit roster** 仍然让其余的留在视野里 ——
  每个会话一行文字：AI 摘要、上一条 prompt、最新回复、以及分支的 **PR 阶段**
  （draft / CI 失败 / ready / merged）。
- **给智能体的 GUI，而不只是终端。** 终端旁边的 **Canvas** 面板会把智能体通过 MCP 产出的东西 ——
  **文档、表单、图表、生成的图片、HTML、collection 卡片** —— 各自用专属插件画出来。
  智能体不是给你打印文字，而是递给你一个界面。
- **人在哪里都能被叫回来。** 任务完成或等待输入时会**推送到手机**，配合 **RemoteHost**
  还能在手机上看会话、点一下就回答（**yes / no / continue**）。走开、被叫、回来。
- **重启不丢任何东西。** 有 `tmux` 的话，服务器崩溃、重启、`node --watch` 重载，
  每个会话都活着 —— 跑到一半的智能体、长时间的构建、开发服务器都继续跑，回来时自动接上。
- **不离开网格就能发布。** 每个仓库格子带 **git 分支标签**，一键隔离到 **git worktree**，
  打开 **diff** 面板，完成 **commit / push / 开 PR**。多个智能体可以在同一个仓库里互不干扰。
- **知道花了多少钱。** 每个会话的**上下文 %**、**token**、**预估 $**，工具调用的**时间线**，
  以及单元格标题和命令输出的 **AI 摘要** —— 让一整墙的并行智能体保持可读。
- **按你的习惯来。** 按目录设置**主题、颜色和名字徽章**（`prod` 红色、`staging` 琥珀色）、
  可配置的头部、自定义提示音，以及在格子里直接启动项目脚本、`.claude/skills` 和 deck 的
  Run / Skill / Mulmo 菜单。

![MulmoTerminal 的网格视图 —— 四个 Claude 会话并排运行，各自属于不同颜色的项目](https://raw.githubusercontent.com/receptron/mulmoterminal/main/docs/guide/images/grid-2x2-live.png)

*网格就是**并行智能体的驾驶舱**。每个格子的头部摆着你做判断需要的东西 ——
**模型 · 上下文 %**、**token 数**（`⇡in ⇣out`）、**git 分支 / 变更**标签，
以及这个智能体正在做什么的 AI 摘要。**格子的边框颜色表示状态**，屏幕外卡住的格子会用声音把你叫回来。*

### 底层是怎么回事

每个会话在服务器上作为真实的 PTY 运行（把智能体 CLI 放进一个伪终端），
通过 WebSocket 流到浏览器里的 [xterm.js](https://xtermjs.org/) 终端。

**cockpit roster** 列出所有会话，并实时反映哪些**在跑**（智能体在思考）、
哪些**在等你**（权限确认或提问 —— 琥珀色圆点，你不答它就不往下走）、
哪些**跑完了但你还没看**（绿色圆点）。这些来自**服务器在启动会话时注入的
Claude / Codex activity hook**，不是去解析屏幕上的文字。

> 这是关键。在终端里，「卡在权限确认上」和「还在思考」**看起来完全一样** ——
> 两者都只是不再输出了。读屏幕分不出来，hook 可以。
>
> （Codex 不上报「等待输入」：它的确认框画在自己的 TUI 里，不会进 rollout 文件。
> 所以对 Codex 来说只有「在跑 / 跑完了」两种状态。）

## 换过来的人怎么说

> 以下是从 IDE 或分屏终端迁移过来的用户的反馈，不是基准测试，也不是我们测量过的结论。
> 你的环境可能不同。

**「它不再吃我的内存了」** —— 靠开多个 IDE 窗口来隔离智能体的代价很高：
每个窗口都带上自己的编辑器、语言服务器、扩展和文件监听。有用户反馈说
**64GB 的机器在那种负载下会卡**，换过来之后就顺了。在这里智能体是服务器上的 PTY，
界面是浏览器标签页。

**「我不再回错智能体了」** —— 六个滚动文字的 pane 长得一模一样。
有用户描述过**把回复打进了另一个智能体的终端**，并且想不起来最初让它做什么。
问题不在注意力，而在于 N 个相同的 pane 意味着要在脑子里保持 N 份上下文。
状态着色、名字徽章和按目录的颜色，把这件事从脑子里搬到了屏幕上。

**「看很多和读一个不再是二选一」** —— 把终端切成六份，每个 pane 都小到读不完一段长回复
（有用户碰到的是 4000 字的回复）。于是每加一个智能体，你就默默接受更差的阅读体验。
**网格 ↔ 放大**去掉了这个取舍：先看全部，再把一个放大好好读，
期间 cockpit roster 仍然以文字形式保留其余的。

**「我原有的会话跟着一起过来了」** —— 会话原样恢复（同样的 `claude --resume`，同样的记录）。
指向一个你本来就在用的目录，历史就在那里。不用迁移，也不用重做。

**不需要十个智能体才划算。** 有用户反馈在并行 **1 到 3** 个会话时就已经值得换过来。
上面这些好处讲的是「不再跟丢」，不是「跑得更多」。

## 安装与运行

需要 **Node 22.12 以上**，以及 `PATH` 上的这些 CLI：

| | 工具 | 它带来什么 | 安装 |
| --- | --- | --- | --- |
| **必需** | [`claude`](https://claude.com/claude-code) | 所有 Claude 会话，本应用是它的驾驶舱 | `npm i -g @anthropic-ai/claude-code`，然后跑一次 `claude` 登录 |
| **必需** | `git` | worktree 隔离、每格的分支 / 未保存点 / diff、PR footer | `brew install git` · `sudo apt install git` · Windows: [git-scm.com](https://git-scm.com/download/win) |
| **必需** | `gh` | 跨仓库的 **PR & Issue** 视图和一键开 PR。用你自己的 `gh` 登录，不存 token | [cli.github.com](https://cli.github.com)，然后 `gh auth login` |
| 可选 | `glab` | 对 **GitLab** 项目做同样的事，支持自建实例 | `brew install glab`，然后 `glab auth login` |
| 推荐 | `tmux` | **会话持久化** —— 终端能挺过服务器重启 | `brew install tmux` · `sudo apt install tmux` · Windows 无原生版本（退回普通 PTY） |
| 可选 | `codex` | 在格子里跑 **Codex 会话** | `npm i -g @openai/codex` |
| 可选 | `ffmpeg` | 从 mulmo-script 面板渲染视频 | `brew install ffmpeg` · `sudo apt install ffmpeg` |
| 可选 | `ollama` | 用完全本地的模型跑 Claude Code | [ollama.com/download](https://ollama.com/download) |

缺少非必需的行，服务器照样启动，只是少掉那一行的功能，并且界面会说明。

```bash
npx mulmoterminal@latest           # 在 http://localhost:34567 启动并打开浏览器
# 或者全局安装：
npm install -g mulmoterminal
mulmoterminal
```

**怎么停。** 在启动它的终端按 `Ctrl+C`；找不到那个终端的话，用浏览器里的
**Settings → Quit MulmoTerminal**，或者在任意终端跑 **`npx mulmoterminal@latest stop`**。
装了 `tmux` 的话智能体会话会活下来，从 **Settings → Sessions that survived a restart** 回来。

**首次配置（可选）。** `npx mulmoterminal@latest init` 会检查环境，
从你的 Claude Code 历史里生成启动器的**目录预设**，并写入 `~/.mulmoterminal/config.json`。
它是**幂等的**，想刷新预设随时可以再跑一次。

## 文档

**[receptron.github.io/mulmoterminal](https://receptron.github.io/mulmoterminal/)**

- **用户指南（英文）:** [English](https://receptron.github.io/mulmoterminal/guide/en/) ——
  网格视图、日常工作流、完整功能列表、配置、手机推送
- **用户指南（日文）:** [日本語](https://receptron.github.io/mulmoterminal/guide/ja/)
- **更新:** 新版本和新功能在 X 上发布 ——
  英文 [@mulmocast](https://x.com/mulmocast)，日文
  [Singularity Society (@SingularitySoci)](https://x.com/SingularitySoci)

## 谁在做

**[receptron](https://github.com/receptron)** ——
在微软担任 **Windows 95** 软件架构师的
**[中島聡 (Satoshi Nakajima)](https://x.com/snakajima)**
和 **[有本勇 (Isamu Arimoto)](https://github.com/isamu)**，
也就是做 **[GraphAI](https://github.com/receptron/graphai)** 的同一组人。

## 许可证

MIT

---

> **本文对应英文 README 的前约 360 行（产品介绍与安装）。**
> 配置、架构、脚本、skills、deck、worktree 与 PR、远程主机等细节，
> 请看[英文 README](README.md) 和[用户指南](https://receptron.github.io/mulmoterminal/guide/en/)。
