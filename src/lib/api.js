// Talking to a Postulo instance. Pure functions where possible, so they can be tested
// without a browser: what to send, where, and how to read what comes back.
//
// The token is sent as a bearer token to the instance the person configured, and to
// nothing else. There is no analytics, no third-party request, no cache of pages.

const API = "/api/v1";

/** A typed instance address, cleaned: scheme, host, optional port and path prefix. */
export function normaliseInstance(raw) {
  let text = (raw || "").trim();
  if (!text) {
    throw new Error("Enter the address of your Postulo.");
  }
  if (!/^https?:\/\//i.test(text)) {
    text = "https://" + text;
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("That does not look like a web address.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.hostname.endsWith(".local");
  if (url.protocol !== "https:" && !local) {
    throw new Error("Use https for anything that is not on your own machine: the token travels with every request.");
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
    throw new Error("Postulo does not accept this token. Check it under Settings > API tokens.");
  }
  if (response.status === 403) {
    throw new Error(body && body.detail ? body.detail : "This token is not allowed to capture.");
  }
  if (response.status === 422 && body && body.detail) {
    throw new Error(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
  }
  if (response.status === 429) {
    throw new Error("Too many captures in a short time. Wait a minute and try again.");
  }
  throw new Error(`Postulo answered ${response.status}.`);
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

/** One line for the popup, from what the capture API returned. */
export function describe(result) {
  const parts = [result.title || "Untitled posting"];
  const where = [result.company_name, result.location].filter(Boolean).join(", ");
  if (where) {
    parts.push(where);
  }
  return parts.join(" — ");
}
