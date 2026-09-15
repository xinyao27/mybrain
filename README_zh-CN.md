# mybrain

[English](README.md)

我的个人知识库，用于记录想法、技术笔记、灵感，以及值得记下的内容。

## 安装 apple-hig

[apple-hig](skills/apple-hig/README_zh-CN.md) 让编程 agent 使用本地 HIG 指导设计和审查 Apple 原生界面，涵盖平台习惯、组件选择、Liquid Glass 和无障碍，并保留官方来源以便更新。

通过 [skills.sh](https://skills.sh/) 使用的 [skills CLI](https://github.com/vercel-labs/skills) 安装：

```bash
npx skills add xinyao27/mybrain --skill apple-hig
```

在项目中运行，并选择 agent。无需选择提示，直接为 Codex 全局安装：

```bash
npx --yes skills add xinyao27/mybrain --skill apple-hig --global --agent codex --yes
```

环境要求、使用示例、更新和许可见 [skill README](skills/apple-hig/README_zh-CN.md)。

## 内容

### skills/

我创建并在日常使用的 AI agent skills。这些经过实际使用的工作流，帮助我创建项目、配置技术栈并自动化重复任务。

### docs/

其他内容：零散想法、技术研究、随想和草稿等，均为 Markdown。

## 许可

MIT © [xinyao](https://github.com/xinyao27)
