# Agent Guidelines for VIP Redactosaurus

## Core Rules

- No fallback code, no workarounds, no legacy code. If something fails, report the root cause.
- No narrating comments. Comments only for non-obvious intent.
- No dead code, no commented-out code.
- DRY. If logic exists somewhere, reuse it.
- Read the file before editing it. Do not guess names, selectors, or function signatures.

## Architecture

This is a Chrome extension (Manifest V3) with three components that communicate via `chrome.runtime.sendMessage`:

- **Content script** (`content/redactosaurus.js`) runs at `document_start`, manipulates the DOM.
- **Background service worker** (`background/background.js`) persists state in `chrome.storage.local`.
- **Popup** (`popup/popup.html` + `popup/popup.js`) provides user controls.

State flows: popup -> background (storage) -> content script reads on init and listens for messages.

## Redaction Layers (order matters)

1. **Global text sweep** (`sweepTextNodes`) - TreeWalker replaces the real customer domain with the fake domain across all text nodes. This is the broadest, most resilient layer.
2. **Href-pattern selectors** - Transformations in `config.json` target elements by URL structure (e.g. `a[href*='/authors/']`), not CSS classes. CSS classes change with UI updates; URL structures do not.
3. **Structural selectors** - Used only when href matching is not possible (images, publisher name badge, site picker input).

When adding new redaction targets, prefer layer 1 or 2. Only use layer 3 as a last resort.

## Key Design Decisions

**No CSS class selectors for content matching.** Parse.ly's class names change between deploys. Use `[href*='...']` patterns against their stable URL structure instead.

**Paired headline/section data.** `content/articles.js` contains `{ headline, section }` objects. When a post row gets a fake headline, it gets the matching section from the same entry. Do not separate these into independent lists.

**Single fake identity.** `FAKE_IDENTITY` holds the publisher name and domain (configurable from the popup, defaults to "Demo Network" / "demosite.test"). There is no per-customer mapping. The `.test` TLD is IANA-reserved.

**No customer-specific code.** The extension detects the customer domain from the URL automatically. Never hardcode domain names, customer IDs, or site-specific logic.

**SPA navigation handling.** Parse.ly is a single-page app. `checkForUrlChange()` runs each processing cycle to detect navigation and re-apply redaction. Do not rely on page load events alone.

## Config Structure (`content/config.json`)

All transformation rules are data-driven. To add a new redaction target, add an entry to the `transformations` array. Do not add processing logic inline in `redactosaurus.js` for one-off cases.

Transformation types: `functionReplace`, `scramble`, `blur`. Each has an `options` object specific to its type.

Conditional transformations use `enabledSetting` + `enabledValue` to toggle based on stored settings. `MODE_SETTINGS` in `redactosaurus.js` lists which settings the popup can override (`headlineMode`, `authorMode`); stored values are applied over the `config.json` defaults on load. Popup mode dropdowns are wired by a `data-setting` attribute and share the single `updateMode` message — do not add a per-setting message action.

## Adding Replacement Functions

Replacement functions live in the `replacementFunctions` object inside `redactosaurus.js`. Register new ones there, then reference them by name in `config.json` via `functionName`. Do not call replacement logic directly from `processElement`.

## Files to Know

| File | Purpose |
|---|---|
| `content/redactosaurus.js` | All DOM processing, customer detection, text sweep |
| `content/config.json` | Declarative transformation rules |
| `content/articles.js` | Paired headline + section JSON data |
| `background/background.js` | State persistence and cross-component messaging |
| `popup/popup.html` + `popup.js` | Extension UI |
| `manifest.json` | Extension config, content script injection targets |
