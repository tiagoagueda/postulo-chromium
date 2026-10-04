// What a page's declared titles say about the job and the employer, for a page with no
// structured data. Postulo reads the same line (`titles.py`, #267) and the two are meant to
// split it identically, so the preview here agrees with what Postulo reads on capture.
//
// A board packs several answers into one line -- "Job Application for Test Chamber Engineer
// at Aperture Science", "Test Chamber Engineer - Aperture Science | Board" -- and the parts
// carry no labels, so nothing here is decided by where a part stands. A part is named only
// when something else vouches for it:
//
//  * the job, when the page's one heading is that part, or a declared title that is not
//    itself a line of parts -- or, failing both, the only part left once the site is out;
//  * the employer, when it follows the job after "at";
//  * the site, when it is the name the page declares for itself (`og:site_name`), its
//    address ("Indeed.com"), or a word of its address ("LinkedIn" on linkedin.com). The
//    site is taken out of a title and is not, by that alone, anybody's employer.
//
// The place is not read here. Postulo names one only where its table of cities knows it,
// and the extension carries no such table: the location is left for the person, which is
// the honest answer. A part nothing vouches for is left where it was.

// A hyphen, an en dash, an em dash or a middle dot with space on both sides ("Front-end"
// and "2025–2026" are one part each), or a pipe, which never sits inside anything worth
// keeping whole. The group keeps the separators in the split, as Postulo's does.
const SEPARATOR = /(\s+[-–—·]\s+|\s*\|\s*)/;

// "at" as a board joins a job to its employer: a word on its own, with space around it.
const AT = /\s+at\s+/i;

// A word of a site's address shorter than this is a country, a "www" or a top-level domain.
const SHORTEST_SITE_WORD = 4;

/** Spacing as a reader sees it: a run of whitespace is one space. */
export function plain(text) {
  return String(text || "").split(/\s+/).filter(Boolean).join(" ");
}

const key = (text) => plain(text).toLowerCase();

/** A declared title as `[separator before it, part]` pairs, in the page's order. The first
 *  part's separator is empty, and a line that starts or ends with a separator ("| Board")
 *  loses it with the empty part beside it. */
export function split(text) {
  const pairs = [];
  let waiting = "";
  plain(text).split(SEPARATOR).forEach((piece, index) => {
    if (index % 2) {
      waiting = waiting || piece.trim();
      return;
    }
    const part = piece.trim();
    if (part) {
      pairs.push([pairs.length ? waiting : "", part]);
      waiting = "";
    }
  });
  return pairs;
}

/** Parts back into one line, each after the separator the page put before it. */
function joined(pairs) {
  let text = "";
  for (const [separator, part] of pairs) {
    text = text ? `${text} ${separator || "-"} ${part}` : part;
  }
  return text;
}

/** Who is hiring, in a part written "<... the job> at <employer>"; "" otherwise. The job
 *  has to be named first, so "at" is read the way a board uses it and not wherever the word
 *  turns up. */
export function employer(part, title) {
  if (!title) {
    return "";
  }
  const escaped = plain(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}\\s+at\\s+(\\S.*)$`, "iu").exec(plain(part));
  return found ? found[1].trim() : "";
}

/** Whether a part is the site signing the line rather than something about the job. */
export function isSite(part, { siteName = "", host = "" } = {}) {
  const word = key(part);
  if (!word) {
    return false;
  }
  if (siteName && word === key(siteName)) {
    return true;
  }
  const labels = String(host || "").toLowerCase().split(".").filter(Boolean);
  if (!labels.length) {
    return false;
  }
  const address = labels.join(".");
  if (word.includes(".")) {
    // "Indeed.com" on pt.indeed.com: a board signing with its address.
    return address === word || address.endsWith(`.${word}`);
  }
  // "LinkedIn" on www.linkedin.com. Never the last word, which is the top-level domain.
  return labels.slice(0, -1).some((label) => label === word && label.length >= SHORTEST_SITE_WORD);
}

/** `{title, company}` from the lines a page declares as its title. `declared` is in the
 *  order the lines are trusted -- `og:title`, `twitter:title`, `<title>` -- and `heading` is
 *  the page's one `<h1>` where it has exactly one. Each answer is "" where nothing vouched
 *  for it. */
export function readTitles({ declared, heading = "", siteName = "", host = "" }) {
  const lines = [];
  const seen = new Set();
  for (const text of declared) {
    if (plain(text) && !seen.has(key(text))) {
      seen.add(key(text));
      lines.push(split(text));
    }
  }
  const site = (part) => isSite(part, { siteName, host });

  // The job, where the page states it on its own: its one heading, or a declared title
  // that is a single part and not the site's name.
  let title = plain(heading);
  if (!title) {
    for (const pairs of lines) {
      if (pairs.length === 1 && !site(pairs[0][1]) && !AT.test(pairs[0][1])) {
        title = pairs[0][1];
        break;
      }
    }
  }

  // "Job Application for Test Chamber Engineer at Aperture Science".
  let company = "";
  for (const pairs of lines) {
    for (const [, part] of pairs) {
      company = company || employer(part, title);
    }
  }

  // No heading to say which part is the job: what is left once the site is taken out, or
  // everything left where more than one part is.
  if (!title) {
    for (const pairs of lines) {
      const left = pairs.filter(([, part]) => !site(part));
      if (left.length) {
        title = left.length === 1 ? left[0][1] : joined(left);
        break;
      }
    }
  }
  if (!title && lines.length) {
    // A line that is nothing but the site's name is still what the page calls itself.
    title = joined(lines[0]);
  }
  return { title, company };
}
