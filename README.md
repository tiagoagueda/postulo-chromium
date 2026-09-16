# postulo-chromium

**The Postulo browser extension: one button that captures the job posting you are
looking at, keeps it in your browser, and sends it to your own
[Postulo](https://source.tiagoagueda.com/postulo/postulo) for review when you say so.**

Postulo can read a posting from its address, but a page only visible to a signed-in
reader, or one behind bot protection, cannot be fetched by a server. The extension reads
the page as your browser sees it, with the same two sources Postulo itself ships, so it
needs no server to do it: with Postulo down, away, or not set up yet, a capture is kept in
the browser, and goes once Postulo can be reached. Nothing is recorded in Postulo until you
review it there.

This repository holds the **source for both browsers** and builds Chromium's package. The
Firefox package is built from the same source by
[postulo-firefox](https://source.tiagoagueda.com/postulo/postulo-firefox), which
carries what Firefox and addons.mozilla.org need and nothing else.

## Privacy, in one paragraph

The extension sends a capture to **your** server and nowhere else, and only when you
press *Send*. It reads a page only when you press the button (or `Alt+Shift+P`), through a
script injected for that one call — it has no permission to run on any site, only
`activeTab`. It asks for permission to reach your instance's address once, when you save
it. There are no analytics, no third-party requests and no permanent host permissions.
What it keeps — the captures, a trimmed copy of each page until Postulo has it, and a log
of what it did — stays in this browser (`storage.local`), as does the token, never synced
through a browser account.

In full, and as the stores require it stated on its own: [PRIVACY.md](PRIVACY.md).

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
3. On a job posting, click the icon and **Capture this posting**. The page is read there
   and then, in the browser, and the popup shows what was read — title, company, location,
   arrangement, contract, salary, closing date, description. Correct what is wrong, then:
   - **Send for review**: it goes to Postulo's review queue as you left it, and the popup
     links to its review screen. If Postulo cannot be reached, it waits in the browser.
   - **Keep in this browser**: it stays here, not sent, until you send it.

Capturing does not need step 1 or 2: without a Postulo set up, captures are kept, and what
you send goes once it is.

## A page of results

On a page that lists several postings — a board's search results — the button offers them
as a list to tick rather than a form to correct: *look at forty, keep three*. Each ticked
posting becomes its own capture, read from that one page, so a failure loses one and not
forty; Postulo is told they came together and announces them once, with the count. A
posting read off a results page is usually a stub — a title, a company, a place — with the
description left to the advert's own page. It is a capture to triage, not a listing to read.

The page is kept once in the browser however many captures were read from it, and goes
when the last of them has reached Postulo. A page that is about one posting and happens to
list similar ones is still that posting's page, and is captured as one.

## Captured before

When the popup opens on a posting your Postulo already holds — a listing at that address
however it was spelled, a capture of it still waiting for review, or a listing with that
title at that company — it says so, with a link, before you send anything. On a page of
results, the postings you already hold carry a *captured before* tag. It asks your server
once, quietly, and refuses nothing: a second capture is yours to want. With Postulo
unreachable, not set up, or older than the question, nothing is said and the capture
proceeds as it always did.

## Without a server

Everything the extension keeps is listed under **Captures in this browser** — the link at
the bottom of the popup, where the number is how many have not reached Postulo (the
toolbar button shows it too). Each is *Not sent*, *Waiting for Postulo*, *Sent* (with a
link to its review screen) or *Refused* (with Postulo's reason); from there you edit one,
send it, hold it back, or delete it.

A capture you sent is sent as soon as Postulo answers: the popup tries at once, the list
tries when it is opened, and the background tries every five minutes and when the browser
starts. It sends only what you pressed *Send* on. A Postulo that is down, busy or failing
is tried again later; a token it refuses keeps everything waiting until it is fixed; a
capture it refuses on its own account (say, a field it will not take) is marked refused
and the rest still go.

What is sent is exactly what you reviewed, every field, with a trimmed copy of the page:
scripts, styles and inline graphics dropped, which is most of a page's weight and none of
its posting. Postulo reads that copy too, to note which of its sources did. The copy is
capped at half a megabyte — several times the heaviest posting in the corpus — so that one
runaway page cannot fill the browser's extension storage: the extension asks for `storage`
and not `unlimitedStorage`, and a page is dropped as soon as Postulo has it.

**Testing.** *Settings → Testing and troubleshooting → Act as if Postulo cannot be
reached* has the extension send nothing while it is on, exactly as if Postulo were down;
turn it off and what is waiting goes. **Download the log** from the same place saves what
the extension did — reads, keeps, send attempts and what Postulo answered — as a text file
to attach to an issue. It holds no token and nothing from the pages.

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
| `src/popup.*` | The button, the form showing what was read, *Send* and *Keep* |
| `src/captures.*` | Captures in this browser: the list, to edit, send, hold back or delete |
| `src/options.*` | Address, token, *Test*, *Save*; the testing switch and the log |
| `src/background.js` | Opens the settings on first install; sends what is waiting, every five minutes and at start |
| `src/lib/parse.js` | Reading a posting: Postulo's `schema.org` and `page-metadata` sources, carried over |
| `src/lib/store.js` | The captures kept in the browser, and the page each was read from |
| `src/lib/outbox.js` | Sending what is waiting, one delivery at a time |
| `src/lib/log.js` | What the extension did, for the log download |
| `src/lib/form.js` | The posting as a form, for the popup and the list alike |
| `src/lib/local.js` | The store, the log and delivery over `storage.local`, as every page uses them |
| `src/lib/api.js` | Talking to `/api/v1`: pure functions, tested with `node --test` |
| `src/lib/browser.js` | `browser ?? chrome`, settings, permissions, reading the active tab |
| `src/lib/i18n.js` | Fills the pages from `_locales` in the browser's language |
| `src/_locales/` | One `messages.json` per language; `en` is the source |
| `scripts/build.mjs` | `dist/chromium` and `dist/firefox` from the one source |
| `src/icons/` | Postulo's mark at 16, 32, 48, 96 and 128 pixels, made by `scripts/icons.py` |

```sh
npm test               # the reader, the store and delivery, the API, and every language against en
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
