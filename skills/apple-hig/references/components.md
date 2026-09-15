# Component choices

Local guidance checked 2026-09-16. Choose a component by the task and interaction it supports. The examples below are applications of the guidance, not mandated product layouts.

## Navigation

**Tab bar:** use for peer, top-level destinations. Preserve each destination's navigation state when switching. Keep destinations stable even when a section has no content; explain the empty state instead of making the destination disappear. Use short, descriptive labels. Actions such as exporting belong in a control or menu rather than a destination tab.

Source: [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars).

**Sidebar:** use when the hierarchy and available space benefit from a persistent navigation list. Group related destinations and keep labels concise. Prefer shallow hierarchy; a content list between the sidebar and detail view can handle deeper structures. Let people reveal or hide the sidebar through familiar controls where useful, and preserve discoverability. Customization can help people reach their own frequent destinations.

Source: [Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars).

## Toolbars and menus

**Toolbar:** surface useful actions for the current content, along with orientation and navigation controls such as titles, back controls, or search. Group related actions and retain a predictable order. Prioritize items at narrower widths and use the platform's built-in overflow behavior. Put less frequent actions behind a More menu only when the extra layer is useful. Let native controls and the system toolbar provide their backgrounds and supported customization.

Source: [Toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars).

**Menu:** expose commands or choices relevant to the current context. Use concise labels that describe the result, and show selected states or keyboard equivalents where applicable. Keep temporarily unavailable commands recognizable through the native disabled state. A menu containing unavailable commands can still be opened so people can discover them. Context menus offer convenient access to contextual actions; app menus organize the broader command set.

Source: [Menus](https://developer.apple.com/design/human-interface-guidelines/menus).

## Buttons and value controls

Use a button for an action; choose a dedicated toggle, picker, or segmented control when the operation is changing a value or selection. Make the result clear through the label, icon, role, and style.

Use prominence sparingly to distinguish the likely action. In a group of comparable choices, prefer a more prominent style over an arbitrarily larger button. Preserve enough spacing for the input method. A custom button needs an immediate pressed state as well as disabled, focus, keyboard, and accessibility behavior; native controls supply much of this contract.

Source: [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons).

## Windows, sheets, and popovers

| User need                                              | Starting choice | Key consequence                                   |
| ------------------------------------------------------ | --------------- | ------------------------------------------------- |
| Work on an independent item alongside existing content | Window          | Supports parallel work and independent placement. |
| Complete a short task associated with a parent         | Sheet           | Makes the task's relation to its parent explicit. |
| Inspect or adjust a few contextual details temporarily | Popover         | Remains anchored to the invoking element.         |

**Windows:** support resizing and preserve native window controls and frames. Open additional windows when parallel work or retaining context benefits the user. Avoid multiplying windows for ordinary navigation. A persistent editor can deserve a separate window where a short configuration step does not.

Source: [Windows](https://developer.apple.com/design/human-interface-guidelines/windows).

**Sheets:** keep the task focused and dismissal semantics clear. Cancel abandons uncommitted changes; Done completes the task. Back moves within a flow rather than dismissing the presentation. A sheet is modal on Mac, watchOS, tvOS, and visionOS; iOS and iPadOS also support nonmodal sheets. Avoid stacking sheets from the main interface. For prolonged editing or tools that must remain available while using the parent, consider the platform's window, panel, split-view, or nonmodal presentation options.

Source: [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets).

**Popovers:** keep content compact, related, and anchored near its source. Avoid covering information needed for the task. Show one at a time, with familiar outside-click dismissal where applicable. Automatically dismissing a nonmodal popover should preserve work; discard it only through explicit cancellation. Keep a multiple-selection popover open long enough to finish the selection. Use a more suitable presentation for a warning that must not be missed.

Source: [Popovers](https://developer.apple.com/design/human-interface-guidelines/popovers).

## Applying the choice to a feature

Identify the entry point, selected context, action, visible result, and dismissal or recovery path. Check only the states the feature actually has: a settings pane might need selection and disabled states; an export flow also needs progress, failure, and completion. Explain any custom behavior relative to this concrete task rather than assuming a custom surface is inherently an improvement.
