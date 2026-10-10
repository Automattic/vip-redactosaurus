# VIP Redactosaurus

A Chrome extension that anonymizes Parse.ly dashboards before they render, enabling safe product demos without exposing customer data. Runs at `document_start` to prevent any flash of real content.

## How It Works

Redaction happens in three layers, from broad to specific:

1. **Global text sweep** - A `TreeWalker` replaces every occurrence of the detected customer domain (e.g. `gazette.com`) with a fake domain (`demosite.test` by default) and every occurrence of the brand token derived from that domain (`gazette`) with the fake publisher name, across all text nodes. The brand token catches header labels the app builds from the account name, such as "The Gazette Sites - gazette.com".

   Two limits apply. The token only matches when the brand renders as one word (`gazette` matches "The Gazette", but `dailyplanet` will not match "Daily Planet"). And the publisher name and domain you configure must not contain the customer id or brand token — a replacement that matches its own output would rewrite it on every cycle, so the sweep drops it and logs an error instead.
2. **Href-pattern selectors** - Content like authors and sections is matched by URL structure rather than CSS classes, making it resilient to UI changes. Index and nav links (`/authors/?…`, `/authors/`) are excluded so product labels stay intact.
3. **Structural selectors** - A few specific selectors handle elements where href matching isn't possible (image thumbnails, publisher name, site picker).

Customer detection is automatic. The extension reads the domain from the Parse.ly dashboard URL and generates a consistent fake identity for it.

## Installation

1. [Download the extension](../../releases/latest/download/redactosaurus.zip) and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the unzipped `redactosaurus` folder.
5. Turn on Redactosaurus using the extensions button to the right of the URL bar.

## Extension Popup

The popup provides these controls:

- **Anonymization** toggle (on/off)
- **Hide hover links** toggle (on by default) — Chrome’s status-bar URL preview is rewritten to `http://dash.parsely.com`. Turn off to see the real hrefs while debugging.
- **Hide address bar** toggle (off by default, experimental) — loads the dashboard in a same-origin iframe so the tab URL stays `https://dash.parsely.com/`. Turn it off if the frame stays blank or the app jumps out.
- **Keep screen awake** toggle (for live demos)
- **Show publisher name as** and **Show domain as** — the fake identity to display, not the customer values to look for (defaults: "Demo Network" / "demosite.test")
- **Headline mode** (replace with generated headlines, or scramble existing ones)
- **Author mode** (replace with generated names, or scramble existing ones)
- **Thumbnail mode** (replace with local stock photos, or blur existing thumbnails). Defaults to replace.

All popup settings are persisted and applied live without reloading. Author mode defaults to replace.

## Configuration

All transformation rules live in `content/config.json`.

### URL Patterns

Define regex patterns to extract the customer ID from dashboard URLs:

```json
"urlPatterns": {
  "parsely": {
    "pattern": "https://dash\\.parsely\\.com/([^/?]+)",
    "customerIdGroup": 1
  }
}
```

### Transformation Types

**`functionReplace`** - Replace element text using a named JS function. Supports `preserveChildren` to only replace direct text nodes.

```json
{
  "name": "authors_replace",
  "type": "functionReplace",
  "selectors": ["a[href*='/authors/']:not([href*='/authors/?']):not([href$='/authors/'])"],
  "options": {
    "functionName": "generateRandomAuthorName"
  }
}
```

**`scramble`** - Randomize existing text while preserving structure (case, punctuation, spacing, word length).

```json
{
  "name": "seo_scramble",
  "type": "scramble",
  "selectors": ["div.google-key-label"],
  "options": {
    "preserveCase": true,
    "preservePunctuation": true,
    "preserveSpaces": true,
    "preserveLength": true,
    "preserveEnds": true
  }
}
```

**`blur`** - Apply a CSS blur filter to any element. Images are also scaled slightly so the blur does not reveal the backdrop at their edges.

```json
{
  "name": "article_images",
  "type": "blur",
  "selectors": ["div.thumb img"],
  "options": { "blurAmount": "3px" }
}
```

**`defaultImage`** - Replace every matching `img` with a local stock photo from `assets/thumbnails/`. Customer thumbnails stay at `opacity: 0` until the `src` is a `chrome-extension://` URL, so a branded image cannot paint. The pool file is chosen by hashing the original `src`, so the same article keeps the same stand-in across SPA re-renders.

```json
{
  "name": "article_thumbnails",
  "type": "defaultImage",
  "selectors": ["div.thumb img"],
  "options": {
    "poolIndex": "assets/thumbnails/index.json"
  }
}
```

`index.json` is a JSON array of filenames in that directory, for example `["01.jpg", "02.jpg"]`. Add files there and list them in the index; they must also be covered by `web_accessible_resources` (the `assets/*` glob already does this).

### Available Replacement Functions

| Function | Description |
|---|---|
| `generateRandomHeadline` | Returns a headline from `content/articles.js`, paired with its section per post row |
| `generateRandomSectionName` | Returns the section from the same article entry as the headline |
| `generateRandomAuthorName` | Generates a name from configurable first/last name lists |
| `generatePublisherName` | Returns the configured publisher name |

### Conditional Transformations

Transformations can be toggled by a setting value. Headlines (`headlineMode`), author names (`authorMode`), and thumbnails (`thumbnailMode`) use this from the popup:

```json
{
  "name": "headlines_replace",
  "enabledSetting": "headlineMode",
  "enabledValue": "replace",
  ...
}
```

## Content Data

`content/articles.js` contains paired headline and section entries so that generated content stays contextually coherent within each post row:

```json
[
  { "headline": "Severe Storms Sweep Northeast, Leaving Thousands Without Power", "section": "Weather" },
  { "headline": "Tech Giants Face New Antitrust Push as Regulators Tighten Scrutiny", "section": "Technology" }
]
```

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
```

## Notes

- All processing is local. No data leaves the browser.
- Uses `MutationObserver` and continuous polling to handle Parse.ly's SPA navigation.
- SPA URL changes are detected automatically, re-applying redaction when switching between customer sites.
- The `.test` TLD is IANA-reserved, so fake domains can never collide with real ones.
