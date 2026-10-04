// Reading a posting out of a page, here in the browser, so a capture needs no server.
//
// This is Postulo's own two built-in sources, carried over line for line from
// postulo/plugins/builtin: `schema.org` reads the JobPosting most large boards publish
// about themselves -- as JSON-LD in a script, or as itemprop microdata or RDFa written
// into the markup, which is all an older recruitment system or a public-sector board ever
// publishes -- and `page-metadata` falls back to the title the page declares and its
// readable text. Kept to exactly what Postulo reads, so a page read here is one Postulo
// reads too when it is sent, and neither invents a value: what cannot be determined is
// left empty for the person to fill in.
//
// Ahead of both, `board` runs a recipe for the handful of boards that publish nothing a
// standard can read -- LinkedIn marks the company and the place with class names and
// nothing else -- and lets the two below fill whatever the recipe left empty. See
// `boards.js`, which is `postulo/plugins/builtin/boards` carried over the same way.
//
// Everything here takes a parsed Document, and a function to parse more, from the
// browser's DOMParser or from jsdom in the tests; nothing reaches for a global.

import { recipeFor } from "./boards.js";

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

/** Postulo's word for an employment type, or "" for anything it does not know.
 *
 *  Takes the spellings boards actually use -- "FULL_TIME", "Full-time", "full time" -- and
 *  nothing else. A board writing it in the reader's language ("Temps plein") gets an empty
 *  field and a person filling it in, which is the right answer: the alternative is a table
 *  of every employment word in every language Postulo speaks. */
export function employmentType(raw) {
  return EMPLOYMENT_TYPES[String(raw ?? "").trim().toUpperCase().replaceAll("-", "_").replaceAll(" ", "_")] || "";
}

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

/** Every JSON-LD object in the page: one object, a list, or an @graph holding either.
 *
 *  A board that publishes several postings on one page wraps them in an ItemList or hangs
 *  them off mainEntity, so those are followed too: the posting being looked at is often
 *  inside one, and picking it back out is `bestPosting`'s job, not this one's. */
export function jsonLd(doc) {
  const found = [];
  const flatten = (node) => {
    if (Array.isArray(node)) {
      node.forEach(flatten);
    } else if (node && typeof node === "object") {
      found.push(node);
      for (const key of ["@graph", "itemListElement", "mainEntity", "item"]) {
        if (node[key] !== undefined) {
          flatten(node[key]);
        }
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

// ------------------------------------------------- the same vocabulary, written in markup

/** The attribute a property element carries its value in, per the microdata spec. */
const VALUE_ATTRIBUTE = {
  meta: "content",
  audio: "src",
  embed: "src",
  iframe: "src",
  img: "src",
  source: "src",
  track: "src",
  video: "src",
  a: "href",
  area: "href",
  link: "href",
  object: "data",
  data: "value",
  meter: "value",
  time: "datetime",
};

/** What one property element states: its attribute where it has one, else its text. */
function propertyValue(element) {
  const attribute = VALUE_ATTRIBUTE[element.localName];
  if (attribute) {
    const value = element.getAttribute(attribute);
    if (value !== null) {
      return value.trim();
    }
    // A <time> with no datetime states its date as text; the rest state nothing.
    if (element.localName !== "time") {
      return "";
    }
  }
  return textOf(element);
}

/** The last segment of a type URL: "https://schema.org/JobPosting" → "JobPosting". */
const typeName = (raw) => String(raw || "").trim().split(/[/#]/).filter(Boolean).pop() || "";

/** Read one item, and everything nested in it, into the plain object JSON-LD would be.
 *
 *  `scopeOf` says which element opens an item, `typeOf` and `propsOf` name its type and
 *  its properties. Microdata and RDFa differ only in those three, so one walk serves both
 *  and the reader downstream never learns which of them a page used. */
function readItem(element, shape) {
  const item = {};
  const types = shape.typeOf(element).split(/\s+/).map(typeName).filter(Boolean);
  if (types.length) {
    item["@type"] = types.length === 1 ? types[0] : types;
  }
  const add = (name, value) => {
    if (value === "" || value === null || value === undefined) {
      return;
    }
    // schema.org lets a property repeat; keep every value, as a list once there are two.
    if (name in item) {
      item[name] = Array.isArray(item[name]) ? [...item[name], value] : [item[name], value];
    } else {
      item[name] = value;
    }
  };
  const walk = (parent) => {
    for (const child of parent.children) {
      const names = shape.propsOf(child);
      const nested = shape.scopeOf(child);
      if (names.length) {
        // A property that opens an item of its own is an object; otherwise it is a value.
        names.forEach((name) => add(name, nested ? readItem(child, shape) : propertyValue(child)));
      }
      // Descend unless the child began its own item, which has just read itself.
      if (!nested) {
        walk(child);
      }
    }
  };
  walk(element);
  return item;
}

/** Only the outermost items: a nested one is read as part of the item that holds it. */
const outermost = (elements, selector) =>
  [...elements].filter((element) => !element.parentElement?.closest(selector));

/** Every microdata item in the page, shaped as the object JSON-LD would have given. */
export function microdata(doc) {
  const shape = {
    scopeOf: (element) => element.hasAttribute("itemscope"),
    typeOf: (element) => element.getAttribute("itemtype") || "",
    propsOf: (element) => (element.getAttribute("itemprop") || "").trim().split(/\s+/).filter(Boolean),
  };
  return outermost(doc.querySelectorAll("[itemscope][itemtype]"), "[itemscope]").map((element) =>
    readItem(element, shape),
  );
}

/** Every RDFa item in the page, shaped the same way.
 *
 *  RDFa Lite is all a board ever uses here: `typeof` opens an item and `property` names a
 *  value. The `vocab` in force is not tracked, because a type name is what the reader
 *  matches on either way, and a prefix like "schema:title" is dropped for the same reason. */
export function rdfa(doc) {
  const shape = {
    scopeOf: (element) => element.hasAttribute("typeof"),
    typeOf: (element) => element.getAttribute("typeof") || "",
    propsOf: (element) =>
      (element.getAttribute("property") || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((name) => name.split(":").pop()),
  };
  return outermost(doc.querySelectorAll("[typeof]"), "[typeof]").map((element) => readItem(element, shape));
}

// ------------------------------------------------------------------ a page's readable text

/** A node's readable text, with paragraph breaks kept: tidy enough to edit, no more.
 *
 *  `drop` names elements to leave out, for the fallback that has a whole page to read. */
export function textOf(node, drop = null) {
  const parts = [];
  const walk = (parent) => {
    for (const child of parent.childNodes) {
      if (child.nodeType === 3) {
        parts.push(child.data);
      } else if (child.nodeType === 1) {
        const tag = child.localName;
        if (IGNORED.has(tag) || (drop && drop(child))) {
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

/** Landmarks that surround an advert without ever being part of one.
 *
 *  The controls are here and the `<form>` around them is not, deliberately: an advert is
 *  never written inside a button, but whole pages are still served wrapped in one big form
 *  — every ASP.NET board is — and dropping those would leave the description empty. */
const CHROME = new Set(["nav", "header", "footer", "aside", "button", "input", "select", "textarea", "option"]);
const CHROME_ROLES = new Set([
  "navigation", "banner", "contentinfo", "complementary", "search", "menu", "menubar", "dialog", "alertdialog",
]);

/** True for an element that is page furniture rather than the advert.
 *
 *  Landmarks only: what a page declares about its own shape, never a guess at a class
 *  name. A board that marks nothing loses nothing — it is read exactly as it was before. */
function isChrome(element) {
  if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("hidden")) {
    return true;
  }
  // An explicit role overrides the tag: <nav role="main"> means what it says.
  const role = (element.getAttribute("role") || "").trim().toLowerCase();
  if (role) {
    return CHROME_ROLES.has(role);
  }
  return CHROME.has(element.localName);
}

/** A block is a list of links rather than prose once it is this much link, and this many. */
const FARM_LINKS = 6;
const FARM_SHARE = 0.7;
const FARM_FLOOR = 100;

/** Blocks that are a list of links rather than something written.
 *
 *  "Similar searches", "people also viewed", "explore top content": every large board ends
 *  an advert with thousands of characters of them, and marks them with a class name and
 *  nothing else — LinkedIn's are plain `<section>`s, so no landmark rule reaches them.
 *
 *  What does reach them is what they are: text that is almost entirely inside links, a lot
 *  of them. That is a measurement rather than a guess at a board's markup, it is the same
 *  measurement every reading-mode extractor makes, and prose does not look like it. The
 *  floor keeps it off a short run of links inside a real paragraph. */
function linkFarms(container) {
  const farms = new Set();
  for (const element of container.querySelectorAll("section, div, ul, ol, aside, nav")) {
    // The outermost one is enough; everything inside it goes with it.
    if (farms.has(element.parentElement?.closest("section, div, ul, ol, aside, nav"))) {
      farms.add(element);
      continue;
    }
    const links = element.querySelectorAll("a");
    if (links.length < FARM_LINKS) {
      continue;
    }
    const total = element.textContent.replace(/\s+/g, " ").trim().length;
    if (total < FARM_FLOOR) {
      continue;
    }
    let linked = 0;
    for (const link of links) {
      linked += link.textContent.replace(/\s+/g, " ").trim().length;
    }
    if (linked / total >= FARM_SHARE) {
      farms.add(element);
    }
  }
  return farms;
}

/** The readable text of a whole page, less its navigation, header, footer and sidebars.
 *
 *  A page's own landmarks say which part is the advert: where it declares a `<main>` or an
 *  `<article>` carrying real text, read that, and otherwise read the body without the
 *  furniture around it. This is the fallback's text, and it goes to somebody who is about
 *  to read and correct it, so it would rather keep a stray line than cut the advert. */
export function mainText(doc) {
  if (!doc.body) {
    return "";
  }
  const farms = linkFarms(doc.body);
  const drop = (element) => isChrome(element) || farms.has(element);
  const whole = textOf(doc.body, drop);
  for (const selector of ["main", "[role='main']", "article"]) {
    for (const candidate of doc.body.querySelectorAll(selector)) {
      if (isChrome(candidate) || candidate.closest("nav, aside, footer")) {
        continue;
      }
      const text = textOf(candidate, drop);
      // A landmark holding almost none of the page is a teaser or a card, not the advert.
      if (text.length >= 200 && text.length >= whole.length * 0.25) {
        return text;
      }
    }
  }
  return whole;
}

/** The one heading a page gives itself, where it gives exactly one.
 *
 *  A board with no structured data still says what the advert is called, in the element
 *  HTML has for saying it. That is worth more than the title the page declares for sharing,
 *  which carries whatever else the board wants a link to read: LinkedIn's `og:title` is
 *  "<company> hiring <job> in <place> | LinkedIn" and its `<h1>` is the job.
 *
 *  Exactly one, and not inside the furniture. Two headings is a page that has not said
 *  which is the subject, and guessing between them is the thing this does not do. */
export function headingTitle(doc) {
  if (!doc.body) {
    return "";
  }
  const headings = [...doc.body.querySelectorAll("h1")].filter(
    (heading) => !isChrome(heading) && !heading.closest("nav, aside, footer, header"),
  );
  if (headings.length !== 1) {
    return "";
  }
  const text = textOf(headings[0]).replace(/\s+/g, " ").trim();
  // A heading that runs to a paragraph is a page using h1 for something else.
  return text.length && text.length <= 200 ? text : "";
}

/** Text from an HTML fragment, as a description inside JSON is: often escaped once more.
 *
 *  As Postulo does it: decode the entities first, markup and all, so "&lt;p&gt;" becomes a
 *  paragraph, then read the result as HTML. Only the text between tags is decoded, each
 *  piece by the parser, so nothing is ever handed to innerHTML. */
function fragmentText(parse, html) {
  const unescaped = html
    // A tag runs to its closing ">", and a quoted attribute may hold one of its own.
    .split(/(<\/?[a-zA-Z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>)/)
    .map((piece, index) =>
      index % 2 || !piece.includes("&") ? piece : parse(`<body>${piece.replaceAll("<", "&lt;")}`).body.textContent,
    )
    .join("");
  return textOf(parse(`<body>${unescaped}`).body);
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

/** One schema.org Place as a readable line, without the repetition sites put in. */
function onePlace(one) {
  if (!one || typeof one !== "object") {
    return typeof one === "string" ? one.trim() : "";
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

/** A readable place from a schema.org jobLocation, which may name more than one office. */
function place(jobLocation) {
  const many = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const lines = [];
  for (const one of many) {
    const line = onePlace(one);
    if (line && !lines.includes(line)) {
      lines.push(line);
    }
  }
  // Three offices read as a place; a board listing forty is listing its coverage, not one.
  return lines.length > 3 ? lines.slice(0, 3).join(" · ") : lines.join(" · ");
}

/** `[low, high, currency, period]` from one MonetaryAmount. */
function oneSalary(value) {
  const one = first(value);
  if (!one || typeof one !== "object") {
    return [null, null, "", ""];
  }
  const currency = String(one.currency || one.salaryCurrency || "").trim().slice(0, 3);
  const inner = one.value;
  let low;
  let high;
  let period = "";
  if (inner && typeof inner === "object" && !Array.isArray(inner)) {
    low = amount(inner.minValue);
    high = amount(inner.maxValue);
    if (low === null && high === null) {
      low = amount(inner.value);
    }
    period = SALARY_PERIODS[String(inner.unitText || "").toUpperCase()] || "";
  } else {
    low = amount(inner);
    high = null;
  }
  return [low, high, currency.toUpperCase(), period];
}

/** What a posting pays: its baseSalary, or the estimate where that is all it states.
 *
 *  A currency and a period with no amount behind them say nothing — boards routinely write
 *  a "USD 0–0 YEAR" placeholder into every advert — so they are kept only alongside one. */
function salary(posting) {
  for (const candidate of [posting.baseSalary, posting.estimatedSalary]) {
    const [low, high, currency, period] = oneSalary(candidate);
    if (low !== null || high !== null) {
      return [low, high, currency, period];
    }
  }
  return [null, null, "", ""];
}

// ------------------------------------------------------------------ the sources

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** A URL reduced to what identifies the posting: no scheme, no "www.", no trailing slash. */
function sameUrl(raw) {
  try {
    const parsed = new URL(raw);
    // A campaign's tracking parameters say where the visitor came from, not which advert.
    for (const name of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|ref_src$)/i.test(name)) {
        parsed.searchParams.delete(name);
      }
    }
    return `${parsed.host.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`.toLowerCase();
  } catch {
    return "";
  }
}

/** Is this posting the one the page is showing?
 *
 *  A search page carries a JobPosting for every hit, and the first is almost never the one
 *  being looked at. Each states which advert it is, in `url`, in `@id`, or as the
 *  `identifier` a board puts in its own links, so the one that names this page wins. */
function matchesUrl(posting, url) {
  const here = sameUrl(url);
  if (!here) {
    return false;
  }
  for (const key of ["url", "@id", "sameAs"]) {
    const stated = sameUrl(text(posting[key]));
    if (stated && stated === here) {
      return true;
    }
  }
  const identifier = text(posting.identifier);
  // Anything this short matches by accident; a board's own id never is.
  return identifier.length >= 4 && here.includes(identifier.toLowerCase());
}

/** The JobPosting objects among a page's structured data, in the order they appear. */
function postings(objects) {
  return objects.filter((object) => {
    const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
    return types.some((type) => String(type).toLowerCase() === "jobposting");
  });
}

/** The posting a page is showing: the one naming this URL, or the only one there is. */
function bestPosting(objects, url) {
  const found = postings(objects).filter((posting) => text(posting.title));
  if (found.length < 2) {
    return found[0] || null;
  }
  return found.find((posting) => matchesUrl(posting, url)) || found[0];
}

/** Every field Postulo has, read off one schema.org JobPosting however it was written.
 *
 *  `descriptionIsHtml` because the two spellings differ in exactly one place: a JSON string
 *  carries the description as escaped markup and has to be unescaped and flattened, while
 *  one read out of the markup is already the text a reader sees. Unescaping that would
 *  mangle a description legitimately containing an ampersand or an angle bracket. */
function fromPosting(posting, url, parse, descriptionIsHtml) {
  const title = text(posting.title);
  if (!title) {
    return null;
  }
  const [low, high, currency, period] = salary(posting);
  const employment = employmentType(first(posting.employmentType) || "");

  // schema.org defines applicantLocationRequirements as where an applicant may be for a
  // job done remotely, so a posting carrying one is stating remote as plainly as the type.
  const remote =
    String(posting.jobLocationType || "").toUpperCase().includes("TELECOMMUTE") ||
    (posting.applicantLocationRequirements !== undefined && posting.applicantLocationRequirements !== null)
      ? "remote"
      : "";

  // Most boards put the office in jobLocation. Those that do not still name it on the
  // organisation doing the hiring, which is the same answer written a field across.
  const organisation = first(posting.hiringOrganization);
  const location =
    place(posting.jobLocation) ||
    (organisation && typeof organisation === "object" ? onePlace({ address: organisation.address }) : "");

  const described = typeof posting.description === "string" ? posting.description : "";
  const description = descriptionIsHtml ? fragmentText(parse, described) : described;
  return {
    title,
    company_name: text(posting.hiringOrganization),
    location,
    remote_type: remote,
    employment_type: employment,
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

/** The JobPosting a board publishes about itself, in whichever of the three spellings it used.
 *
 *  JSON-LD first, because that is what most boards publish and it is the least ambiguous;
 *  then the same vocabulary written into the markup, for the boards that publish it no
 *  other way. A page carrying both is read from the script, which is the one a board
 *  maintains deliberately. */
function schemaOrg(doc, url, parse) {
  const inScript = bestPosting(jsonLd(doc), url);
  if (inScript) {
    return fromPosting(inScript, url, parse, true);
  }
  const inMarkup = bestPosting([...microdata(doc), ...rdfa(doc)], url);
  return inMarkup ? fromPosting(inMarkup, url, parse, false) : null;
}

function pageMetadata(doc, url) {
  const meta = metadata(doc);
  // The page's own heading first, then what it declares for a link to read. Both are the
  // page talking about itself; the heading is the one written for a person reading it.
  const title = headingTitle(doc) || meta["og:title"] || meta["twitter:title"] || meta.title || "";
  if (!title.trim()) {
    return null;
  }
  return {
    ...emptyPosting(url),
    title: title.slice(0, MAX_FIELD),
    company_name: (meta["og:site_name"] || "").slice(0, MAX_FIELD),
    description: mainText(doc),
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

/** The fields a recipe may state. Anything else it returns is ignored rather than trusted. */
const RECIPE_FIELDS = [
  "title", "company_name", "location", "remote_type", "employment_type", "description",
  "salary_min", "salary_max", "salary_currency", "salary_period", "posted_at", "closes_at",
];

/** A board's own recipe, with the standards filling whatever it left empty.
 *
 *  Only for a page whose host a recipe claims: everywhere else this answers nothing and the
 *  standard sources run exactly as they did. */
function boardSource(doc, url, parse) {
  const board = recipeFor(url);
  if (!board || !doc.body) {
    return null;
  }
  const stated = {};
  const read = board.read(doc.body, url, (node) => textOf(node), employmentType);
  for (const field of RECIPE_FIELDS) {
    const value = read[field];
    if (value !== undefined && value !== null && value !== "") {
      stated[field] = value;
    }
  }
  if (!stated.title) {
    // A recipe that cannot name the job has not recognised the page -- an advert that has
    // moved, or a board that redesigned. Let the standards have it.
    return null;
  }
  for (const fill of [schemaOrg, pageMetadata]) {
    if (Object.keys(stated).length >= RECIPE_FIELDS.length) {
      break;
    }
    let fallback = null;
    try {
      fallback = fill(doc, url, parse);
    } catch {
      fallback = null;
    }
    if (!fallback) {
      continue;
    }
    for (const field of RECIPE_FIELDS) {
      const value = fallback[field];
      if (!(field in stated) && value !== undefined && value !== null && value !== "") {
        stated[field] = value;
      }
    }
  }
  return { ...emptyPosting(url), ...stated, url, source: hostOf(url) };
}

/** The sources, in Postulo's order. */
const SOURCES = [
  ["board", boardSource],
  ["schema.org", schemaOrg],
  ["page-metadata", pageMetadata],
];

/** `{data, source}` for the first source that reads the page, or null when none does.
 *  `parse(html)` makes a Document of a string: the browser's DOMParser, or jsdom's. */
export function readPosting(doc, url, parse) {
  for (const [name, source] of SOURCES) {
    let data = null;
    // A source that throws is skipped, as Postulo skips it: the next may well cope.
    try {
      data = source(doc, url, parse);
    } catch {
      data = null;
    }
    if (data) {
      return { data: tidy(data), source: name };
    }
  }
  return null;
}

/** The address a posting states for itself, when it states one: `url`, or an `@id` that is one. */
function ownUrl(posting) {
  for (const key of ["url", "@id"]) {
    const value = text(posting[key]);
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
  }
  return "";
}

/** Every posting a page lists, each read as the one it names: a results page (#177).
 *
 *  `readPosting` above answers "which one is this page about?", and throws the rest away;
 *  this keeps them. `here` says whether a posting names this very page, because an
 *  advert's own page that also lists similar jobs is still one posting's page and the
 *  popup should treat it as one. A posting stating no address of its own is read as the
 *  page's, which Postulo then cannot tell from the others -- every field goes with the
 *  capture as a correction, so what is kept is still the one that was ticked. The same
 *  posting written twice, in the script and in the markup, is listed once. */
export function readPostings(doc, url, parse) {
  const listed = [];
  const seen = new Set();
  const take = (objects, descriptionIsHtml) => {
    for (const posting of postings(objects)) {
      const title = text(posting.title);
      if (!title) {
        continue;
      }
      const stated = ownUrl(posting);
      const own = stated || url;
      const key = `${sameUrl(own)}|${title.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      const data = fromPosting(posting, own, parse, descriptionIsHtml);
      if (data) {
        const tidied = tidy(data);
        // The other spelling may state the address and this one not (or the reverse), which
        // keys them apart; the same title and company is the same posting.
        const twin = listed.findIndex(
          (entry) =>
            (!stated || !entry.stated) &&
            entry.title === title.toLowerCase() &&
            (!entry.data.company_name || !tidied.company_name || entry.data.company_name === tidied.company_name),
        );
        if (twin >= 0) {
          if (stated && !listed[twin].stated) {
            listed[twin] = { data: tidied, source: "schema.org", here: matchesUrl(posting, url), stated, title: title.toLowerCase() };
          }
          continue;
        }
        seen.add(key);
        listed.push({ data: tidied, source: "schema.org", here: matchesUrl(posting, url), stated, title: title.toLowerCase() });
      }
    }
  };
  // One spelling that throws says nothing about the other, as in readPosting.
  try {
    take(jsonLd(doc), true);
  } catch {
    // nothing to list from the scripts
  }
  try {
    take([...microdata(doc), ...rdfa(doc)], false);
  } catch {
    // nothing to list from the markup
  }
  return listed.map(({ data, source, here }) => ({ data, source, here }));
}

/** How much of one page is kept in the browser.
 *
 *  `storage.local` holds 10 MB without `unlimitedStorage`, a permission both stores read as
 *  "this may fill your disk" and which a capture does not need: a page is slimmed before it
 *  is kept and dropped once Postulo has it. Half a megabyte is several times the slimmed
 *  weight of the heaviest job posting the corpus has, so the cap is a backstop against one
 *  runaway page filling the quota for every other capture, not a routine trim. */
export const MAX_PAGE = 512 * 1024;

/** The page as it is kept and later sent: what either source reads, less what neither does.
 *
 *  Scripts other than JSON-LD, styles and inline graphics are most of a modern page's
 *  weight and none of its posting; without them a capture takes a fraction of the room in
 *  the browser and on the way to Postulo, which reads the rest exactly as before.
 *
 *  Past MAX_PAGE what is left is cut, head first and so posting first: the title, the meta
 *  tags and the JSON-LD a page declares are at the top of it, and what is lost off the end
 *  is the footer of a page that was extraordinary to begin with. Postulo parses what
 *  arrives as leniently as a browser does, and reads the truncation note if a person looks. */
export function slimPage(doc) {
  const copy = doc.documentElement.cloneNode(true);
  for (const element of copy.querySelectorAll("script, style, noscript, template, svg, link, iframe")) {
    const keep = element.localName === "script" && (element.getAttribute("type") || "").toLowerCase().includes("ld+json");
    if (!keep) {
      element.remove();
    }
  }
  const html = `<!doctype html>\n${copy.outerHTML}`;
  return html.length > MAX_PAGE ? `${html.slice(0, MAX_PAGE)}\n<!-- truncated at ${MAX_PAGE} characters -->\n` : html;
}
