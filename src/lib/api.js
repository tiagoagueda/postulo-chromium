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
    // A sentence of Postulo's, or a list of refused fields, each saying where and why.
    throw new Error(typeof body.detail === "string" ? body.detail : body.detail.map(problem).join(" "));
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

function problem(error) {
  const where = Array.isArray(error.loc) ? error.loc.at(-1) : "";
  return where ? `${where}: ${error.msg}` : error.msg;
}

/** POST /captures/preview: what the page would be captured as, with nothing kept.
 *
 *  `null` from a Postulo older than the preview, which has no such address: the caller then
 *  sends the page straight away, as the extension did before there was anything to show. */
export async function preview(instance, token, { url, html }, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint(instance, "/captures/preview"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ url, html }),
  });
  if (response.status === 404 || response.status === 405) {
    return null;
  }
  return readResponse(response);
}

/** POST /captures with the page's address and its source, and the fields a person corrected. */
export async function capture(instance, token, { url, html, data }, fetchImpl = fetch) {
  const payload = { url, html };
  if (data && Object.keys(data).length) {
    payload.data = data;
  }
  const response = await fetchImpl(endpoint(instance, "/captures"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  return readResponse(response);
}

const NUMBERS = new Set(["salary_min", "salary_max"]);
const DATES = new Set(["posted_at", "closes_at"]);

/** The fields where what the form says differs from what was read: the only ones sent.
 *
 *  What nobody touched stays what the source read, so the capture says so. Amounts compare
 *  as numbers, since Postulo may write 55000 as "55000.00"; a field somebody emptied is sent
 *  empty, or null for an amount or a date, so that it is cleared rather than kept. */
export function corrections(read, edited) {
  const changed = {};
  for (const [field, value] of Object.entries(edited)) {
    const before = read[field];
    if (NUMBERS.has(field)) {
      const was = before === null || before === undefined || before === "" ? null : Number(before);
      const now = value === "" ? null : Number(value);
      if (was !== now) {
        changed[field] = now === null ? null : value;
      }
    } else if (DATES.has(field)) {
      if ((before || null) !== (value || null)) {
        changed[field] = value || null;
      }
    } else if ((before ?? "").trim() !== value.trim()) {
      changed[field] = value.trim();
    }
  }
  return changed;
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
