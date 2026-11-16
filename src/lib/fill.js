// Filling a form on the page in front of the person from their own details (#51).
//
// What this does and does not do, in one place, because it is the line the feature is
// drawn on: it puts text into empty text fields, marks each one it touched, and reports the
// rest. It never submits a form, never presses or clicks anything, never fills a password
// field, never overwrites what is already typed, and never attaches a file. The person reads
// what was filled and submits it, or not.

/** What may be filled, by the name this file gives it, and the autocomplete token that
 *  names the same thing in a page (HTML's own vocabulary for exactly this). */
export const KINDS = {
  given: "given-name",
  family: "family-name",
  name: "name",
  email: "email",
  prefix: "honorific-prefix",
  birthday: "bday",
};

/** The values to put into a form, from what Postulo answered to `GET /profile` and to
 *  `GET /me`. A value Postulo did not give is left out, so its field is listed and not
 *  filled with a blank. The date of birth goes only when it is a whole date. */
export function valuesFrom(profile, me) {
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const first = text(profile && profile.first_name);
  const last = text(profile && profile.last_name);
  const values = {
    given: first,
    family: last,
    name: [first, last].filter(Boolean).join(" "),
    email: text(me && me.owner),
    prefix: text(profile && profile.form_of_address && profile.form_of_address.label),
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(text(profile && profile.birth_date)) ? text(profile.birth_date) : "",
  };
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value));
}

/** The page's side. It is injected into the tab for this one call, so it uses nothing
 *  outside itself: not a name in this file, not an import. `values` is what to put in, by
 *  the keys of KINDS; `kinds` is KINDS, handed over because the function cannot see it.
 *
 *  Returns what it filled and, separately, the fields it left, as labels to read. */
export function fillPage(values, kinds) {
  const tokenOf = Object.fromEntries(Object.entries(kinds).map(([key, token]) => [token, key]));
  // Wording by which a field with no autocomplete token is recognised: the commonest
  // spellings in the languages boards are written in. A label that matches none is left.
  const wording = {
    email: /e-?mail|courriel|correo|posta elettronica/i,
    given: /first.?name|given.?name|forename|pr[ée]nom|vorname|primeiro.?nome|nombre de pila|nome proprio/i,
    family: /last.?name|family.?name|surname|nom de famille|nachname|apelido|apellido|cognome|[úu]ltimo nome/i,
    name: /^(?:full.?name|your name|name|nome|nome completo|nom|nom complet|nombre|nombre completo)\b[\s*:]*$/i,
  };
  const ELEMENT_TEXT = 80;

  const labelOf = (field) => {
    const parts = [];
    if (field.id) {
      for (const label of document.querySelectorAll("label")) {
        if (label.htmlFor === field.id) {
          parts.push(label.textContent);
        }
      }
    }
    const wrapping = field.closest("label");
    if (wrapping) {
      parts.push(wrapping.textContent);
    }
    parts.push(field.getAttribute("aria-label") || "", field.placeholder || "");
    const text = parts.map((part) => (part || "").replace(/\s+/g, " ").trim()).find(Boolean) || field.name || field.id || "";
    return text.slice(0, ELEMENT_TEXT);
  };

  const kindOf = (field) => {
    const autocomplete = (field.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
    for (const token of autocomplete) {
      if (tokenOf[token]) {
        return tokenOf[token];
      }
    }
    // A token that names something else decides it: a field marked for an address is not
    // an email because its label mentions one.
    const modifiers = ["", "on", "off", "shipping", "billing", "home", "work", "mobile", "fax", "pager"];
    if (autocomplete.some((token) => !modifiers.includes(token) && !token.startsWith("section-"))) {
      return "";
    }
    if (field.type === "email") {
      return "email";
    }
    const named = [field.name, field.id, field.getAttribute("aria-label"), field.placeholder, labelOf(field)].filter(Boolean);
    for (const key of ["email", "given", "family", "name"]) {
      if (named.some((text) => wording[key].test(String(text).replace(/[_[\]]+/g, " ").trim()))) {
        return key;
      }
    }
    return "";
  };

  const plain = (field) => {
    if (field.tagName === "TEXTAREA") {
      return true;
    }
    return field.tagName === "INPUT" && ["", "text", "email", "search", "date"].includes(field.type);
  };

  const usable = (field) => {
    if (field.disabled || field.readOnly || field.hidden || field.closest("[hidden], [aria-hidden='true']")) {
      return false;
    }
    // A browser lays the page out; a test environment does not, and has no such method.
    if (typeof field.checkVisibility === "function" && !field.checkVisibility()) {
      return false;
    }
    return true;
  };

  const setValue = (field, value) => {
    const prototype = field.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    // The page's framework watches the property's setter; set it the way the browser does
    // and say so with the events a keyboard would have raised.
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const filled = [];
  const left = [];
  for (const field of document.querySelectorAll("input, textarea, select")) {
    // Never a password, a file, a button, a box to tick or anything not shown.
    if (!usable(field) || field.type === "password" || (field.tagName === "INPUT" && !plain(field))) {
      continue;
    }
    if (field.tagName === "SELECT" || field.value) {
      // What is typed is the person's; a list is not text. Neither is reported as left.
      continue;
    }
    const kind = kindOf(field);
    const value = kind && values[kind];
    // A date field takes the date only in its own format, which is the one Postulo uses.
    if (value && (kind !== "birthday" || field.type === "date" || /^\d{4}-\d{2}-\d{2}$/.test(value)) && plain(field)) {
      setValue(field, value);
      field.style.outline = "2px solid #2563eb";
      field.style.outlineOffset = "2px";
      field.setAttribute("data-postulo-filled", kind);
      filled.push({ kind, label: labelOf(field) });
    } else {
      left.push(labelOf(field));
    }
  }
  return { filled, left: left.filter(Boolean).slice(0, 30) };
}
