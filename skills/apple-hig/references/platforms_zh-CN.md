# 平台习惯

本地平台指导，核实日期：2026-09-16。阅读实际目标平台的章节；统一品牌并不要求布局或输入行为完全相同。

## macOS

面向持续工作、精确指针操作、键盘命令，以及多个应用或窗口配合使用的情境设计。利用可用空间展示有用内容，减少不必要的导航层级。保持舒适的信息密度，不要将所有元素放大到手机界面的比例。

支持调整大小、窗口管理、选择，以及清楚的活跃和非活跃状态。将相关命令放进菜单，并保留标准快捷键。不同用户的常用操作不同时，工具栏或侧边栏可以支持自定义。独立窗口可以支持并行工作；模态呈现应服务于聚焦的任务。

来源：[Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)。

## iOS

让主要内容和操作容易触达，同时保留次要操作的可发现性。考虑单手触控、横竖屏、虚拟键盘，以及快速返回被中断任务的情境。

支持平台熟悉的手势，包括适用场景中的返回导航。布局应适配字号、方向和外观。只有在与任务相关且得到使用者授权时，才利用设备能力减少不必要的输入。

来源：[Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios)。

## iPadOS

利用更大的画布展示不同内容区域之间的关系，减少重复的全屏切换。根据实际可用的窗口大小适配，不要假设应用始终占满整个显示屏。

任务能够受益时，将触控、指针、键盘和 Pencil 视为互补的输入方式。即使连接了键盘，控件也应保持可触控。多任务和拖放等跨应用交互有助于任务时，应予以支持。布局和输入方式变化时，保留用户上下文。

来源：[Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados)。

## watchOS

让关键信息一眼可见，操作简短。优先使用浅层导航和聚焦的页面，而不是压缩版手机应用。使用数码表冠进行合适的滚动或导航。

表盘复杂功能和及时、可操作的通知可以让用户无需打开应用就获得信息。应用本身也应提供有用的独立功能。减少需要长时间关注或多次精确点按的交互，并通过背景处理强化层级。

来源：[Designing for watchOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos)。

## tvOS

面向隔着房间观看、使用遥控器导航的情境设计。采用系统焦点行为，让用户知道当前目标并能预测下一步移动。文字和操作在相应距离下仍需清楚可辨。

以图像和媒体承载体验，同时保持控件清晰。将登录和家庭成员切换也视为任务的一部分：减少重复输入；应用支持个人资料时，保持正确的观看者上下文。

来源：[Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos)。

## visionOS

根据任务选择窗口、体积内容（volume）或沉浸式体验。保留用户的空间感以及对沉浸程度的控制。采用系统放置方式和交互习惯来保障舒适度。

考虑先注视目标、再通过间接手势激活的操作，以及受支持的替代输入。避免让用户为了操作普通控件而反复伸手或移动身体。空间内容和音频应帮助理解体验；深度与沉浸会带来平面布局之外的舒适度要求。

来源：[Designing for visionOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos)。

## 应用这些习惯

跨平台保持用户目标与领域语言一致，同时根据各平台优势调整导航、信息密度、控件位置和反馈。界面形式选择参见本地[组件指南](components_zh-CN.md)，输入与可读性检查参见[无障碍指南](accessibility_zh-CN.md)。新的平台能力若影响实现，其具体行为仍需 SDK 或对应版本的证据。
