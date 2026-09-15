# 来源查询与维护

当 `SKILL_zh-CN.md` 中的条件要求外部查询，或用户要求更新 skill 时，阅读此文件。它不是日常使用的必经步骤。本地知识与读取示例核实于 2026-09-16。

## 解决具体的信息缺口

先查看相关本地指导旁记录的来源。对于尚未覆盖的设计主题，在 [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) 内搜索。需要精确的 API 行为或可用版本时，检查已安装的 SDK 或 Apple 框架文档。用户询问当前版本时，通过 [Apple Design](https://developer.apple.com/design/) 查找新发布的资源。

阅读能回答问题的具体章节。当前 HIG 与旧 WWDC 示例有差异时，优先采用当前 HIG；区分设计建议与 API 约束。应用到最低部署版本前，确认材料是否属于测试版或特定平台。

## 将官方页面读成 Markdown

对于 HIG 页面以及 `/documentation/` 下的文章或 API 文档，使用附带的[读取器](../scripts/read-apple-docs.mjs)。它读取页面公开的 DocC 数据并写成普通 Markdown。使用 Node.js 22.20+，从任意目录运行；脚本路径按实际安装的 skill 位置解析：

```bash
node "<skill-directory>/scripts/read-apple-docs.mjs" \
  "https://developer.apple.com/design/human-interface-guidelines/materials" \
  --output "<temporary-directory>/apple-hig/materials.md"
```

将两个目录占位符替换为实际路径。用 agent 平时读取文件的工具阅读保存的文件，并确认标题与目标主题一致。命令会向 stderr 输出保存路径；省略 `--output` 则将 Markdown 输出到 stdout。它会创建父目录，拒绝覆盖已有文件。更新时使用新文件名；已有副本是带日期的快照，不代表当前指导已重新核实。

同一命令也接受 API 网址，例如 `https://developer.apple.com/documentation/swiftui/view/glasseffect(_:in:)`。支持公开页面、`.md` 和 DocC `.json` 网址。章节锚点和查询参数会被移除，读取的是整页的默认语言变体，不会按查询参数切换翻译或 Objective-C 变体。

输出包含标题、来源网址、读取时间、文章正文、表格、列表、框架分页、代码、API 可用版本、相关主题、图片描述与链接，以及 Apple 的版权声明。正文中的 `doc://` 标识会解析为带名称的 HTTPS 链接，媒体相对路径按 Apple 的 `/tutorials/` 素材根目录解析。读取器不下载图片和视频；决策依赖外观时，应单独检查这些素材。提取文字不代表完成视觉验证。

### 失败行为与替代方式

仅显示“This page requires JavaScript”的 HTML 响应并不是正文。Apple 自己的 Markdown 也可能包含未解析的 `doc://` 引用。读取器统一使用 DocC 处理 HIG 和 API 页面，无需浏览器渲染、API key、MCP 服务或 npm 包。

HTTP 错误、HTML 空壳、文档标识不匹配、未解析的引用，以及不支持的正文结构，都会以非零状态退出并明确报错。转换完成后才打开输出文件，因此读取或格式错误不会留下看似成功的残缺文章。DocC 接口属于 Apple 网站的实现细节，未来可能变化。

如果没有 Node 或命令执行能力，继续使用随 skill 附带的参考文件，或使用可用的只读 HTTP 工具读取对应的 DocC JSON。以下示例已经验证：

| 公开页面                                                                              | DocC 数据                                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `https://developer.apple.com/design/human-interface-guidelines/materials`             | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json`             |
| `https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass` | `https://developer.apple.com/tutorials/data/documentation/technologyoverviews/adopting-liquid-glass.json` |

直接读取 JSON 时，检查 `metadata.title`，阅读 `abstract`、`primaryContentSections` 和相关 `topicSections`，并通过 `references` 解析正文引用。保留框架分页、表格、代码、图片说明和版本条件。读取或转换失败时，使用可访问的官方页面或获准使用的浏览器，并指出具体哪项结论尚未核实。Apple Design 入口、资源下载和 WWDC 视频使用各自的页面，不属于此读取器的范围。

任务中生成的 Apple 文档保存在临时或被忽略的目录，与独立编写、采用 MIT 许可的 skill 分开，保留来源与版权声明。回答中引用便于人阅读的 Apple 网页网址，并区分本地快照、实时读取和搜索摘要。

## 设计素材与工具

- [Apple Design Resources](https://developer.apple.com/design/resources/)：按平台和版本选择官方 UI 套件、图标模板及产品素材。使用页面当前提供的下载链接，不在此固定素材版本。
- [SF Symbols](https://developer.apple.com/sf-symbols/)：项目使用 SF Symbols 时，检查图标语义选择与支持的变体。保留项目明确选择的图标体系。
- [Fonts](https://developer.apple.com/fonts/)：选择或准备字体时，查阅平台排版资源。
- [Icon Composer](https://developer.apple.com/icon-composer/)：制作分层应用图标时查阅。普通界面审查不代表要重新设计产品的应用图标。

## 更新本地知识

用户要求更新此 skill 时，修改负责该主题的本地文件。区分稳定的设计判断依据和版本相关事实。保留简洁、独立表述且能帮助下一个 agent 决策的指导，附上来源和核实日期。用新指导替换过时指导，不要在更新日志中积累第二套版本。

普通设计任务是使用 skill，不代表授权修改它或下载整个文档站。针对性的修正可能只需一个来源，用户要求的广泛更新则可能需要多个来源。能力或范围改变时，同步更新调用元数据，然后验证 skill 和本地引用。
