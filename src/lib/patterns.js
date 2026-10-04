// A salary and a closing date, read just after the words a page uses for them. Postulo reads
// the same way (`patterns.py`, #267) so the preview agrees with what Postulo reads on capture.
//
// **Nothing is invented.** A figure is read only just after one of the words, and only with
// the currency it is written in; a period only where the page states one; a date only when
// it is whole -- a day, a month and a year -- and cannot be read two ways. A numeric date
// the page's language does not settle (03/04/2026 on a page that says only "en") is left
// for the person, and so is "apply by 30 October". A bare "$" is read only on a page that
// names the country. Two readings that disagree are no reading at all.
//
// The words are English only. Postulo's lists for other languages are its translations and
// the extension has no such catalogue; a page in another language that labels its pay in
// that language reads as nothing here and is read by Postulo itself after capture. The
// month names and the order of a numeric date do come from the page's language.

const CLOSING_WORDS = [
  "closing date", "application deadline", "deadline", "apply by", "apply before",
  "applications close", "closes on", "closing on", "last day to apply", "open until",
];
const SALARY_WORDS = [
  "salary", "salary range", "base salary", "annual salary", "pay range", "pay rate",
  "compensation", "remuneration", "wage",
];
const UP_TO_WORDS = ["up to", "maximum", "max"];
const RANGE_WORDS = ["to", "and"];
const PERIOD_WORDS = {
  year: ["per year", "a year", "per annum", "annually", "yearly", "annual", "p.a.", "/year", "/yr"],
  month: ["per month", "a month", "monthly", "/month", "/mo"],
  day: ["per day", "a day", "daily", "/day"],
  hour: ["per hour", "an hour", "hourly", "/hour", "/hr", "/h"],
};

// Written beside an amount, each of these is one currency wherever the page comes from.
// "$", "kr" and "¥" are not here: each is several currencies, and which one is a guess.
const SYMBOLS = {
  "€": "EUR", "£": "GBP", "R$": "BRL", "US$": "USD", "CA$": "CAD", "C$": "CAD", "A$": "AUD",
  "AU$": "AUD", "NZ$": "NZD", "HK$": "HKD", "S$": "SGD", "MX$": "MXN", "₹": "INR", "₩": "KRW",
  "₽": "RUB", "₺": "TRY", "₪": "ILS", "₴": "UAH", "₦": "NGN", "₱": "PHP", "₫": "VND",
  "฿": "THB", "zł": "PLN", "Kč": "CZK",
};
const CURRENCY_WORDS = { euro: "EUR", euros: "EUR" };

// What "$" alone is, where the page says which country it is written for.
const DOLLAR_REGIONS = { US: "USD", CA: "CAD", AU: "AUD", NZ: "NZD", SG: "SGD", HK: "HKD", MX: "MXN" };

// A figure as money is written: grouped in threes by a dot, a comma, an apostrophe or a
// space of any width, and never with more than two decimals. That last settles the grouping
// without asking the locale: "1.500" and "1,500" are fifteen hundred whichever language
// wrote them, because no price has three decimals.
const FIGURE =
  "\\d{1,3}(?:[.,'’\\u00a0\\u2009\\u202f ]\\d{3})+(?:[.,]\\d{1,2})?(?!\\d)|\\d+(?:[.,]\\d{1,2})?(?!\\d)";
// "45k", "45 K": thousands, as salaries are written in a hurry.
const THOUSANDS = "\\s?[kK](?!\\p{L})";
// A figure this large is not a salary somebody is being offered.
const LARGEST = 1e9;

// English is written both ways round, so only these places are read day first.
const DAY_FIRST_ENGLISH = new Set(["GB", "IE", "AU", "NZ", "IN"]);

// How far past its words a value is looked for, and how much may stand between them.
const WINDOW = 160;
const REACH_WITH_A_COLON = 40;
const REACH_WITHOUT = 12;
const PERIOD_REACH = 30;
const LABEL_REACH = 40;

// ------------------------------------------------------------------ the page's language

/** A page's declared language as a BCP 47 tag, `pt-BR`; "" where it is not one. Pages write
 *  "pt", "pt_PT" and "en-US,en;q=0.9"; the first of a list is taken. */
export function tagOf(raw) {
  const declared = String(raw || "").split(",")[0].trim().replace(/_/g, "-");
  if (!declared) {
    return "";
  }
  try {
    return Intl.getCanonicalLocales(declared)[0] || "";
  } catch {
    return "";
  }
}

/** The language a page says it is written in: its `<html lang>`, then an `og:locale` or
 *  `Content-Language` it declares. A stranger's text, checked by `tagOf`. */
export function pageLanguage(doc) {
  const declared = (doc.documentElement.getAttribute("lang") || doc.documentElement.getAttribute("xml:lang") || "").trim();
  if (declared) {
    return declared;
  }
  for (const tag of doc.querySelectorAll("meta")) {
    const name = (tag.getAttribute("property") || tag.getAttribute("name") || tag.getAttribute("http-equiv") || "")
      .trim().toLowerCase();
    const content = (tag.getAttribute("content") || "").trim();
    if (["og:locale", "content-language", "language"].includes(name) && content) {
      return content;
    }
  }
  return "";
}

/** The country a tag names, where it names one: `US` in `en-US`. */
export function regionOf(tag) {
  for (const subtag of tag.split("-").slice(1)) {
    if (/^[A-Za-z]{2}$/.test(subtag) || /^\d{3}$/.test(subtag)) {
      return subtag.toUpperCase();
    }
  }
  return "";
}

const speaks = (tag) => Boolean(tag) && Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0;

/** How the page's language writes a numeric date: "dmy", "mdy", or "" where it does not
 *  settle it. */
export function order(tag) {
  if (tag.split("-")[0] === "en") {
    const region = regionOf(tag);
    if (region === "US") {
      return "mdy";
    }
    return DAY_FIRST_ENGLISH.has(region) ? "dmy" : "";
  }
  if (!speaks(tag)) {
    return "";
  }
  const parts = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(new Date(Date.UTC(2026, 10, 25)));
  const kinds = parts.map((part) => part.type).filter((kind) => kind === "day" || kind === "month");
  if (kinds.length !== 2) {
    return "";
  }
  return kinds[0] === "day" ? "dmy" : "mdy";
}

const monthKey = (written) => written.trim().replace(/\.$/, "").toLowerCase();

/** Month names to their numbers, in English and the page's language, leaving out any name
 *  two months would share. */
function months(tag) {
  const merged = new Map();
  const clashes = new Set();
  for (const locale of speaks(tag) ? ["en", tag] : ["en"]) {
    for (let month = 0; month < 12; month++) {
      const when = new Date(Date.UTC(2026, month, 15));
      for (const style of ["long", "short"]) {
        // On its own and beside a day: some languages inflect the name inside a date.
        for (const options of [{ month: style }, { day: "numeric", month: style }]) {
          const found = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
            .formatToParts(when).find((part) => part.type === "month");
          const name = found ? monthKey(found.value) : "";
          if (name && !/\d/.test(name)) {
            if (merged.has(name) && merged.get(name) !== month + 1) {
              clashes.add(name);
            }
            merged.set(name, merged.get(name) ?? month + 1);
          }
        }
      }
    }
  }
  for (const name of clashes) {
    merged.delete(name);
  }
  return merged;
}

// ------------------------------------------------------------------ the words

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const straight = (text) => String(text || "").replace(/’/g, "'");

// One spelling, matched whole: "/yr" straight after a figure, "per annum" across any
// spacing, "p.a." with its dots.
function wordPattern(word) {
  const body = escape(straight(word).replace(/^\//, "").trim()).replace(/ /g, "\\s+");
  return word.startsWith("/") ? `\\s{0,2}/\\s{0,2}${body}(?!\\p{L})` : `(?<!\\p{L})${body}(?!\\p{L})`;
}

const patternSource = (spellings) =>
  [...new Set(spellings)].sort((a, b) => b.length - a.length).map(wordPattern).join("|") || "(?!)";
const patternFor = (spellings, flags = "iu") => new RegExp(patternSource(spellings), flags);

// Whether what stands between a label and a value is only the label running on to it. Not a
// sentence, not a number, not another paragraph, not another label: "Closing date: 30
// October 2026" and "Salary €45,000" run on; "salary sacrifice scheme worth up to £500"
// does not, and neither does "Deadline: ASAP. Start date: 1 November".
function runsOn(filler) {
  if (/[\d!?;]/.test(filler) || filler.split("\n").length > 2 || filler.split(":").length > 2) {
    return false;
  }
  for (const stop of filler.matchAll(/\.\s+/g)) {
    const end = stop.index + stop[0].length;
    const next = filler[end];
    if (end < filler.length && next !== next.toLowerCase() && next === next.toUpperCase()) {
      return false; // a full stop and a capital: a new sentence, and not this label's
    }
  }
  if (filler.includes(":") || filler.includes("\n")) {
    return filler.length <= REACH_WITH_A_COLON;
  }
  return filler.length <= REACH_WITHOUT;
}

// The tail of `before` that can label the figure after it: the last three words when only
// spaces and colons separate them from the end, and nothing at or before a sentence stop or
// a separator such as a bar. "Daily standups. Salary: 40,000" is not paid by the day.
function labelling(before) {
  let tail = before.slice(-LABEL_REACH);
  const stop = Math.max(...[".", "!", "?", ";", "|", "\n", "•"].map((mark) => tail.lastIndexOf(mark)));
  tail = tail.slice(stop + 1);
  const found = /(?:\p{L}+[\s:]{0,3}){1,3}$/u.exec(tail);
  return found ? found[0] : "";
}

// Each `[label, what follows it]` in `text`: the label's own words with the word before
// them, and the stretch after it where the value it labels has to start.
function* after(spellings, text) {
  for (const hit of text.matchAll(patternFor(spellings, "giu"))) {
    const line = text.lastIndexOf("\n", hit.index - 1) + 1;
    const before = labelling(text.slice(line, hit.index));
    yield [`${before}${hit[0]}`, text.slice(hit.index + hit[0].length, hit.index + hit[0].length + WINDOW)];
  }
}

// ------------------------------------------------------------------ dates

function datePattern(names) {
  const month = [...names.keys()].sort((a, b) => b.length - a.length).map(escape).join("|");
  // "de", "of", "du": the short word some languages put between a day, a month and a year.
  const little = "(?:\\s+\\p{L}{1,3})?";
  return new RegExp(
    "(?<iso>(?<iy>\\d{4})-(?<im>\\d{1,2})-(?<id>\\d{1,2}))(?!\\d)" +
      "|(?<ymd>(?<yy>\\d{4})(?<ys>[./])(?<ym>\\d{1,2})\\k<ys>(?<yd>\\d{1,2}))(?!\\d)" +
      "|(?<num>(?<na>\\d{1,2})(?<ns>[./-])(?<nb>\\d{1,2})\\k<ns>(?<ny>\\d{4}|\\d{2}))(?!\\d)" +
      `|(?<dm>(?<dd>\\d{1,2})(?:st|nd|rd|th|º|ª|er|\\.)?${little}\\s*` +
      `(?<dmm>${month})(?!\\p{L})\\.?,?${little}\\s+(?<dy>\\d{4}))(?!\\d)` +
      `|(?<md>(?<mdm>${month})(?!\\p{L})\\.?\\s+(?<mdd>\\d{1,2})(?:st|nd|rd|th)?,?` +
      "\\s+(?<mdy>\\d{4}))(?!\\d)",
    "iu",
  );
}

/** `YYYY-MM-DD` for a real day, else null. */
function day(year, month, dayOfMonth) {
  const when = new Date(Date.UTC(year, month - 1, dayOfMonth));
  if (year < 1000 || when.getUTCFullYear() !== year || when.getUTCMonth() !== month - 1 || when.getUTCDate() !== dayOfMonth) {
    return null;
  }
  return when.toISOString().slice(0, 10);
}

// One date the pattern matched, or null where it is not a day or reads two ways.
function readDate(match, names, written) {
  const get = (name) => match.groups[name];
  if (get("iso")) {
    return day(+get("iy"), +get("im"), +get("id"));
  }
  if (get("ymd")) {
    return day(+get("yy"), +get("ym"), +get("yd"));
  }
  if (get("num")) {
    const first = +get("na");
    const second = +get("nb");
    let year = +get("ny");
    year = year > 99 ? year : 2000 + year;
    if (first > 12 && second <= 12) {
      return day(year, second, first);
    }
    if (second > 12 && first <= 12) {
      return day(year, first, second);
    }
    if (written === "dmy") {
      return day(year, second, first);
    }
    return written === "mdy" ? day(year, first, second) : null;
  }
  if (get("dm")) {
    const month = names.get(monthKey(get("dmm")));
    return month ? day(+get("dy"), month, +get("dd")) : null;
  }
  if (get("md")) {
    const month = names.get(monthKey(get("mdm")));
    return month ? day(+get("mdy"), month, +get("mdd")) : null;
  }
  return null;
}

/** The last day to apply (`YYYY-MM-DD`), where the page writes it just after its words for
 *  that; null otherwise. */
export function closingDate(text, tag = "") {
  const names = months(tag);
  const pattern = datePattern(names);
  const written = order(tag);
  const found = new Set();
  for (const [, following] of after(CLOSING_WORDS, straight(text))) {
    const match = pattern.exec(following);
    if (match === null || !runsOn(following.slice(0, match.index))) {
      continue;
    }
    const date = readDate(match, names, written);
    if (date !== null) {
      found.add(date);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

// ------------------------------------------------------------------ pay

// ISO 4217 codes: the browser's own list, with the commonest as a floor where it has none.
function currencyCodes() {
  try {
    return new Set(Intl.supportedValuesOf("currency"));
  } catch {
    return new Set(["EUR", "USD", "GBP", "CHF", "CAD", "AUD", "NZD", "SEK", "NOK", "DKK", "PLN", "CZK", "BRL", "INR", "JPY", "CNY"]);
  }
}
const CODES = currencyCodes();

/** A figure as a page writes it, as a plain decimal string: "1.385,99" and "1,385.99"
 *  alike. Null where it is not one. */
export function figure(written) {
  const raw = String(written || "").replace(/[\s'’]/g, "");
  const marks = [...raw].filter((character) => character === "." || character === ",");
  let digits = raw;
  if (marks.length) {
    const last = raw.lastIndexOf(marks[marks.length - 1]);
    const tail = raw.slice(last + 1);
    if (new Set(marks).size === 1 && (marks.length > 1 || tail.length === 3)) {
      // Only one kind of mark, and three digits after it: it groups, whatever the language.
      digits = raw.replaceAll(marks[marks.length - 1], "");
    } else {
      digits = `${raw.slice(0, last).replaceAll(".", "").replaceAll(",", "")}.${tail}`;
    }
  }
  return /^\d+(\.\d+)?$/.test(digits) ? digits : null;
}

/** A decimal string times a thousand, without going through a float. */
function thousand(value) {
  const [whole, fraction = ""] = value.split(".");
  const padded = fraction.padEnd(3, "0");
  const rest = padded.slice(3).replace(/0+$/, "");
  return (whole + padded.slice(0, 3)).replace(/^0+(?=\d)/, "") + (rest ? `.${rest}` : "");
}

function currencyPattern(dollar) {
  const symbols = Object.keys(SYMBOLS)
    .sort((a, b) => b.length - a.length)
    .map((symbol) => (/\p{L}/u.test(symbol[0]) ? `(?<!\\p{L})${escape(symbol)}` : escape(symbol)));
  const ways = [
    ...symbols,
    `(?<![A-Za-z])(?:${[...CODES].sort().join("|")})(?![A-Za-z])`,
    "(?<!\\p{L})euros?(?!\\p{L})",
  ];
  if (dollar) {
    ways.push("(?<![A-Za-z])\\$");
  }
  return ways.join("|");
}

function currencyCode(written, dollar) {
  const one = String(written || "").trim();
  if (Object.hasOwn(SYMBOLS, one)) {
    return SYMBOLS[one];
  }
  if (Object.hasOwn(CURRENCY_WORDS, one.toLowerCase())) {
    return CURRENCY_WORDS[one.toLowerCase()];
  }
  if (one === "$") {
    return dollar;
  }
  return CODES.has(one) ? one : "";
}

function payPattern(dollar) {
  const currency = currencyPattern(dollar);
  const one = (n) =>
    `(?:(?<before${n}>${currency})\\s{0,2})?(?<figure${n}>${FIGURE})(?<thousands${n}>${THOUSANDS})?` +
    `(?:\\s{0,2}(?<after${n}>${currency}))?`;
  const join = `\\s*(?:[-–—]|${patternSource(RANGE_WORDS)})\\s*`;
  return new RegExp(`${one(1)}(?:${join}${one(2)})?`, "iu");
}

// `[low, high, currency]` from one match, as decimal strings; null unless it names one
// currency.
function readPay(match, dollar) {
  const get = (name) => match.groups[name];
  const written = ["before1", "after1", "before2", "after2"].map(get).filter(Boolean);
  const currencies = new Set(written.map((one) => currencyCode(one, dollar)));
  if (currencies.has("") || currencies.size > 1 || !currencies.size) {
    return null;
  }
  let low = figure(get("figure1"));
  if (low === null) {
    return null;
  }
  if (get("thousands1")) {
    low = thousand(low);
  }
  let high = null;
  if (get("figure2")) {
    high = figure(get("figure2"));
    if (high === null) {
      return null;
    }
    if (get("thousands2")) {
      high = thousand(high);
      // "45-55k" is forty-five to fifty-five thousand, as people write it.
      if (!get("thousands1") && Number(thousand(low)) <= Number(high)) {
        low = thousand(low);
      }
    }
  }
  if (!(Number(low) > 0) || (high !== null && Number(high) < Number(low)) || Math.max(Number(low), Number(high ?? low)) >= LARGEST) {
    return null;
  }
  return [low, high, [...currencies][0]];
}

// The period the page states for a figure: the nearest after it on its line, else the one
// its label names ("Annual salary"). "" where it states none, or two.
function periodOf(following, label) {
  const line = following.split("\n", 1)[0].slice(0, PERIOD_REACH);
  let nearest = "";
  let where = line.length + 1;
  for (const [period, spellings] of Object.entries(PERIOD_WORDS)) {
    const hit = patternFor(spellings).exec(line);
    if (hit !== null && hit.index < where) {
      [nearest, where] = [period, hit.index];
    }
  }
  if (nearest) {
    return nearest;
  }
  const named = Object.keys(PERIOD_WORDS).filter((period) => patternFor(PERIOD_WORDS[period]).test(label));
  return named.length === 1 ? named[0] : "";
}

/** `{low, high, currency, period}` (decimal strings, or null and "") where the page writes
 *  its pay just after its words for that, in a currency it names; all empty otherwise. A
 *  single figure is the least on offer, unless the words before it say it is the most
 *  ("up to 40,000"). Two readings of the page that disagree are no reading. */
export function salary(text, tag = "") {
  const nothing = { low: null, high: null, currency: "", period: "" };
  const dollar = DOLLAR_REGIONS[regionOf(tag)] || "";
  const pattern = payPattern(dollar);
  const upTo = patternFor(UP_TO_WORDS);
  const found = new Map();
  for (const [label, following] of after(SALARY_WORDS, straight(text))) {
    const match = pattern.exec(following);
    if (match === null) {
      continue;
    }
    const filler = following.slice(0, match.index);
    if (!runsOn(filler)) {
      continue;
    }
    const read = readPay(match, dollar);
    if (read === null) {
      continue;
    }
    let [low, high] = read;
    if (high === null && upTo.test(filler)) {
      [low, high] = [null, low];
    }
    const result = { low, high, currency: read[2], period: periodOf(following.slice(match.index + match[0].length), `${label} ${filler}`) };
    found.set(JSON.stringify(result), result);
  }
  return found.size === 1 ? [...found.values()][0] : nothing;
}
