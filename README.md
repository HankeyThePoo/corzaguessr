# Corzaguessr

A framework-free TypeScript music guessing game designed to be embedded on Fourthwall. The production game has no backend and ships as a single JavaScript bundle, one stylesheet, and an editable runtime track catalog.

## Development

Requires Node.js 24 and pnpm 11.

```powershell
pnpm install
pnpm dev
pnpm check
pnpm test:e2e
```

The source is split by ownership:

- `src/domain` contains browser-independent game rules, session state, and catalog selection.
- `src/application` coordinates the session and persisted progress.
- `src/playback` owns round staging and the two audio elements.
- `src/platform` contains browser clock, date, fetch, and localStorage adapters.
- `src/ui` owns markup, rendering, modals, autocomplete, input, and focus behavior.

`public/tracks.json` remains the editable discography. CI and runtime validation reject malformed entries.

Keep the repository's existing `tracks/` directory containing the numbered MP3 files. Production audio continues to load from that directory through jsDelivr.

## Fourthwall embed

After enabling GitHub Pages for the repository, place this in the Fourthwall custom HTML block. Increment the same `v` value on both URLs for each production release.

```html
<link
  rel="stylesheet"
  href="https://hankeythepoo.github.io/corzaguessr/styles.css?v=1"
>
<div id="corzaguessr"></div>
<script
  type="module"
  src="https://hankeythepoo.github.io/corzaguessr/app.js?v=1"
></script>
```

The previous Fourthwall URLs remain the rollback path. Existing discovery, daily, and personal-best localStorage records are compatible with both versions.
