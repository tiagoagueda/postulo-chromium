# Privacy policy

**The Postulo browser extension** (Chromium and Firefox builds, one source). Last changed
2026-10-04.

The extension has no server of its own, no account and no operator. There is nowhere for
your data to go except the Postulo you host yourself, and it goes there only when you press
*Send*. Nobody, including the author, receives anything from it.

## What it keeps, and where

Everything the extension keeps is in your browser's own extension storage
(`storage.local`), on this device. It is not synced through a browser account, and the
extension never writes to `storage.sync`. Browsers keep this storage unencrypted, as they
do for every extension; it is protected by your operating system account and by whatever
disk encryption you use.

It keeps:

- **Your Postulo's address and API token**, as you typed them into the settings. The token
  is the one you issued in Postulo, and you can revoke it there at any time.
- **Your captures**: for each, the posting's address, the fields that were read and the
  fields as you corrected them, which source read it, when, and where it stands — kept,
  waiting, sent or refused, with Postulo's reason when it refused.
- **A slimmed copy of each captured page**, at most 512 thousand characters, kept only until Postulo has the
  capture and deleted the moment it does. Scripts, styles, stylesheet links, frames and
  inline graphics are stripped before it is stored.
- **A log** of what the extension did — the time, the event, a capture's id, a page's host
  (never its full address), and what Postulo answered — the most recent 1000 entries. You
  can read or download it from *Settings → Testing and troubleshooting*, and clear it there.
  The log never holds your token and never holds a page or anything read from one.
- **The language you picked** for the extension, if you did, in the settings.
- **A testing switch** and the outcome of the last delivery attempt.

Deleting a capture from *Captures in this browser* removes it and its page. Removing the
extension from your browser removes all of the above.

## What it sends, and where

Only to the address you configured, and to nothing else. Your token is sent as a bearer
token in the `Authorization` header of those requests and of no others. There are exactly
four:

| When | Request | What goes |
| --- | --- | --- |
| You press *Test* in the settings | `GET /api/v1/me` | Nothing but the token, to ask Postulo who it is |
| You press *Send*, or a waiting capture is retried | `POST /api/v1/captures` | The posting's address, the slimmed copy of the page, the fields as you reviewed them, and — for several captures read off one results page — how many there were and which this is |
| The popup opens on a posting, with Postulo set up and reachable | `POST /api/v1/captures/known` | The address, title and company of the postings on the page, so the popup can say which your Postulo already holds. Postulo stores nothing on this request. |
| You press *Send the picture*, offered after a capture was sent, and only when your Postulo says it keeps pictures | `PUT` to the address Postulo gave for it | A picture of the whole page as you see it in that tab, signed in or not: the page's image, and nothing else. Never for several captures read off one results page. |

Each of these requests carries the tag of the language the extension is speaking (`de`,
`pt-PT`) in the `Accept-Language` header, so that Postulo can word its refusals in it. Your
browser sends that header to every site it visits anyway.

Retries of a capture you already sent happen in the background, every five minutes and when
the browser starts, until Postulo takes it. Nothing is ever sent that you did not press
*Send* on. With no Postulo configured, or with the testing switch on, nothing is sent at
all and captures simply stay in the browser.

## What it reads, and when

The extension has no content scripts and no standing permission to run on any site. It
reads a page only when you click its toolbar button or press `Alt+Shift+P`, through a
script injected into that one tab for that one call, under `activeTab`. It reads the page's
address and its HTML, as your browser already has them. It cannot read a page you did not
ask it to read, and it reads nothing in the background. If you then say yes to sending a
picture of the page, it draws that tab: on Firefox in one go, on Chromium by scrolling the
page screen by screen, hiding what stays fixed in place, and putting everything back as it
was. It does not use the `debugger` permission.

Permission to reach your Postulo's address is asked for once, when you save the settings,
and is granted for that one origin. The extension holds no permanent host permissions.

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
