// The posting as a form: what the popup shows after reading a page, and what the list of
// captures shows to edit one. One definition, so the two never disagree about a field.
//
// The labels and choices are Postulo's own words from its posting form, in each of its
// languages (see _locales), so the extension and the review screen say the same thing.

import { t } from "./i18n.js";

let made = 0;

function field(id, label, control) {
  const wrapper = document.createElement("div");
  const caption = document.createElement("label");
  caption.htmlFor = id;
  caption.textContent = label;
  control.id = id;
  wrapper.append(caption, control);
  return wrapper;
}

function input(name, attributes = {}) {
  const control = document.createElement("input");
  control.name = name;
  for (const [attribute, value] of Object.entries(attributes)) {
    control.setAttribute(attribute, value);
  }
  return control;
}

function select(name, choices) {
  const control = document.createElement("select");
  control.name = name;
  control.add(new Option("—", ""));
  for (const [value, label] of choices) {
    control.add(new Option(label, value));
  }
  return control;
}

function pair(...fields) {
  const row = document.createElement("div");
  row.className = "pair";
  row.append(...fields);
  return row;
}

/** A new form, and what it needs: `fill(data)` puts a posting in, `values(read)` takes the
 *  posting out, with the fields the form does not show kept as they were read. */
export function postingForm() {
  made += 1;
  const id = (name) => `posting-${made}-${name}`;
  const form = document.createElement("form");
  form.className = "posting";

  const description = document.createElement("textarea");
  description.name = "description";
  description.rows = 7;
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = t("fieldDescription");
  summary.id = id("description-label");
  description.setAttribute("aria-labelledby", summary.id);
  details.append(summary, description);

  form.append(
    field(id("title"), t("fieldTitle"), input("title", { maxlength: 500, required: "" })),
    pair(
      field(id("company"), t("fieldCompany"), input("company_name", { maxlength: 500 })),
      field(id("location"), t("fieldLocation"), input("location", { maxlength: 500 })),
    ),
    pair(
      field(
        id("remote"),
        t("fieldRemote"),
        select("remote_type", [
          ["onsite", t("remoteOnsite")],
          ["hybrid", t("remoteHybrid")],
          ["remote", t("remoteRemote")],
        ]),
      ),
      field(
        id("employment"),
        t("fieldEmployment"),
        select("employment_type", [
          ["full_time", t("employmentFullTime")],
          ["part_time", t("employmentPartTime")],
          ["contract", t("employmentContract")],
          ["freelance", t("employmentFreelance")],
          ["internship", t("employmentInternship")],
          ["apprenticeship", t("employmentApprenticeship")],
        ]),
      ),
    ),
    pair(
      field(id("salary-min"), t("fieldSalaryFrom"), input("salary_min", { type: "number", min: 0, step: "any", inputmode: "decimal" })),
      field(id("salary-max"), t("fieldSalaryTo"), input("salary_max", { type: "number", min: 0, step: "any", inputmode: "decimal" })),
    ),
    pair(
      field(id("currency"), t("fieldCurrency"), input("salary_currency", { maxlength: 3, autocapitalize: "characters", spellcheck: "false" })),
      field(
        id("period"),
        t("fieldPeriod"),
        select("salary_period", [
          ["year", t("periodYear")],
          ["month", t("periodMonth")],
          ["day", t("periodDay")],
          ["hour", t("periodHour")],
        ]),
      ),
    ),
    field(id("closes"), t("fieldCloses"), input("closes_at", { type: "date" })),
    details,
  );

  const shown = [...form.elements].filter((element) => element.name).map((element) => element.name);

  return {
    form,
    fill(data) {
      for (const name of shown) {
        const control = form.elements[name];
        const value = data[name] ?? "";
        // A value a source wrote that the list has no word for is shown as it is, not lost.
        if (control instanceof HTMLSelectElement && value && ![...control.options].some((option) => option.value === value)) {
          control.add(new Option(value, value));
        }
        control.value = value;
      }
    },
    values(read = {}) {
      const posting = { ...read };
      for (const name of shown) {
        posting[name] = form.elements[name].value.trim();
      }
      posting.salary_currency = posting.salary_currency.toUpperCase();
      for (const name of ["salary_min", "salary_max", "closes_at"]) {
        posting[name] = posting[name] || null;
      }
      return posting;
    },
    focus() {
      form.elements.title.focus();
    },
  };
}
