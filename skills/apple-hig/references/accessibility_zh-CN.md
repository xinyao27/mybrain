# 无障碍

本地指导，核实日期：2026-09-16。应用与所改交互相关的检查；小改动不代表需要审计整个应用。

## 感知与操作

- 用多种信号传递含义：颜色应配合标签、形状或其他有用的区分方式。重要声音需要对应的可见或文字信息。
- 放大文字后，内容仍应可用。让布局重新排布，不要裁掉任务的关键信息。采用平台支持的放大机制。
- 在支持的外观及增强对比度设置下，结合实际背景检查对比度。优先使用带无障碍变体的语义颜色。
- 让操作目标容易区分，并根据输入方式保持足够间距。保留原生控件尺寸；紧凑的指针界面与空间注视目标有不同约束。自定义控件采用其组件专属的目标尺寸指导，不要套用统一尺寸。
- 尊重系统设置和辅助输入。需要精细操作的手势，应有无障碍方式完成相同操作。

来源：[Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)。

## VoiceOver

为交互元素提供有意义的无障碍名称，并通过原生控件或无障碍 API 暴露角色、值和状态。描述有意义的图片，让交互式图表的信息可访问；排除纯装饰图像。

通过标题、分组和阅读顺序，表达原本仅靠视觉邻近关系传达的联系。标签应与功能实际行为同步。检查界面对无障碍工具暴露的信息，不要假设有可见文字或图标就足够了。

来源：[VoiceOver](https://developer.apple.com/design/human-interface-guidelines/voiceover)。

## 键盘操作

保留熟悉的键盘快捷键，为新命令设置新的快捷键。区分文字编辑、平台普通焦点行为和“全键盘控制”（Full Keyboard Access）。让系统提供导航和激活能力，不要手动复刻每一种按键交互。

审查时检查相关路径：进入界面、到达控件、激活操作，以及关闭或返回。遵循平台行为；iPadOS 控件导航依赖“全键盘控制”，不应不加区分地套用桌面焦点行为。

来源：[Keyboards](https://developer.apple.com/design/human-interface-guidelines/keyboards)。

## 动效与透明度

启用“减弱动态效果”时，在减少干扰性运动的同时保留状态反馈。启用“降低透明度”或“增强对比度”时，检查自定义内容是否仍适配材质调整后的外观。原生组件可以自动适配，但周围的自定义颜色和动画仍然需要关注。

来源：[Motion](https://developer.apple.com/design/human-interface-guidelines/motion)、[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)。

## 证据

采用仓库允许的验证方式。代码检查能够发现缺失标签或自定义行为，但不能证明完整的 VoiceOver 体验、可读性或键盘遍历体验。将这些列为已授权工具操作或用户手动操作时的针对性检查，并区分未验证行为与已确认缺陷。
