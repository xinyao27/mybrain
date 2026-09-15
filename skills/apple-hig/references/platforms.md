# Platform conventions

Local platform guidance checked 2026-09-16. Read the section for the actual target; shared branding does not require identical layouts or input behavior.

## macOS

Design for sustained work, precise pointer interaction, keyboard commands, and several apps or windows used together. Use the available space to expose useful content and reduce unnecessary navigation depth. Preserve comfortable information density rather than enlarging everything to phone proportions.

Support resizing, window management, selection, and clear active/inactive states. Put relevant commands in menus and preserve standard shortcuts. A toolbar or sidebar can offer customization when different users need different frequent actions. Separate windows can support parallel work; modality should serve a focused task.

Source: [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos).

## iOS

Make primary content and actions easy to reach while secondary actions remain discoverable. Account for one-handed touch, portrait and landscape use, virtual keyboards, and quick returns to an interrupted task.

Support the platform's familiar gestures, including back navigation where applicable. Adapt layout to text size, orientation, and appearance. Use device capabilities to reduce unnecessary input only when relevant and authorized by the person using the app.

Source: [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios).

## iPadOS

Use the larger canvas to show relationships between content areas and reduce repeated full-screen transitions. Adapt to the available window size, rather than assuming the app always occupies the entire display.

Treat touch, pointer, keyboard, and Pencil as complementary inputs when the task benefits from them. Keep controls usable with touch even when a keyboard is attached. Support multitasking and inter-app interactions such as drag and drop where they improve the task. Preserve context as layout and input modes change.

Source: [Designing for iPadOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ipados).

## watchOS

Make essential information glanceable and actions short. Prefer shallow navigation and focused screens over a compressed version of the phone app. Use the Digital Crown for appropriate scrolling or navigation.

Complications and timely, actionable notifications can reach people without requiring an app launch. Design the app itself to provide useful independent functionality. Limit interactions that require prolonged attention or many precise taps, and use background treatment to reinforce hierarchy.

Source: [Designing for watchOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-watchos).

## tvOS

Design for viewing from across a room and navigating with a remote. Use the system focus behavior so people can identify the current target and predict the next move. Keep text and actions readable at that distance.

Let artwork and media carry the experience while controls remain clear. Treat sign-in and switching among household viewers as part of the task: minimize repeated entry and preserve the correct viewer context when the app supports profiles.

Source: [Designing for tvOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos).

## visionOS

Choose between windows, volumes, and immersive experiences according to the task. Preserve the person's sense of place and ability to control immersion. Let system placement and interaction conventions support comfort.

Account for looking at a target and activating it with an indirect gesture, as well as supported alternative inputs. Avoid requiring repeated reaching or movement to operate ordinary controls. Spatial content and audio should clarify the experience; depth and immersion introduce comfort considerations beyond a flat-screen layout.

Source: [Designing for visionOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos).

## Applying the conventions

Keep the user's goal and domain language consistent across platforms while adapting navigation, density, control placement, and feedback to each platform's strengths. Consult the local [component guide](components.md) for surface choices and [accessibility guide](accessibility.md) for input and legibility checks. Exact new platform capabilities still need SDK or release-specific evidence when they affect an implementation.
