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
press *Send*. Before that, it asks your server only whether it already holds the postings
on the page, by their address, title and company (`POST /api/v1/captures/known`). It reads a page only when you press the button (or `Alt+Shift+P`), through a
script injected for that one call — it has no permission to run on any site, only
`activeTab`. It asks for permission to reach your instance's address once, when you save
it. There are no analytics, no third-party requests and no permanent host permissions.
What it keeps — the captures, a trimmed copy of each page until Postulo has it, the list of
postings waiting for review in Postulo as last read (address, title, company and place of
each, for the toolbar number), and a log of what it did — stays in this browser (`storage.local`), as does the token, never synced
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
3. On a job posting, click the icon, then the first of the two icon buttons at the popup's
   top right, **Capture this posting**. The page is read there
   and then, in the browser, kept as a capture in the browser, and a window of its own opens
   with what was read — title, company, location, arrangement, contract, salary, closing
   date, description. A window and not the popup, because a popup closes as soon as you click
   elsewhere and is no bigger than 800 by 600; a click elsewhere loses nothing. Correct what
   is wrong, then:
   - **Send for review**: it goes to Postulo's review queue as you left it, and the window
     links to its review screen. If Postulo cannot be reached, it waits in the browser.
   - **Keep in this browser**: it stays here, not sent, until you send it.
   - **Delete**: it is removed from the browser.

   Closing the window without deciding leaves the capture kept and not sent, listed as *Not
   sent* and counted on the toolbar button until you send or delete it. Capturing the same
   page again opens the same capture rather than a second one.

   There is one such window: the next capture, every *Review in Postulo*, and *Add a listing*
   appear in it, brought forward, and Postulo's own *Save and next* walks the queue there. It
   needs no permission. Where the browser has no windows (Firefox for Android) a tab opens
   instead.

   When Postulo says it keeps a picture of the page, the window offers, once the capture is
   sent, to send one: the whole page as you see it in the tab you read it from, drawn only if
   you say yes, and never for several captures read off one results page.

The second button, **Add a listing**, opens Postulo's own page for adding a listing by hand
(`/listings/new/`) in that window. The extension makes no request for it, so it works with the
`captures`-only token; you must be signed in to Postulo in that browser, or it takes you to
its sign-in page, and the listing goes straight into your listings, not the review queue. It
shows only once a Postulo is set up, and opens with the testing switch on too, since that
switch stops what the extension sends, not pages the browser opens. On a page that is not a
web page (the browser's own settings, say) the capture button is greyed and the popup says
why.

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

When the review window opens on a capture of a posting your Postulo already holds — a listing at that address
however it was spelled, a capture of it still waiting for review, or a listing with that
title at that company — it says so, with a link, before you send anything. On a page of
results, the postings you already hold carry a *captured before* tag. It asks your server
once, quietly, and refuses nothing: a second capture is yours to want. With Postulo
unreachable, not set up, or older than the question, nothing is said and the capture
proceeds as it always did.

## The number on the toolbar button

The button shows how many postings are captured and waiting for review: those waiting in
Postulo and those in this browser that have not reached it yet, one for each address (two
captures of one posting, with or without `www.` or a trailing slash, count once; the rule
is Postulo's own `same_url()`, tested against its cases). Past 99 it reads `99+`, and the
tooltip says it in words. A capture Postulo has is counted from Postulo's list, which the
extension reads (`GET /api/v1/captures`, only the token goes) every five minutes, when the
browser starts, after a delivery that sent something, when you save another address or
token, and when the popup opens unless it was read in the last minute. A Postulo that
cannot be reached or refuses the token leaves the number at what was last read, plus
what you have captured since. Not set up, with the testing switch on, or before the
address is allowed, nothing is asked and only this browser's unsent captures count.

## The colour of the toolbar button

The button is grey, and its tooltip says why in words, while the extension has no Postulo to
send to: not set up, the testing switch on, the address not yet allowed, the token refused
(401 or 403), or Postulo not answering (nothing within 20 seconds, a network error, a 5xx,
`/healthz` answering 503). It is in colour otherwise. Grey is not disabled: the popup still
opens and capturing works, what you send waits in this browser. A busy Postulo (429) has
answered and is reachable.

What is known is one record in `storage.local` (`connection`: the state, when, and by what).
It is written from the outcome of a send, of the popup's question about postings Postulo
holds, and of *Test* when it tested the saved address and token; and between those, every
five minutes, at start, and when the address, token, permission or testing switch changes,
from `GET /healthz` (public, no token, no cookies). `GET /api/v1/me` is spent only when
the token's state is not known yet, as after saving. Nothing is asked in the testing
switch, when not set up, or without the permission. The image is set again at start, as the
number is: browsers forget it on restart.

The footer of the popup shows the same record before the instance address, one shape and
colour for each state, named in words in its tooltip and to a screen reader: a green tick
(Postulo answered within a second), an orange clock (it took more than a second, or has not
answered yet after one), a red cross (it cannot be reached), a red lock (the address is not
allowed yet), a red key (the token is refused) and a grey flask (the testing switch is on).
Not set up, it shows nothing. When the popup opens it shows what is known at once, then asks
`GET /healthz` once more, timing it (`ms` in the record, background checks included), and
shows the answer; a second without one shows orange while the 20 seconds go on, unless the
record says red or grey, which stay until the answer. A popup closed before the answer writes
nothing. The toolbar button is in colour exactly when the footer is green or orange.

## Without a server

Under the capture button the popup lists the postings that need review, newest first, as
many as five: the ones the toolbar number counts, one row for each posting, standing for the
newest capture in Postulo if there is one and else the newest kept here, and saying how many
captures there are of it. Each row says in words where it waits (*Waiting for review in
Postulo*, *Not sent*, *Waiting for Postulo* or *Refused*) and is one link: a capture in
Postulo opens its review page in the review window, one kept here opens its form there. The list is drawn
from the copy of Postulo's list kept in the browser, so it shows offline, and again when the
read made on opening lands; while Postulo cannot be asked (the testing switch, no permission,
unreachable, the token refused) it says when that copy was read, since a row may have been
decided in the meantime. Without a Postulo set up it lists only what is kept here.

Everything the extension keeps is listed under **Captures in this browser** — the link at
the bottom of the popup. Each is *Not sent*, *Waiting for Postulo*, *Sent* (with a
link to its review screen) or *Refused* (with Postulo's reason); from there you edit one
(it opens in the review window), send it, hold it back, or delete it. A sent capture keeps
only what the list shows of it (title, company, place, address and review link: Postulo
has the rest), and leaves the browser by itself 30 days after it was sent, checked every
five minutes and when the browser starts.

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
to attach to an issue. It holds no token and nothing from the pages. *New issue* offers a
*Bug report* form that asks for it and for what else a fix needs.

## Languages

The extension speaks the language the browser is set to, unless one is picked in *Settings
→ Language*. By default the browser matches its own language against `src/_locales/` and
falls back to English for one that is not there.

The list in the settings offers *Follow the browser* and every shipped language, each named
in itself (`Deutsch`, `Gaeilge`, `српски`, as Postulo's own picker names them) and marked
with its own `lang`. The choice is kept in `storage.local` as a BCP 47 tag, takes effect at
once, and reaches the popup, the list of captures, the settings and the button's tooltip. It
is there for someone who reads Postulo in a language other than the browser's, and for the
languages Chrome has no interface in (`ga`, `mt` and `lb` on every platform), which the
browser would never pick by itself.

No browser lets an extension set its own language, so with one picked the extension reads
`_locales/<folder>/messages.json` itself (`src/lib/i18n.js`) and puts a sentence together by
the rules of `i18n.getMessage` (`src/lib/messages.js`: named placeholders, `$1` to `$9`,
`$$`). Pages read the catalogue before they fill themselves in; the background reads it
too, to word the tooltip again at every start (browsers forget it) and, in Firefox on a
computer, the shortcut's description. What the browser words itself cannot follow: the
extension's description in the add-on lists, and the shortcut's description in Chromium and
Firefox for Android. Every request to Postulo carries the tag of the language in use as
`Accept-Language`, so the sentences Postulo writes for a refusal come in it too.

The languages are the ones the Postulo core, the release this one is released beside, has
started: English, plus every catalogue with a translation in it, all keys filled at once as
drafts. An administrator's narrowing of a site's list plays no part. Where the core has a
word for something — *Settings*, *API tokens*, *Save*, *Test* — the extension uses the
core's, so the button and the screen it points at agree.

The list is `src/lib/languages.js` (folder, tag, direction, own name), and it is written,
not kept by hand: `python scripts/languages.py` reads the core checked out beside this
repository (`../postulo`, or `POSTULO_CORE`) and rewrites it; `--check` fails on a
difference. Run it when the core starts a language and add an empty `_locales` folder for it;
Weblate fills it, and `npm test` fails until the folders equal the list. The build writes each
shipped catalogue's `languageTag` and `direction` from the list (`scripts/build.mjs`): they are
not sentences, and a translator or a machine never sees them. The first language written right to left (Arabic) is the first to need a look
in a real browser; the tests cover that the page's `dir` follows the catalogue and that the
style sheet names no physical side.

A language is named by a BCP 47 tag in its canonical form, as everywhere in Postulo: the
language in lower case, a script with a capital, a region in capitals (`pt-BR`, `sr-Cyrl`,
`nb`). Each shipped catalogue says its own in `languageTag`, which the build writes, and that
is what a page's `lang`
attribute, every date and the log's header use. A language the extension comes to store
or send is a tag too. The folders under `src/_locales/` are the one exception, because the browser
demands it: a folder is named by language and region with an underscore (`pt_BR`) and
never by script, so Serbian's folder is `sr` and its tag is `sr-Cyrl`. `npm test` derives
each folder's name from its tag, and fails on a tag written any other way.

The core's tags become the extension's by one rule, written once, in the script: the
region is dropped where the core has one variety of a language (`fr-FR` there is `fr` here,
`en-GB` is `en`) and kept where it has two (`pt-BR`, `pt-PT`). A browser set to any French
matches the `fr` folder, and the tag names the catalogue that is served. A core code with a
region or script the script has no entry for stops it.

English is the source. The other translations are drafts that no native speaker has
reviewed yet, as are the core's own new strings until one does.

### Translating

Translate in Weblate, in the `postulo` project at <https://translate.tiagoagueda.com/projects/postulo/>,
in the component for this extension; nobody has to export or send a file. A sentence added
to `src/_locales/en/messages.json` appears there, with its `description` as the context, and
a translation saved there comes back as a pull request from Weblate's `weblate` branch, which
CI runs (`npm test`) before it reaches `main`. **Nobody translates in a commit** (postulo/postulo#706):
`node scripts/guard.mjs`, in CI, refuses a commit that writes or changes a sentence in another
language than English unless Weblate made it.

The component is set up as: file format *WebExtension JSON*; file mask
`src/_locales/*/messages.json`; template and source `src/_locales/en/messages.json`;
language code style *Chrome* or *Android* style so folders read `pt_PT`, not `pt-PT` (Serbian
is the exception, `sr` for `sr-Cyrl`; the build writes the tag).

Complete or absent: `npm run build` leaves a language that lacks a sentence out of the package,
with a warning, so a half-translated language never shows English in the gaps. `npm test`
refuses a sentence English does not have, an empty one, and different placeholders. Which
languages ship at all is the core's list (#10).

Drafts: the JSON format has no flag for a machine translation nobody has read. Weblate's
own review state is the record: a string is a draft until a speaker marks it *Approved*
there. Everything here except English counts as a draft, as stated above.

To add or change a sentence, change `en` and nothing else: Weblate drafts the other languages
by machine where it can, speakers correct them there, and they arrive with its next pull
request. `npm test` fails while the code asks for a key that `en` does not have.

## Layout

| Path | What |
| --- | --- |
| `src/manifest.json` | Manifest V3 for both browsers; the build strips what each one would complain about |
| `src/popup.*` | The two header buttons (capture, add a listing), the list of postings needing review, the ticking of a page of results |
| `src/review.*` | The review window: the form showing what was read, *Send*, *Keep* and *Delete*, and the offer of a picture of the page after *Send* |
| `src/captures.*` | Captures in this browser: the list, to send, hold back or delete, and to open one in the review window to edit |
| `src/options.*` | Address, token, *Test*, *Save*; the language; the testing switch and the log |
| `src/background.js` | Opens the settings on first install; sends what is waiting, reads Postulo's list of captures waiting for review and asks whether Postulo answers, every five minutes and at start |
| `src/lib/connection.js` | Whether Postulo answers, kept as one record; and the toolbar's image and tooltip from it and the settings |
| `src/lib/waiting.js` | The toolbar number: reading Postulo's list, and counting postings once per address |
| `src/lib/address.js` | What identifies a posting by its address: Postulo's `same_url()`, ported |
| `src/lib/parse.js` | Reading a posting: Postulo's `schema.org` and `page-metadata` sources, carried over |
| `src/lib/titles.js`, `src/lib/patterns.js` | What `page-metadata` reads from a title line (job, employer) and from the text (salary, closing date), as Postulo's `titles.py` and `patterns.py` do |
| `src/lib/store.js` | The captures kept in the browser, and the page each was read from |
| `src/lib/outbox.js` | Sending what is waiting, one delivery at a time |
| `src/lib/log.js` | What the extension did, for the log download |
| `src/lib/review.js` | The rows of that list: one per posting, newest first |
| `src/lib/form.js` | The posting as a form, for the review window |
| `src/lib/window.js` | The one review window: opened, remembered, brought forward |
| `src/lib/known.js` | Asking Postulo what it already holds, and saying it |
| `src/lib/local.js` | The store, the log and delivery over `storage.local`, as every page uses them |
| `src/lib/api.js` | Talking to `/api/v1`: pure functions, tested with `node --test` |
| `src/lib/rendering.js` | The picture of the whole page Postulo may keep: whether it is wanted, screens, size |
| `src/lib/picture.js` | Drawing the whole page: `captureTab` on Firefox, scrolling and stitching on Chromium |
| `src/lib/browser.js` | `browser ?? chrome`, settings, permissions, reading the active tab |
| `src/lib/i18n.js` | Fills the pages from `_locales`, in the browser's language or the one picked |
| `src/lib/messages.js` | A sentence out of a catalogue by `getMessage`'s rules, for a picked language |
| `src/lib/languages.js` | The shipped languages: folder, tag, direction and own name; written by `scripts/languages.py` |
| `scripts/languages.py` | Writes that list from the core's roll-out (`../postulo`) |
| `src/_locales/` | One `messages.json` per language; `en` is the source |
| `.forgejo/ISSUE_TEMPLATE/` | The bug and feature forms, and the links shown above them (security, translations, questions) |
| `scripts/corpus.mjs` | What is read off a saved page (`node scripts/corpus.mjs <page.html> <address>`), for adding a board to the corpus in `test/fixtures/` |
| `scripts/build.mjs` | `dist/chromium` and `dist/firefox` from the one source |
| `scripts/locales.mjs` | Which language folders are incomplete, so the build leaves them out |
| `src/icons/` | Postulo's mark at 16, 32, 48, 96 and 128 pixels, and the grey 16 and 32 for the toolbar, made by `scripts/icons.py` |

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
