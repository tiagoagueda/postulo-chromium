// Talking to a Postulo instance. Pure functions where possible, so they can be tested
// without a browser: what to send, where, and how to read what comes back.
//
// The token is sent as a bearer token to the instance the person configured, and to
// nothing else. There is no analytics, no third-party request, no cache of pages.

const API = "/api/v1";

/** An error with a sentence to show, named by its key in _locales rather than written out.
 *  These functions stay pure and testable outside a browser; the page that catches one says
 *  it in the browser's language. A substitution may itself be `{ key }`, for a phrase that is
 *  translated too. */
export class Refusal extends Error {
  constructor(key, substitutions = []) {
    super(key);
    this.name = "Refusal";
    this.key = key;
    this.substitutions = substitutions;
  }
}

/** A typed instance address, cleaned: scheme, host, optional port and path prefix. */
export function normaliseInstance(raw) {
  let text = (raw || "").trim();
  if (!text) {
    throw new Refusal("enterAddress");
  }
  if (!/^https?:\/\//i.test(text)) {
    text = "https://" + text;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Refusal("notAnAddress");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".local");
  if (url.protocol !== "https:" && !local) {
    throw new Refusal("httpsOnly");
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return url.toString().replace(/\/$/, "");
}

/** The origin pattern a host permission is requested for. */
export function originPattern(instance) {
  const url = new URL(instance);
  return `${url.protocol}//${url.host}/*`;
}

export function endpoint(instance, path) {
  return `${instance}${API}${path}`;
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/** Turn a response into either data or a sentence a person can act on.
 *
 *  What is thrown carries the response's `status`, so a caller that retries can tell a
 *  Postulo that is down or busy from one that refused this particular request. */
export async function readResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) {
    return body;
  }
  throw withStatus(refusalFor(response.status, body), response.status);
}

function refusalFor(status, body) {
  if (status === 401) {
    return new Refusal("tokenRefused", [{ key: "tokenPath" }]);
  }
  if (status === 403) {
    // Postulo's own sentence when it gives one: it names the scope that is missing.
    return body && body.detail ? new Error(body.detail) : new Refusal("notAllowed");
  }
  if (status === 422 && body && body.detail) {
    // A sentence of Postulo's, or a list of refused fields, each saying where and why.
    return new Error(typeof body.detail === "string" ? body.detail : body.detail.map(problem).join(" "));
  }
  if (status === 429) {
    return new Refusal("tooMany");
  }
  return new Refusal("answered", [String(status)]);
}

function withStatus(error, status) {
  error.status = status;
  return error;
}

function problem(error) {
  const where = Array.isArray(error.loc) ? error.loc.at(-1) : "";
  return where ? `${where}: ${error.msg}` : error.msg;
}

/** How long to wait for Postulo before counting it as unreachable. */
const TIMEOUT_MS = 20_000;

/** fetch, given up on after a while: a server that never answers is a server that is down. */
async function request(fetchImpl, url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** GET /me: who this token is, and what it may do. */
export async function whoAmI(instance, token, fetchImpl = fetch) {
  const response = await request(fetchImpl, endpoint(instance, "/me"), { headers: headers(token) });
  return readResponse(response);
}

/** POST /captures: the page, and the posting as the person reviewed it.
 *
 *  Every field goes, not only the ones changed: what Postulo keeps is then exactly what the
 *  person looked at, whichever of its sources reads the page on its side. The page still
 *  goes too, because Postulo reads it to know which source did. */
export async function capture(instance, token, { url, html, data, batch }, fetchImpl = fetch) {
  const payload = { url, html };
  if (data && Object.keys(data).length) {
    payload.data = data;
  }
  // Several from one page: Postulo announces the first with the count and the rest not at
  // all (#177). Only its shape goes; the id that groups them here is the browser's own.
  if (batch && batch.size > 1) {
    payload.batch = { size: batch.size, position: batch.position };
  }
  const response = await request(fetchImpl, endpoint(instance, "/captures"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  return readResponse(response);
}

/** Whether a failure means "try again later" rather than "this will not do".
 *
 *  No answer at all, a Postulo that is busy (429) or failing (5xx) is later. A token that
 *  is refused (401, 403) is the account's problem, not the capture's: later too, once it is
 *  fixed. Anything else Postulo said about this one capture is final until it is changed. */
export function kindOfFailure(error) {
  const status = error && error.status;
  if (!status) {
    return "later";
  }
  if (status === 401 || status === 403) {
    return "account";
  }
  if (status === 429 || status >= 500) {
    return "later";
  }
  return "refused";
}

/** What went wrong, in a shape that can be stored and said again in any language. */
export function problemOf(error) {
  if (error && error.key) {
    return { key: error.key, substitutions: error.substitutions || [] };
  }
  return { message: (error && error.message) || String(error) };
}

/** One line for the popup, from what the capture API returned. `untitled` is said when the
 *  page gave no title, in whatever language the caller speaks. */
export function describe(result, untitled = "Untitled posting") {
  const parts = [result.title || untitled];
  const where = [result.company_name, result.location].filter(Boolean).join(", ");
  if (where) {
    parts.push(where);
  }
  return parts.join(" — ");
}
