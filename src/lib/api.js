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

/** Turn a response into either data or a sentence a person can act on. */
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
  if (response.status === 401) {
    throw new Refusal("tokenRefused", [{ key: "tokenPath" }]);
  }
  if (response.status === 403) {
    // Postulo's own sentence when it gives one: it names the scope that is missing.
    if (body && body.detail) {
      throw new Error(body.detail);
    }
    throw new Refusal("notAllowed");
  }
  if (response.status === 422 && body && body.detail) {
    throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
  }
  if (response.status === 429) {
    throw new Refusal("tooMany");
  }
  throw new Refusal("answered", [String(response.status)]);
}

/** GET /me: who this token is, and what it may do. */
export async function whoAmI(instance, token, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint(instance, "/me"), { headers: headers(token) });
  return readResponse(response);
}

/** POST /captures with the page's address and its source. */
export async function capture(instance, token, { url, html }, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint(instance, "/captures"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ url, html }),
  });
  return readResponse(response);
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
