// Reading a posting out of a page, here in the browser, so a capture needs no server.
//
// This is Postulo's own two built-in sources, carried over line for line from
// postulo/plugins/builtin: `schema.org` reads the JobPosting most large boards publish as
// JSON-LD, and `page-metadata` falls back to the title the page declares and its text. Kept
// to exactly what Postulo reads, so a page read here is one Postulo reads too when it is
// sent, and neither invents a value: what cannot be determined is left empty for the
// person to fill in.
//
// Everything here takes a parsed Document, from the browser's DOMParser or from jsdom in
// the tests; nothing reaches for a global.

/** schema.org employmentType values mapped onto Postulo's own. */
const EMPLOYMENT_TYPES = {
  FULL_TIME: "full_time",
  PART_TIME: "part_time",
  CONTRACTOR: "contract",
  CONTRACT: "contract",
  TEMPORARY: "contract",
  INTERN: "internship",
  INTERNSHIP: "internship",
  APPRENTICESHIP: "apprenticeship",
};

/** schema.org QuantitativeValue unitText values Postulo has a period for. */
const SALARY_PERIODS = { YEAR: "year", MONTH: "month", DAY: "day", HOUR: "hour" };

/** Content inside these is never part of an advert. */
const IGNORED = new Set(["script", "style", "noscript", "template", "svg", "head"]);

/** Rendered as a line break, to keep paragraphs and list items apart. */
const BLOCKS = new Set([
  "p", "div", "section", "article", "header", "footer", "aside", "nav",
  "ul", "ol", "li", "br", "hr", "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6",
]);
const VOID = new Set(["br", "hr"]);

/** Postulo's limits on a posting (JobPostingData): what it would refuse, cut to fit instead. */
const MAX_FIELD = 500;
const MAX_DESCRIPTION = 40_000;
const LIMITS = { remote_type: 20, employment_type: 20, salary_currency: 3, salary_period: 10, source: 120 };

// ------------------------------------------------------------------ the page's parts

/** Every JSON-LD object in the page: one object, a list, or an @graph holding either. */
export function jsonLd(doc) {
  const found = [];
  const flatten = (node) => {
    if (Array.isArray(node)) {
      node.forEach(flatten);
    } else if (node && typeof node === "object") {
      found.push(node);
      if (node["@graph"] !== undefined) {
        flatten(node["@graph"]);
      }
    }
  };
  for (const script of doc.querySelectorAll("script")) {
    if (!(script.getAttribute("type") || "").toLowerCase().includes("ld+json")) {
      continue;
    }
    // One block that will not parse says nothing about the others.
    try {
      flatten(JSON.parse(script.textContent));
    } catch {
      continue;
    }
  }
  return found;
}

/** `{title, "og:title": …, …}`: the page's title and its meta tags, the first of each. */
export function metadata(doc) {
  const meta = {};
  for (const tag of doc.querySelectorAll("meta")) {
    const key = tag.getAttribute("property") || tag.getAttribute("name");
    const content = tag.getAttribute("content") || "";
    if (key && content && !(key.toLowerCase() in meta)) {
      meta[key.toLowerCase()] = content;
    }
  }
  const title = doc.querySelector("title");
  return { title: title ? title.textContent.trim() : "", ...meta };
}

/** A node's readable text, with paragraph breaks kept: tidy enough to edit, no more. */
export function textOf(node) {
  const parts = [];
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) {
        parts.push(child.data);
      } else if (child.nodeType === 1) {
        const tag = child.localName;
        if (IGNORED.has(tag)) {
          continue;
        }
        const block = BLOCKS.has(tag);
        if (block) {
          parts.push("\n");
        }
        walk(child);
        // A <br> or <hr> is one tag with no end, so one break, as Postulo reads it.
        if (block && !VOID.has(tag)) {
          parts.push("\n");
        }
      }
    }
  };
  walk(node);
  return parts
    .join("")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Text from an HTML fragment, as a description inside JSON is: often escaped once more. */
function fragmentText(doc, html) {
  // Unescape first, keeping the markup: a textarea's content is text, so its value is the
  // fragment with its entities decoded and its tags intact. Then read it as HTML.
  const decoder = doc.createElement("textarea");
  decoder.innerHTML = html;
  const holder = doc.createElement("div");
  holder.innerHTML = decoder.value;
  return textOf(holder);
}

// ------------------------------------------------------------------ schema.org values

const first = (value) => (Array.isArray(value) ? (value.length ? value[0] : null) : value);

function text(value) {
  const one = first(value);
  if (one === null || one === undefined) {
    return "";
  }
  if (typeof one === "object") {
    return String(one.name || one.value || "").trim();
  }
  return String(one).trim();
}

function date(value) {
  const raw = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

/** A positive amount as a decimal string, or null: what Postulo keeps as a Decimal, written
 *  as the page wrote it ("65000.50" stays so), less a sign and leading zeros. */
function amount(value) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) {
    return null;
  }
  const raw = String(first(value)).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw) || !(Number(raw) > 0)) {
    return null;
  }
  if (/[eE]/.test(raw)) {
    return String(Number(raw));
  }
  const [whole, fraction] = raw.replace(/^\+/, "").split(".");
  const integer = whole.replace(/^0+(?=\d)/, "") || "0";
  return fraction === undefined ? integer : `${integer}.${fraction}`;
}

/** A readable place from a schema.org Place, without the repetition sites put in. */
function place(jobLocation) {
  const one = first(jobLocation);
  if (!one || typeof one !== "object") {
    return text(jobLocation);
  }
  const address = one.address;
  if (typeof address === "string") {
    return address.trim();
  }
  if (!address || typeof address !== "object") {
    return text(one);
  }
  const country = address.addressCountry;
  const parts = [
    address.addressLocality,
    address.addressRegion,
    country && typeof country === "object" && !Array.isArray(country) ? text(country) : country,
  ];
  // "Issy-les-Moulineaux, FR" as the locality and "FR" again as the country reads
  // "Issy-les-Moulineaux, FR" once; a genuine "York" after "New York" is kept.
  const readable = [];
  const seen = new Set();
  for (const part of parts) {
    const piece = typeof part === "string" || Number.isInteger(part) ? String(part).trim() : "";
    if (!piece) {
      continue;
    }
    const pieces = new Set(piece.split(",").map((bit) => bit.trim().toLowerCase()).filter(Boolean));
    if (pieces.size && [...pieces].every((bit) => seen.has(bit))) {
      continue;
    }
    pieces.forEach((bit) => seen.add(bit));
    readable.push(piece);
  }
  return readable.join(", ");
}

function salary(baseSalary) {
  const one = first(baseSalary);
  if (!one || typeof one !== "object") {
    return [null, null, "", ""];
  }
  const currency = String(one.currency || one.salaryCurrency || "").trim().slice(0, 3);
  const value = one.value;
  let low;
  let high;
  let period = "";
  if (value && typeof value === "object" && !Array.isArray(value)) {
    low = amount(value.minValue);
    high = amount(value.maxValue);
    if (low === null && high === null) {
      low = amount(value.value);
    }
    period = SALARY_PERIODS[String(value.unitText || "").toUpperCase()] || "";
  } else {
    low = amount(value);
    high = null;
  }
  return [low, high, currency.toUpperCase(), period];
}

// ------------------------------------------------------------------ the two sources

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function schemaOrg(doc, url) {
  const posting = jsonLd(doc).find((object) => {
    const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
    return types.some((type) => String(type).toLowerCase() === "jobposting");
  });
  if (!posting) {
    return null;
  }
  const title = text(posting.title);
  if (!title) {
    return null;
  }
  const [low, high, currency, period] = salary(posting.baseSalary);
  const employment = String(first(posting.employmentType) || "").toUpperCase().replaceAll("-", "_");
  const remote = String(posting.jobLocationType || "").toUpperCase().includes("TELECOMMUTE") ? "remote" : "";
  const description = typeof posting.description === "string" ? fragmentText(doc, posting.description) : "";
  return {
    title,
    company_name: text(posting.hiringOrganization),
    location: place(posting.jobLocation),
    remote_type: remote,
    employment_type: EMPLOYMENT_TYPES[employment] || "",
    description,
    salary_min: low,
    salary_max: high,
    salary_currency: currency,
    salary_period: period,
    posted_at: date(posting.datePosted),
    closes_at: date(posting.validThrough),
    url,
    source: hostOf(url),
  };
}

function pageMetadata(doc, url) {
  const meta = metadata(doc);
  const title = meta["og:title"] || meta["twitter:title"] || meta.title || "";
  if (!title.trim()) {
    return null;
  }
  return {
    ...emptyPosting(url),
    title: title.slice(0, MAX_FIELD),
    company_name: (meta["og:site_name"] || "").slice(0, MAX_FIELD),
    description: doc.body ? textOf(doc.body) : "",
  };
}

/** Every field Postulo has for a posting, empty. */
export function emptyPosting(url = "") {
  return {
    title: "",
    company_name: "",
    location: "",
    remote_type: "",
    employment_type: "",
    description: "",
    salary_min: null,
    salary_max: null,
    salary_currency: "",
    salary_period: "",
    posted_at: null,
    closes_at: null,
    url,
    source: hostOf(url),
  };
}

/** As Postulo's JobPostingData would take it: trimmed, and cut to its limits. */
export function tidy(posting) {
  const tidied = { ...posting };
  for (const [field, value] of Object.entries(tidied)) {
    if (typeof value === "string") {
      tidied[field] = value.trim().slice(0, LIMITS[field] ?? (field === "description" ? Infinity : MAX_FIELD));
    }
  }
  if (tidied.description.length > MAX_DESCRIPTION) {
    tidied.description = `${tidied.description.slice(0, MAX_DESCRIPTION).trimEnd()}\n\n[…truncated]`;
  }
  return tidied;
}

/** The sources, in Postulo's order. */
const SOURCES = [
  ["schema.org", schemaOrg],
  ["page-metadata", pageMetadata],
];

/** `{data, source}` for the first source that reads the page, or null when none does. */
export function readPosting(doc, url) {
  for (const [name, source] of SOURCES) {
    let data = null;
    // A source that throws is skipped, as Postulo skips it: the next may well cope.
    try {
      data = source(doc, url);
    } catch {
      data = null;
    }
    if (data) {
      return { data: tidy(data), source: name };
    }
  }
  return null;
}

/** The page as it is kept and later sent: what either source reads, less what neither does.
 *
 *  Scripts other than JSON-LD, styles and inline graphics are most of a modern page's
 *  weight and none of its posting; without them a capture takes a fraction of the room in
 *  the browser and on the way to Postulo, which reads the rest exactly as before. */
export function slimPage(doc) {
  const copy = doc.documentElement.cloneNode(true);
  for (const element of copy.querySelectorAll("script, style, noscript, template, svg, link, iframe")) {
    const keep = element.localName === "script" && (element.getAttribute("type") || "").toLowerCase().includes("ld+json");
    if (!keep) {
      element.remove();
    }
  }
  return `<!doctype html>\n${copy.outerHTML}`;
}
