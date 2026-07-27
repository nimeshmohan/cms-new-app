function toDatetimeLocalValue(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

function itemDisplayName(item) {
  const fd = item.fieldData || {};
  return fd.name || fd.title || fd.slug || item.id;
}

async function buildInput(field, value, context) {
  const type = (field.type || "").toLowerCase();
  let el;

  switch (type) {
    case "switch":
      el = document.createElement("input");
      el.type = "checkbox";
      el.checked = Boolean(value);
      break;

    case "number":
      el = document.createElement("input");
      el.type = "number";
      el.step = "any";
      if (value !== undefined && value !== null) el.value = value;
      break;

    case "richtext":
      el = document.createElement("textarea");
      el.rows = 6;
      el.placeholder = "HTML content";
      if (value) el.value = value;
      break;

    case "option": {
      el = document.createElement("select");
      const options = field.validations?.options || [];
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "-- select --";
      el.appendChild(blank);
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = opt.id;
        o.textContent = opt.name;
        if (value === opt.id) o.selected = true;
        el.appendChild(o);
      }
      break;
    }

    case "date":
    case "datetime":
      el = document.createElement("input");
      el.type = "datetime-local";
      if (value) el.value = toDatetimeLocalValue(value);
      break;

    case "email":
      el = document.createElement("input");
      el.type = "email";
      if (value) el.value = value;
      break;

    case "phone":
      el = document.createElement("input");
      el.type = "tel";
      if (value) el.value = value;
      break;

    case "link":
    case "video":
    case "externalurl":
      el = document.createElement("input");
      el.type = "url";
      if (value) el.value = value;
      break;

    case "color":
      el = document.createElement("input");
      el.type = "color";
      el.value = value || "#000000";
      break;

    case "image":
      el = document.createElement("input");
      el.type = "file";
      el.accept = "image/*";
      break;

    case "multiimage":
      el = document.createElement("input");
      el.type = "file";
      el.accept = "image/*";
      el.multiple = true;
      break;

    case "file":
      el = document.createElement("input");
      el.type = "file";
      break;

    case "reference": {
      const cid = field.validations?.collectionId;
      const items = cid && context?.getReferencedItems ? await context.getReferencedItems(cid) : [];
      el = document.createElement("select");
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = items.length ? "-- select --" : "(no linked items found)";
      el.appendChild(blank);
      for (const item of items) {
        const o = document.createElement("option");
        o.value = item.id;
        o.textContent = itemDisplayName(item);
        if (value === item.id) o.selected = true;
        el.appendChild(o);
      }
      break;
    }

    case "multireference": {
      const cid = field.validations?.collectionId;
      const items = cid && context?.getReferencedItems ? await context.getReferencedItems(cid) : [];
      el = document.createElement("select");
      el.multiple = true;
      el.size = Math.min(6, Math.max(3, items.length || 3));
      const selected = Array.isArray(value) ? value : [];
      for (const item of items) {
        const o = document.createElement("option");
        o.value = item.id;
        o.textContent = itemDisplayName(item);
        if (selected.includes(item.id)) o.selected = true;
        el.appendChild(o);
      }
      break;
    }

    case "plaintext":
    default:
      el = document.createElement("input");
      el.type = "text";
      if (value) el.value = value;
      break;
  }

  el.id = `field-${field.id}`;
  el.dataset.fieldSlug = field.slug;
  el.dataset.fieldType = type;
  if (field.isEditable === false) el.disabled = true;
  return el;
}

async function buildFieldRow(field, value, context) {
  const wrapper = document.createElement("div");
  wrapper.className = "form-row";

  const label = document.createElement("label");
  label.htmlFor = `field-${field.id}`;
  label.textContent = field.displayName + (field.isRequired ? " *" : "");
  wrapper.appendChild(label);

  wrapper.appendChild(await buildInput(field, value, context));

  return wrapper;
}

export async function buildDynamicForm(schema, initialValues = {}, context = {}) {
  const container = document.createElement("div");
  container.className = "form-fields";
  for (const field of schema.fields) {
    container.appendChild(await buildFieldRow(field, initialValues[field.slug], context));
  }
  return container;
}

function readFieldValue(field, el) {
  const type = (field.type || "").toLowerCase();
  switch (type) {
    case "switch":
      return el.checked;
    case "number":
      return el.value === "" ? null : Number(el.value);
    case "multireference":
      return Array.from(el.selectedOptions).map((o) => o.value);
    case "image":
    case "multiimage":
    case "file":
      return el.files && el.files.length ? Array.from(el.files).map((f) => f.name) : null;
    default:
      return el.value === "" ? null : el.value;
  }
}

export function readFormValues(container, schema) {
  const values = {};
  for (const field of schema.fields) {
    const el = container.querySelector(`[data-field-slug="${CSS.escape(field.slug)}"]`);
    if (!el) continue;
    values[field.slug] = readFieldValue(field, el);
  }
  return values;
}
