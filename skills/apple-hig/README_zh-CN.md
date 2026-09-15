# apple-hig

[English](README.md)

为编程 agent 准备的 Apple 设计指导，知识保存在本地，按主题加载。用于设计、实现或审查 macOS、iOS、iPadOS、watchOS、tvOS 和 visionOS 原生界面。

## 通过 skills 安装

在项目中运行这条命令，按提示选择 agent：

```bash
npx skills add xinyao27/mybrain --skill apple-hig
```

无需选择提示，直接为 Codex 全局安装：

```bash
npx --yes skills add xinyao27/mybrain --skill apple-hig --global --agent codex --yes
```

使用 Claude Code 时，将 `codex` 替换为 `claude-code`。去掉 `--global` 则只安装到当前项目。`--skill apple-hig` 用于从仓库中选取这个 skill。

安装需要 Git、网络连接，以及带 npm/npx 的 Node.js 22.20 或更新版本，这是当前已验证 skills CLI 的要求。安装后的 skill 是 Markdown 文件，本身不需要 API key、必装的 MCP 服务或运行时包，使用 agent 已有的文件读取工具。实现和构建原生应用仍需要该应用的开发环境。

这条命令使用 [skills.sh](https://skills.sh/) 背后的开源 [skills CLI](https://github.com/vercel-labs/skills)。从本仓库安装不要求先被目录收录。

## 使用

在 Codex 中可以这样提问：

```text
$apple-hig 审查这个 macOS 设置面板，指出具体的易用性问题，并给出最小而有效的修正建议。
```

其他示例：

```text
使用 apple-hig，为这个导出流程选择 sheet、popover 或独立窗口。
```

```text
使用 apple-hig 审查这些 SwiftUI 视图中的 Liquid Glass 层级，并实现必要的改动。
```

Agent 会阅读任务、项目指引和相关本地参考。只有问题涉及新 API、特定版本行为、缺失信息，或用户明确要求核实当前指导时，才查阅外部来源。普通设计任务无需重新下载 HIG。

## 包含的知识

| 主题                                        | 内容                                                 |
| ------------------------------------------- | ---------------------------------------------------- |
| [设计基础](references/foundations_zh-CN.md) | 设计原则、层级、排版、颜色、文案和动效               |
| [平台习惯](references/platforms_zh-CN.md)   | 六个 Apple 平台的输入方式、信息密度、窗口和交互习惯  |
| [组件选择](references/components_zh-CN.md)  | 导航、工具栏、菜单、控件、sheet 和 popover           |
| [材质](references/materials_zh-CN.md)       | 内容与控件层级、regular/clear 玻璃、原生表面和兼容性 |
| [无障碍](references/accessibility_zh-CN.md) | 可读性、VoiceOver、键盘操作和系统偏好                |

[SKILL.md](SKILL.md) 是 agent 的入口文件。需要查询或更新时才加载[来源查询与维护](references/apple-resources_zh-CN.md)。每份本地参考都记录了官方来源和核实日期。中文翻译使用 `_zh-CN.md` 后缀；标准发现入口仍是英文 `SKILL.md`。

这是对 HIG 实用指导的选取与整理，不是完整镜像或认证清单。它支持原生应用工作；Apple 风格的网站应使用 Web 设计工作流。构建成功不能证明视觉或交互质量。

## 更新与贡献

更新全局安装：

```bash
npx skills update apple-hig --global
```

项目级安装则使用 `--project`。贡献时，修改负责该主题的参考文件，引用官方来源，记录核实日期，并保持中英文同步。稳定指导保存在本地，版本相关结论要标明适用范围。保留相对文件链接，让 skill 安装到其他项目后仍可使用。

## 来源与许可

根据 [Apple Design](https://developer.apple.com/design/) 和 Human Interface Guidelines 独立编写。本项目与 Apple 无隶属关系，也未获其背书。

原创的 skill 指令、摘要和翻译采用 [MIT License](LICENSE)。所链接的 Apple 文档、字体、图标、UI 套件及其他第三方资源仍适用各自条款，本 skill 不重新分发这些资源。
