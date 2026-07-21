# feathery-react

## Package manager
This project uses **yarn**. Always use `yarn add` / `yarn` instead of `npm install`.

## This is a distributed SDK - keep hosts' deps out
`@feathery/react` must not import host-only libraries (e.g. SyncFusion).
The docx editor (`src/elements/components/DocxEditor`) loads SyncFusion from a CDN at runtime and hands its live instance out via `onEditorReady`; the assistant reaches it only through host-injected handlers.
Robin ASSISTANT tool dispatch lives in `src/assistant/tools/assistantToolDispatch.ts` (SyncFusion-free), wired into `AssistantChat` `onToolCall`.
The in-form `docx_editor` field (`src/elements/fields/DocxEditorField`) registers its live editor into `src/assistant/tools/docxEditorRegistry.ts` (keyed by form `_internalId`); `AssistantChat` falls back to `createDocxEditorBridge` (`docxEditorBridge.ts`) over that registry so `getDocumentInventory`/`applyDocumentEdits` act on the field's editor when no host `docxBridge` prop is passed.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
