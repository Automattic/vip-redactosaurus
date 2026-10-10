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

1. **Global text sweep** (`sweepTextNodes`) - TreeWalker replaces the real customer domain with the fake domain, and the brand token derived from that domain (`getBrandToken`) with the fake publisher name, across all text nodes. This is the broadest, most resilient layer. Domain patterns are applied before name patterns so the brand token cannot match inside an already-swapped domain. Domain matches allow Unicode format characters between labels; Parse.ly inserts ZWSP around dots in displayed URLs, and a literal `gazette.com` would miss `gazette​.​com` and leave the label for the brand token to eat. `sweepHrefs` sets every `a[href]` to `http://dash.parsely.com` so Chrome's status-bar link preview cannot leak a customer host or a path slug (author names). The real destination is kept off-DOM and a capture-phase click listener navigates there. Inline `onclick` cannot do this — the page CSP blocks it. **Hide address bar** (off by default) wraps the top frame in a same-origin iframe and `replaceState`s the tab to `/` so the omnibox does not show the customer path. Do not mask `history` on the dashboard document itself. If the iframe does not signal ready, navigate back to the real URL. A wrap that is immediately dismissed is treated as frame-busting and is not retried that session.

**The sweep must converge.** It re-runs every cycle over text it already rewrote, so any replacement whose own output still matches a redaction pattern will rewrite its own result forever and grow the text without bound. `buildSweepReplacements` drops such replacements and logs why. Never add a sweep replacement without checking its output against the active patterns.
2. **Href-pattern selectors** - Transformations in `config.json` target elements by URL structure (e.g. `a[href*='/authors/']`), not CSS classes. CSS classes change with UI updates; URL structures do not.
3. **Structural selectors** - Used only when href matching is not possible (images, publisher name badge, site picker input).

When adding new redaction targets, prefer layer 1 or 2. Only use layer 3 as a last resort.

## Key Design Decisions

**No CSS class selectors for content matching.** Parse.ly's class names change between deploys. Use `[href*='...']` patterns against their stable URL structure instead.

**Never select on `data-v-*` attributes.** Parse.ly's Vue components carry scoped-style hashes like `data-v-95802abd`. These are build output and change whenever the component is recompiled, so they look stable in devtools and are not. Prefer stable structure (for example `div.factoid div.figure > div`) over those hashes.

**Paired headline/section data.** `content/articles.js` contains `{ headline, section }` objects. When a post row gets a fake headline, it gets the matching section from the same entry. Do not separate these into independent lists.

**Single fake identity.** `FAKE_IDENTITY` holds the publisher name and domain (configurable from the popup, defaults to "Demo Network" / "demosite.test"). There is no per-customer mapping. The `.test` TLD is IANA-reserved.

**No customer-specific code.** The extension detects the customer domain from the URL automatically. Never hardcode domain names, customer IDs, or site-specific logic.

**SPA navigation handling.** Parse.ly is a single-page app. `checkForUrlChange()` runs each processing cycle to detect navigation and re-apply redaction. Do not rely on page load events alone.

## Config Structure (`content/config.json`)

All transformation rules are data-driven. To add a new redaction target, add an entry to the `transformations` array. Do not add processing logic inline in `redactosaurus.js` for one-off cases.

Transformation types: `functionReplace`, `scramble`, `blur`, `defaultImage`. Each has an `options` object specific to its type.

Types listed in `CONTINUOUS_TYPES` are never marked processed and so re-run every cycle. Use this only when the app can restore original content after we rewrite it — `defaultImage` needs it because Vue resets thumbnail `src`s and an img's textContent hash does not detect that. Everything else must be marked processed or it will fight the app on every tick.

Conditional transformations use `enabledSetting` + `enabledValue` to toggle based on stored settings. `MODE_SETTINGS` in `redactosaurus.js` lists which settings the popup can override (`headlineMode`, `authorMode`, `thumbnailMode`); stored values are applied over the `config.json` defaults on load. Popup mode dropdowns are wired by a `data-setting` attribute and share the single `updateMode` message — do not add a per-setting message action.

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
