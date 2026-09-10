# VIP Redactosaurus

A Chrome extension that anonymizes Parse.ly dashboards before they render, enabling safe product demos without exposing customer data. Runs at `document_start` to prevent any flash of real content.

## How It Works

Redaction happens in three layers, from broad to specific:

1. **Global text sweep** - A `TreeWalker` replaces every occurrence of the detected customer domain (e.g. `gazette.com`) with a fake domain (`demosite.test` by default) and every occurrence of the brand token derived from that domain (`gazette`) with the fake publisher name, across all text nodes. The brand token catches header labels the app builds from the account name, such as "The Gazette Sites - gazette.com".

   Two limits apply. The token only matches when the brand renders as one word (`gazette` matches "The Gazette", but `dailyplanet` will not match "Daily Planet"). And the publisher name and domain you configure must not contain the customer id or brand token — a replacement that matches its own output would rewrite it on every cycle, so the sweep drops it and logs an error instead.
2. **Href-pattern selectors** - Content like authors (`a[href*='/authors/']`) and sections (`a[href*='/sections/']`) is matched by URL structure rather than CSS classes, making it resilient to UI changes.
3. **Structural selectors** - A few specific selectors handle elements where href matching isn't possible (image thumbnails, publisher name, site picker).

Customer detection is automatic. The extension reads the domain from the Parse.ly dashboard URL and generates a consistent fake identity for it.

## Installation

1. Clone this repository
2. Open `chrome://extensions/`, enable Developer mode
3. Click "Load unpacked" and select this folder

## Extension Popup

The popup provides these controls:

- **Anonymization** toggle (on/off)
- **Keep screen awake** toggle (for live demos)
- **Show publisher name as** and **Show domain as** — the fake identity to display, not the customer values to look for (defaults: "Demo Network" / "demosite.test")
- **Headline mode** (replace with generated headlines, or scramble existing ones)
- **Author mode** (scramble existing names, or replace with generated ones)

All popup settings are persisted and applied live without reloading. Author mode defaults to scramble: generated names still read as plausible real people, which looks like leaked customer data in a demo even when it is not.

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
  "selectors": ["a[href*='/authors/']"],
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

**`blur`** - Apply a CSS blur filter to images.

```json
{
  "name": "article_images",
  "type": "blur",
  "selectors": ["div.thumb img"],
  "options": { "blurAmount": "3px" }
}
```

### Available Replacement Functions

| Function | Description |
|---|---|
| `generateRandomHeadline` | Returns a headline from `content/articles.js`, paired with its section per post row |
| `generateRandomSectionName` | Returns the section from the same article entry as the headline |
| `generateRandomAuthorName` | Generates a name from configurable first/last name lists |
| `generatePublisherName` | Returns the configured publisher name |

### Conditional Transformations

Transformations can be toggled by a setting value. Headlines (`headlineMode`) and author names (`authorMode`) use this to switch between replace and scramble modes from the popup:

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
└── assets/                     Icons, CSS, placeholder images
```

## Notes

- All processing is local. No data leaves the browser.
- Uses `MutationObserver` and continuous polling to handle Parse.ly's SPA navigation.
- SPA URL changes are detected automatically, re-applying redaction when switching between customer sites.
- The `.test` TLD is IANA-reserved, so fake domains can never collide with real ones.
