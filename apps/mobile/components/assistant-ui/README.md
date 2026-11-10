# assistant-ui native Elements

Installed from the [official React Native registry](https://www.assistant-ui.com/docs/react-native/elements) on 2026-11-04. `registry-manifest.json` records each original URL, upstream path, and SHA-256 of its downloaded source. The upstream project is MIT licensed.

The reader mounts the official native `Thread`, runtime and primitives for messages, Markdown, reasoning, tool fallback, typing indicator, composer, send/stop controls and copy action. Book additions live in `src/ui/chat/ReaderAssistantParts.tsx`; they do not replace the official message body or composer.

The appearance follows Shudeng's approved visual Demo: warm paper colors, quiet message hierarchy, a floating input card and book-scoped source links. The earlier starting point was the [official Claude **Web** example](https://www.assistant-ui.com/examples/claude); this remains a local React Native adaptation, not an upstream native Claude theme. Both light and dark palettes live in `global.css`.

Local differences from the downloaded registry:

- `thread.aui.tsx`: optional host refs/events and message/composer slots preserve book selection, citations and scroll restoration; keyboard avoidance and bottom padding can be delegated to the enclosing sheet. `composerExternal` and the shared `ThreadComposer` let the host use Gorhom's fixed footer without duplicating the composer or runtime.
- Mobile layout keeps the floating composer at the bottom, including an empty conversation. Text input sits above the context/send action row and grows from 44 to 144 points for multiline text, then scrolls; menu/send/stop and message actions use 44-point touch targets. Message spacing, user bubbles, circular send/stop controls and the compact centered welcome follow the approved Demo. Welcome, common tool/reasoning states and accessibility labels use Chinese. Desktop mode tabs and hover-only interactions are omitted.
- `typography.ts` and `markdown-text.tsx`: platform system serif fonts for prose, with monospace code preserved. Links use a darker/lighter orange token for readable contrast in each theme.
- Unsupported image attachments, editing and regeneration are hidden using runtime capabilities.
- `thread.aui.tsx`, `tool-fallback.tsx`, `reasoning.tsx`, `ui/icon.tsx`: explicit optional-property handling for this repository's `exactOptionalPropertyTypes`; strictness is unchanged.

The manifest hashes describe the originally downloaded source; they are not hashes of the locally adapted files.

The enclosing reader sheet uses the shared `src/ui/components/AppSheet.tsx` wrapper around `@gorhom/bottom-sheet@5.2.14` for its two snap points, handle, backdrop and continuous appearance. `src/ui/chat/ChatSheet.tsx` adds the book title, full-screen/collapse actions and fixed footer. `src/ui/chat/AssistantSheetAdapter.tsx` connects the native message list's scroll component and composer input to the library while preserving assistant-ui's message providers. The transparent route only owns navigation lifetime; the app does not implement its own drag or snap algorithm. Native appearance, keyboard resizing, streaming, source navigation and sheet gestures need simulator/device acceptance after bundling. Type checks and chat regressions cannot establish those device behaviors.

The library's animated progress drives the host's continuous corner/safe-area appearance. Its final footer position also defines the empty view's visible region; the composer uses a transparent footer base with a floating card and retains the library's content padding adjustment. These are appearance/layout adapters, not replacement gesture or keyboard implementations.
