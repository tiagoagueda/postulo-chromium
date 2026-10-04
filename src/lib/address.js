// What identifies a posting by its address: the core's `same_url()`
// (postulo/core/addresses.py), ported so two captures of one posting count once.
//
// It follows Python's `urlparse` rather than the browser's `URL`, because the answer has to
// be the core's: scheme, a leading "www." and trailing slashes dropped, lower-cased, query
// kept. Where `URL` would tidy more (an upper-case "WWW.", a default port, a user name, a
// space, a ".." segment) the core does not, and neither does this: those stay different
// postings here as they are there. The one thing it leaves alone is what Python 3.12 does
// to a netloc with a character that changes under NFKC; no job board writes one.

// Python removes these wherever they are, and leading C0 controls and spaces.
const UNSAFE = /[\t\r\n]/g;
const LEADING = /^[\u0000-\u0020]+/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** A URL reduced to what identifies the posting; "" when it names no host. */
export function sameUrl(raw) {
  let rest = String(raw || "").replace(LEADING, "").replace(UNSAFE, "");
  const scheme = SCHEME.exec(rest);
  if (scheme) {
    rest = rest.slice(scheme[0].length);
  }
  if (!rest.startsWith("//")) {
    return "";
  }
  const end = rest.slice(2).search(/[/?#]/);
  const netloc = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end);
  rest = end < 0 ? "" : rest.slice(2 + end);
  // Python refuses an unmatched bracket.
  if (netloc.includes("[") !== netloc.includes("]")) {
    return "";
  }
  if (!netloc) {
    return "";
  }
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    rest = rest.slice(0, hash);
  }
  let query = "";
  const mark = rest.indexOf("?");
  if (mark >= 0) {
    query = rest.slice(mark + 1);
    rest = rest.slice(0, mark);
  }
  // `urlparse` (not `urlsplit`) cuts ";parameters" off the last segment of an http path.
  const schemeName = scheme ? scheme[1].toLowerCase() : "";
  if (["", "http", "https"].includes(schemeName) && rest.includes(";")) {
    const semicolon = rest.indexOf(";", rest.lastIndexOf("/"));
    if (semicolon >= 0) {
      rest = rest.slice(0, semicolon);
    }
  }
  const host = netloc.startsWith("www.") ? netloc.slice(4) : netloc;
  return `${host}${rest.replace(/\/+$/, "")}${query ? `?${query}` : ""}`.toLowerCase();
}
