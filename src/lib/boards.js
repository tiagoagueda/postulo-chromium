// A recipe per board, for the boards that publish nothing a standard can read.
//
// Carried over from postulo/plugins/builtin/boards, recipe for recipe. That package's own
// comment is the long version; the short one is that most boards embed a schema.org
// JobPosting and are read by the standard, some publish nothing at all, and a recipe is one
// board's answer written down. It is a supplement and never a replacement: the recipe runs
// first and the standards fill whatever it left empty, so a board that starts publishing
// JSON-LD improves without its recipe being touched.
//
// A recipe states only what it is sure of. Leaving a field empty puts it in front of the
// person reviewing the capture; filling it wrongly puts a wrong value into their records
// quietly, which is the thing this exists to avoid. None of them guesses, and none should
// be written against a board whose markup nobody has read.
//
// Each `read` is given the document's body, a `text` helper and the vocabulary that turns
// a board's word for an employment type into Postulo's, rather than reaching for `parse.js`
// itself, so that this file and that one do not import each other.

/** LinkedIn. No JSON-LD, no microdata; everything behind a class name.
 *
 *  `topcard__flavor--bullet` is on the place *and* on the applicant count, and the count
 *  carries `--metadata` as well, which is the only thing telling them apart. Without that
 *  the location reads "188 applicants" on every advert.
 *
 *  No date: LinkedIn shows "2 months ago", relative and in the reader's language. Turning
 *  that into a date means parsing 39 languages and guessing what it was relative to, and a
 *  date somebody can see and type is better than one Postulo invented. No salary either:
 *  free text in the poster's language where it appears at all. */
function linkedin(body, url, text, employmentType) {
  const found = {};
  const title = body.querySelector(".topcard__title");
  if (title) {
    found.title = text(title);
  }
  const company = body.querySelector(".topcard__org-name-link");
  if (company) {
    found.company_name = text(company);
  }
  const place = body.querySelector(".topcard__flavor--bullet:not(.topcard__flavor--metadata)");
  if (place) {
    found.location = text(place);
  }
  const description = body.querySelector(".description__text") || body.querySelector(".show-more-less-html");
  if (description) {
    found.description = text(description);
  }
  // The criteria list holds the employment type, under a heading in the reader's language.
  // Rather than keep a table of that heading in 39 languages, every value is offered to the
  // vocabulary and the one it recognises wins: "Full-time" is read, "Mid-Senior level" and
  // "Health Care Provider" are not, and a page in a language whose words Postulo does not
  // know leaves the field for a person. Nothing is guessed, and nothing is taken from the
  // wrong row.
  for (const criterion of body.querySelectorAll(".description__job-criteria-text")) {
    const known = employmentType(text(criterion));
    if (known) {
      found.employment_type = known;
      break;
    }
  }
  return found;
}

/** Greenhouse writes the logo's alt text as "<Company> Logo". */
const LOGO_SUFFIX = /\s*logo\s*$/i;

/** Greenhouse. Hosts a very large share of what people apply through, publishes nothing.
 *
 *  `job__title` wraps the heading *and* `job__location`, so the heading itself is taken or
 *  the title comes out as "AI Engineer\n\nRemote, Bangalore". The company is only ever in
 *  the logo's alt text and in the page title as "Job Application for <job> at <company>";
 *  the alt text is taken because, unlike that sentence, it does not change with language. */
function greenhouse(body, url, text) {
  const found = {};
  const header = body.querySelector(".job__title");
  if (header) {
    found.title = text(header.querySelector("h1") || header);
  }
  const place = body.querySelector(".job__location");
  if (place) {
    found.location = text(place);
  }
  const description = body.querySelector(".job__description");
  if (description) {
    found.description = text(description);
  }
  const logo = body.querySelector(".logo img[alt]");
  const name = logo ? logo.getAttribute("alt").replace(LOGO_SUFFIX, "").trim() : "";
  if (name) {
    found.company_name = name;
  }
  return found;
}

/** Every recipe, in the order they are tried. One board matches, or none does. */
export const BOARDS = [
  { name: "linkedin", hosts: ["linkedin.com"], read: linkedin },
  { name: "greenhouse", hosts: ["greenhouse.io"], read: greenhouse },
];

/** The recipe for this address, if a board claims it. */
export function recipeFor(url) {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) {
    return null;
  }
  // Every LinkedIn country host is the same page: fr.linkedin.com, ch.linkedin.com, …
  return BOARDS.find((board) => board.hosts.some((known) => host === known || host.endsWith(`.${known}`))) || null;
}
