# 来源查询与维护

当 `SKILL_zh-CN.md` 中的条件要求外部查询，或用户要求更新 skill 时，阅读此文件。它不是日常使用的必经步骤。本地知识与读取示例核实于 2026-09-16。

## 解决具体的信息缺口

先查看相关本地指导旁记录的来源。对于尚未覆盖的设计主题，在 [Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) 内搜索。需要精确的 API 行为或可用版本时，检查已安装的 SDK 或 Apple 框架文档。用户询问当前版本时，通过 [Apple Design](https://developer.apple.com/design/) 查找新发布的资源。

阅读能回答问题的具体章节。当前 HIG 与旧 WWDC 示例有差异时，优先采用当前 HIG；区分设计建议与 API 约束。应用到最低部署版本前，确认材料是否属于测试版或特定平台。

## 读取需要 JavaScript 的页面

仅显示“This page requires JavaScript”的 HTML 响应并不是文章正文。若页面提供 Apple 官方 Markdown 链接，优先使用。无法使用时，Apple 文档站也为许多页面提供 DocC JSON。以下示例已核实：

| 公开页面                                                                              | DocC 数据                                                                                                 |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `https://developer.apple.com/design/human-interface-guidelines/materials`             | `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json`             |
| `https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass` | `https://developer.apple.com/tutorials/data/documentation/technologyoverviews/adopting-liquid-glass.json` |

使用可用的只读 HTTP 工具读取。确认响应是 JSON，且 `metadata.title` 与目标文章一致。阅读 `abstract`、`primaryContentSections` 和相关的 `topicSections`。通过 `references` 解析正文中的引用标识，保留 API 名称、链接标题和图片描述。决策依赖示例外观时，需要查看图片；只有文字不能验证布局。

数据网址的构造方式只是可尝试的后备方案，不是稳定的公开 API 约定。不可用时，使用可访问的官方页面或获准使用的浏览器。回答中引用便于人阅读的 Apple 网页地址，并区分搜索摘要与完整文章。查询失败只限制尚未解决的结论，不影响已有本地指导支持的决策。

## 设计素材与工具

- [Apple Design Resources](https://developer.apple.com/design/resources/)：按平台和版本选择官方 UI 套件、图标模板及产品素材。使用页面当前提供的下载链接，不在此固定素材版本。
- [SF Symbols](https://developer.apple.com/sf-symbols/)：项目使用 SF Symbols 时，检查图标语义选择与支持的变体。保留项目明确选择的图标体系。
- [Fonts](https://developer.apple.com/fonts/)：选择或准备字体时，查阅平台排版资源。
- [Icon Composer](https://developer.apple.com/icon-composer/)：制作分层应用图标时查阅。普通界面审查不代表要重新设计产品的应用图标。

## 更新本地知识

用户要求更新此 skill 时，修改负责该主题的本地文件。区分稳定的设计判断依据和版本相关事实。保留简洁、独立表述且能帮助下一个 agent 决策的指导，附上来源和核实日期。用新指导替换过时指导，不要在更新日志中积累第二套版本。

普通设计任务是使用 skill，不代表授权修改它或下载整个文档站。针对性的修正可能只需一个来源，用户要求的广泛更新则可能需要多个来源。能力或范围改变时，同步更新调用元数据，然后验证 skill 和本地引用。
