# postulo-chromium

**The Postulo browser extension: one button that sends the job posting you are looking
at to your own [Postulo](https://source.tiagoagueda.com/postulo/postulo), for review.**

Postulo can read a posting from its address, but a page only visible to a signed-in
reader, or one behind bot protection, cannot be fetched by a server. The extension sends
the page as your browser sees it. Postulo reads it with the same sources it uses for
anything else and shows it to you for review; nothing is recorded until you say so.

This repository holds the **source for both browsers** and builds Chromium's package. The
Firefox package is built from the same source by
[postulo-firefox](https://source.tiagoagueda.com/postulo/postulo-firefox), which
carries what Firefox and addons.mozilla.org need and nothing else.

## Privacy, in one paragraph

The extension sends the page to **your** server and nowhere else. It reads a page only
when you press the button (or `Alt+Shift+P`), through a script injected for that one
call — it has no permission to run on any site, only `activeTab`. It asks for permission to
reach your instance's address once, when you save it. There are no analytics, no
third-party requests, no permanent host permissions and no copy of any page. The token is
stored on this device only (`storage.local`), never synced through a browser account.

## Install

**Chrome, Edge, Brave, Vivaldi, Opera, Arc** — until it is on the Chrome Web Store, load
it unpacked:

```sh
npm ci
npm run build:chromium        # writes dist/chromium
```

Then *Extensions → Developer mode → Load unpacked* and pick `dist/chromium`.

**Firefox** — see postulo-firefox, or `npm run build:firefox` here and load `dist/firefox`
as a temporary add-on from `about:debugging` (Developer Edition and Nightly also accept it
permanently once signed; see that repository).

## Set it up

1. In Postulo, **Settings → API tokens → New token**, tick only `captures`, copy the token.
2. Click the extension's icon, then *Set it up*: paste your Postulo's address and the
   token. *Test* asks Postulo who the token is. *Save* asks the browser for permission to
   reach that address.
3. On a job posting, click the icon and **Capture this posting**. The result names what
   Postulo read and links to the review screen.

## Languages

The extension speaks the language the browser is set to; there is no setting for it. The
browser matches its own language against `src/_locales/` and falls back to English for one
that is not there.

The languages are the ones Postulo itself offers: English plus the 39 European catalogues
the core has complete. Where the core has a word for something — *Settings*, *API tokens*,
*Save*, *Test* — the extension uses the core's, so the button and the screen it points at
agree. A language joins here when the core starts offering it.

English is the source. The other translations are drafts that no native speaker has
reviewed yet, as are the core's own new strings until one does.

To add or change a sentence, change `en` first, then every other language: `npm test`
fails while any language lacks a key or has different placeholders from English, and
while the code asks for a key that `en` does not have.

## Layout

| Path | What |
| --- | --- |
| `src/manifest.json` | Manifest V3 for both browsers; the build strips what each one would complain about |
| `src/popup.*` | The button and the result |
| `src/options.*` | Address, token, *Test*, *Save* (which requests the host permission) |
| `src/lib/api.js` | Talking to `/api/v1`: pure functions, tested with `node --test` |
| `src/lib/browser.js` | `browser ?? chrome`, storage, permissions, reading the active tab |
| `src/lib/i18n.js` | Fills the pages from `_locales` in the browser's language |
| `src/_locales/` | One `messages.json` per language; `en` is the source |
| `src/background.js` | Opens the settings on first install; nothing else |
| `scripts/build.mjs` | `dist/chromium` and `dist/firefox` from the one source |
| `src/icons/` | Postulo's mark at 16, 32, 48, 96 and 128 pixels, made by `scripts/icons.py` |

```sh
npm test               # the pure parts, and every language against en
npm run lint:firefox   # web-ext lint on the Firefox build
npm run package        # zips under dist/artifacts/
```

The icons are Postulo's mark, derived with the core's own recipe from
`assets/brand/postulo.png` in the core repository, and committed. When the mark changes,
regenerate them from a checkout of the core beside this one:

```sh
uv run --with pillow python scripts/icons.py
```

## Licence

AGPL-3.0-or-later, like Postulo.
