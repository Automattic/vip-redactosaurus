# VIP Redactosaurus

A Chrome extension that anonymizes Parse.ly dashboards before they render, so Sales can demo a live, data-rich product without showing who the customer is. Runs at `document_start` to prevent a flash of real content.

Customer detection is automatic. The extension reads the site id from the dashboard URL (for example `nypost.com` in `https://dash.parsely.com/nypost.com/`) and swaps that identity for a single fake publisher. There is no per-customer mapping and no customer-specific code.

## What gets anonymized

| On screen | What happens | Default |
|---|---|---|
| Customer name in text (headers such as “The Gazette Sites”) | Swept to the configured publisher name | Demo Network |
| Customer domain in text and post-row URLs | Swept to the configured fake domain | demosite.test |
| Headlines | Replaced from a local list of 228 paired headline/section entries, or scrambled | **Replace** |
| Author names | Replaced from first/last name lists, or scrambled | **Replace** |
| Section names | Replaced with the section paired to that row’s headline | Always replace |
| Article thumbnails | Replaced from `assets/thumbnails/` (local JPEGs), or blurred | **Replace** |
| Publisher name badge | Replaced with the configured publisher name | Demo Network |
| Site picker field | Text made invisible | Always on |
| SEO / Google key labels | Scrambled in place | Always scramble |
| Page Views, Visitors, and other factoid numbers | Left as-is (they do not identify the customer) | Visible |
| Chrome hover link preview | Dashboard links show `https://dash.parsely.com`; external links show `https://demosite.test` (or the configured fake domain) | **On** |
| Tab address bar | Optional same-origin iframe so the tab stays `https://dash.parsely.com/` | **Off** (experimental) |
| Clicks to the customer’s public site | Prompt: “This opens the real customer site.” Cancel stays on the dash; confirm opens at the top level | Always when anonymization is on |

Product navigation labels (Posts, Authors, Sections, Tags, Pages) are not rewritten. Author and section rules match profile URLs only, not `/authors/` or `/sections/` index links.

**Replace vs scramble.** Replace uses a prepared list (headlines, names, or stock photos) and looks like a real dashboard. Scramble keeps length and first/last letters (`Emily Goodman` → something like `Ehxjy Gfrnhn`) and is harder to read. Thumbnails use replace or blur, not scramble.

**Limits.** The brand-name sweep only matches a single word derived from the domain (`gazette` matches “The Gazette”; `dailyplanet` will not match “Daily Planet”). The publisher name and domain you configure must not contain the customer id or that brand token, or the sweep would rewrite its own output forever and is skipped. Displayed URLs may contain zero-width spaces around dots; the domain sweep allows those so `jefferies.com` is not reduced to `Demo Network.com`.

## Installation

1. [Download the extension](../../releases/latest/download/redactosaurus.zip) and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped `redactosaurus` folder.
5. Turn on Redactosaurus using the extensions button to the right of the URL bar.

## Extension Popup

All of these persist and apply live, without reloading the page.

| Control | Default | Notes |
|---|---|---|
| **Anonymization** | On | Master switch |
| **Hide hover links** | On | Rewrites Chrome’s status-bar preview as above. Turn off to inspect real hrefs while debugging |
| **Hide address bar** | Off | Experimental. Frames the dash so the tab URL has no customer path. Turn off if the frame stays blank or the app jumps out |
| **Keep screen awake** | On (new installs) | For live demos |
| **Show publisher name as** | Demo Network | Fake identity shown on the page, not the value to search for |
| **Show domain as** | demosite.test | IANA-reserved `.test` TLD. Also used for external hover previews |
| **Headline mode** | Replace with random headlines | Or scramble existing headlines |
| **Author mode** | Replace with random names | Or scramble existing names |
| **Thumbnail mode** | Replace with local photos | Or blur existing thumbnails |

## How It Works

Redaction happens in three layers, from broad to specific:

1. **Global text sweep** — A `TreeWalker` replaces the detected customer domain with the fake domain and the brand token from that domain with the fake publisher name, across all text nodes. Domain patterns run first so the brand token cannot match inside an already-swapped domain.
2. **Href-pattern selectors** — Authors and sections are matched by URL structure (`/authors/slug`, not `/authors/?…`), not CSS classes. Parse.ly class names change between deploys; URL structure does not.
3. **Structural selectors** — Used only when href matching is not possible (thumbnails, publisher badge, site picker).

`sweepHrefs` changes each `a[href]` for Chrome’s hover preview. The real destination is stored by the extension (keyed to the element, not an id on the tag). A capture-phase click listener navigates there. Inline `onclick` cannot do this — the page CSP blocks it.

## Configuration

All transformation rules live in `content/config.json`.

### URL Patterns

```json
"urlPatterns": {
  "parsely": {
    "pattern": "https://dash\\.parsely\\.com/([^/?]+)",
    "customerIdGroup": 1
  }
}
```

### Transformation Types

**`functionReplace`** — Replace element text using a named JS function. Supports `preserveChildren` to only replace direct text nodes.

**`scramble`** — Randomize existing text while preserving structure (case, punctuation, spacing, word length, first and last letters).

**`blur`** — Apply a CSS blur filter. Images are scaled slightly so the blur does not reveal the backdrop at their edges. Used when Thumbnail mode is **blur**.

**`defaultImage`** — Replace every matching `img` with a local stock photo from `assets/thumbnails/`. Customer thumbnails stay at `opacity: 0` until the `src` is a `chrome-extension://` URL. The pool file is chosen by hashing the original `src` (and skipping a repeat on the next row). Used when Thumbnail mode is **replace**.

`assets/thumbnails/index.json` is a JSON array of filenames, for example `["01.jpg", "02.jpg"]`. Add JPEGs there and list them in the index. `assets/*` is already in `web_accessible_resources`.

Headlines, authors, and thumbnails are switched from the popup with `enabledSetting` + `enabledValue` (`headlineMode`, `authorMode`, `thumbnailMode`). Do not add a per-setting message action.

### Available Replacement Functions

| Function | Description |
|---|---|
| `generateRandomHeadline` | Next unused headline from `content/articles.js`, sticky per post row |
| `generateRandomSectionName` | Section from the same article entry as that row’s headline |
| `generateRandomAuthorName` | Random first + last name from the lists in `config.json` |
| `generatePublisherName` | Configured publisher name |

## Content Data

`content/articles.js` contains paired `{ headline, section }` objects. When a post row gets a fake headline, it gets the matching section from the same entry.

## Project Structure

```
├── manifest.json              Chrome extension manifest (V3)
├── background/background.js   Service worker for state and messaging
├── popup/popup.html            Extension popup UI
├── popup/popup.js              Popup logic
├── content/redactosaurus.js    Content script (runs at document_start)
├── content/config.json         Transformation rules
├── content/articles.js         Paired headline + section data
└── assets/                     Icons, CSS, stock thumbnail pool
    └── thumbnails/             Local JPEGs + index.json
```

## Notes

- All processing is local. No data leaves the browser.
- `MutationObserver` and a short polling interval handle Parse.ly’s SPA navigation.
- Switching customers in the site picker re-detects the domain and re-applies redaction.
- The `.test` TLD is IANA-reserved, so fake domains cannot collide with real ones.
