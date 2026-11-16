# Privacy policy

**The Postulo browser extension** (Chromium and Firefox builds, one source). Last changed
2026-11-11.

The extension has no server of its own, no account and no operator. There is nowhere for
your data to go except the Postulo you host yourself. Your captures go there only when you
press *Send*: the page and the fields as you reviewed them. Before that, the extension asks
your Postulo whether it already holds the postings on a page you read, giving only their
address, title and company (see the table below). Nobody, including the author, receives
anything from it.

## What it keeps, and where

Everything the extension keeps is in your browser's own extension storage
(`storage.local`), on this device. It is not synced through a browser account, and the
extension never writes to `storage.sync`. Browsers keep this storage unencrypted, as they
do for every extension; it is protected by your operating system account and by whatever
disk encryption you use.

It keeps:

- **Your Postulo's address and API token**, as you typed them into the settings. The token
  is the one you issued in Postulo, and you can revoke it there at any time, or press
  *Forget this Postulo* in the settings to remove both, and the permission to reach it, from this browser.
- **A token for filling forms**, if you typed one into the settings: the same kind of thing as
  the token above, kept the same way, and removed with it, and when you save another address.
  It is used only when you press *Fill this form*.
- **Your captures**: kept as soon as a page is read, before you decide anything, so that closing the review window loses nothing; for each, the posting's address, the fields that were read and the
  fields as you corrected them, which source read it, when, and where it stands — kept,
  waiting, sent or refused, with Postulo's reason when it refused. Once Postulo has a
  capture, only its title, company, place and address are kept of it, with the address of
  its review screen, and it is removed by itself 30 days after it was sent.
- **A slimmed copy of each captured page**, at most 512 thousand characters, kept only until Postulo has the
  capture and deleted the moment it does. Scripts, styles, stylesheet links, frames and
  inline graphics, hidden and password form fields, the value of every input and button,
  meta tags that hold a token or a session, and comments are stripped before it is stored.
- **A log** of what the extension did — the time, the event, a capture's id, a page's host
  (never its full address), and what Postulo answered — the most recent 1000 entries. You
  can read or download it from *Settings → Testing and troubleshooting*, and clear it there.
  The log never holds your token and never holds a page or anything read from one.
- **The language you picked** for the extension, if you did, in the settings.
- **The list of captures waiting for review in your Postulo**, as last read, for the number
  on the toolbar button: for each, its id, address, title, company, place, date, the opaque `posting_key` Postulo gives it and the
  address of its review screen — including captures made elsewhere, such as from another
  browser. Never a page. It is dropped when you change the address or token.
- **A testing switch**, and whether Postulo answered at last look: not allowed yet, token
  refused, unreachable or reachable, with when and by which request, for the toolbar
  button's colour. Nothing else about it.
- **Which window is the review window**, while the browser is open: its number, in the browser's session storage, which the browser empties when it closes.

Deleting a capture from *Captures in this browser* or from the review window removes it and its page. Removing the
extension from your browser removes all of the above.

The extension cannot be switched on in private windows (`"incognito": "not_allowed"` in its
manifest), because what it keeps is in the ordinary profile and outlasts a private window:
a page captured there would leave its address, title and source on this device.

## What it sends, and where

Only to the address you configured, and to nothing else: a redirect is refused, not followed, and
an address with a user name or password in it is refused. Plain `http` is accepted only for an
instance on this machine (`localhost`, `127.0.0.1`, `[::1]`); any other address, a `.local` name
included, must be `https`. The address of a review page or listing that Postulo's answer names is
opened only when it is on that same address. Your token is sent as a bearer
token in the `Authorization` header of those requests, except `GET /healthz`, and of no
others. There are exactly six:

| When | Request | What goes |
| --- | --- | --- |
| You press *Test* in the settings, and after you save an address or token (or when `/healthz` is blocked on the way) | `GET /api/v1/me` | Nothing but the token, to ask Postulo who it is |
| You press *Send*, or a waiting capture is retried | `POST /api/v1/captures` | The posting's address, the slimmed copy of the page, the fields as you reviewed them, and — for several captures read off one results page — how many there were and which this is |
| Every five minutes, when the browser starts, when the popup opens, and after something was sent | `GET /api/v1/captures` | Nothing but the token, to read the list of captures waiting for review, for the number on the toolbar button. Not made with no Postulo set up, with the testing switch on, or before the address is allowed. |
| Every five minutes, each time the popup opens, when the browser starts, and when the address is saved, the permission given or the testing switch turned off | `GET /healthz` | Nothing. No token and no cookies: only that your server is asked whether it is up, so it learns the browser is running and from where. It is how the toolbar button knows to turn grey. Not made with no Postulo set up, with the testing switch on, or before the address is allowed. |
| Before anything is sent: each time the review window opens on a capture not sent yet, and when the popup reads a page of results, with Postulo set up, the testing switch off and the address allowed | `POST /api/v1/captures/known` | The address (without any `#` part), title and company of the postings on the page, as read off it and not as you corrected them, so the window can say which your Postulo already holds. Postulo's answer includes an opaque `posting_key` for each address, which is kept on a capture here so that the toolbar number groups it with what Postulo holds of the same posting. From a page of results, every posting it lists, in one request per hundred. Nothing else from the page. Postulo stores nothing on this request. |
| You press *Fill this form*, with a token for it saved | `GET /api/v1/profile` and `GET /api/v1/me` | Nothing but that token, to read your name, form of address, date of birth and email. They are put into the page's empty fields through a script injected for that one call and are not kept; the page sees them as it would if you had typed them. Not made with the testing switch on. |
| You press *Send the picture*, offered in the review window after a capture was sent, and only when your Postulo says it keeps pictures | `PUT` to the address Postulo gave for it | A picture of the whole page as you see it in that tab, signed in or not: the page's image, and nothing else. Never for several captures read off one results page. |

Each of these requests carries the tag of the language the extension is speaking (`de`,
`pt-PT`) in the `Accept-Language` header, so that Postulo can word its refusals in it. Your
browser sends that header to every site it visits anyway.

Retries of a capture you already sent happen in the background, every five minutes and when
the browser starts, until Postulo takes it. No page and no field you corrected is ever sent
that you did not press *Send* on: if you change the address to another Postulo, what waited
for the old one is kept again, and is sent only when you press *Send* anew. What does go before *Send* is the question to
`/api/v1/captures/known` above — the address, title and company of what you read, to your
own Postulo only — and `GET /healthz`, which asks, and carries, nothing of yours. With no Postulo configured, or with the testing switch on, nothing is sent at
all and captures simply stay in the browser.

## What it reads, and when

The extension has no content scripts and no standing permission to run on any site. It
reads a page only when you click its toolbar button or press `Alt+Shift+P`, through a
script injected into that one tab for that one call, under `activeTab`. It reads the page's
address and its HTML, as your browser already has them. It cannot read a page you did not
ask it to read, and it reads nothing in the background. If you then say yes to sending a
picture of the page, the review window draws the tab it was read from: on Firefox in one go, on Chromium by scrolling the
page screen by screen, hiding what stays fixed in place, and putting everything back as it
was. It does not use the `debugger` permission.

Permission to reach your Postulo's address is asked for once, when you save the settings,
and is granted for the origin of that address: Chromium reads a pattern without a port as
every port of that host. It is given back when you save another address, when you forget
the Postulo, and after a Test of an address you did not save. The extension holds no
permanent host permissions.

## What it does not do

There are no analytics, no telemetry, no crash reporting, no advertising or advertising
identifiers, no cookies, no tracking of any kind, and no requests to any third party — not
to the author, not to a CDN, not to an update service beyond the browser's own. No remotely
hosted code is loaded or executed; everything that runs is in the package the store
reviewed. Nothing is sold, shared, or used for any purpose beyond sending your capture to
your own server at your request.

## Contact

Questions, or a mistake in this document:
[postulo-chromium issues](https://source.tiagoagueda.com/postulo/postulo-chromium/issues).
The extension is free software under the AGPL-3.0-or-later; every claim above can be
checked against the source.
