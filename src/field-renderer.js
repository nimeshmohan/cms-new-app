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

function normalizeRichTextHtml(html) {
  const trimmed = html.trim();
  if (trimmed === "" || trimmed === "<br>") return null;
  return /^</.test(trimmed) ? trimmed : `<p>${trimmed}</p>`;
}

function filenameFromUrl(url) {
  try {
    return decodeURIComponent(url.split("/").pop().split("?")[0]);
  } catch {
    return url;
  }
}

function describeAssetValue(value, multiple) {
  if (multiple) {
    return Array.isArray(value) && value.length ? `${value.length} file(s) selected` : "No files chosen";
  }
  return value?.url ? filenameFromUrl(value.url) : "No file chosen";
}

const RICHTEXT_BLOCKS = [
  { label: "Paragraph", command: "formatBlock", value: "p" },
  { label: "Heading 1", command: "formatBlock", value: "h1" },
  { label: "Heading 2", command: "formatBlock", value: "h2" },
  { label: "Heading 3", command: "formatBlock", value: "h3" },
  { label: "Heading 4", command: "formatBlock", value: "h4" },
  { label: "Heading 5", command: "formatBlock", value: "h5" },
  { label: "Heading 6", command: "formatBlock", value: "h6" },
  { label: "Quote", command: "formatBlock", value: "blockquote" },
  { label: "Bulleted list", command: "insertUnorderedList" },
  { label: "Numbered list", command: "insertOrderedList" },
];

function getCurrentBlock(editor, node) {
  let n = node;
  while (n && n.parentNode !== editor) {
    n = n.parentNode;
  }
  return n && n.nodeType === 1 ? n : null;
}

function applyBlock(editor, command, value) {
  editor.focus();
  if (command === "formatBlock") {
    document.execCommand("formatBlock", false, value);
  } else {
    document.execCommand(command, false, null);
  }
}

function buildRichTextInput(field, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "richtext-field";
  const editable = field.isEditable !== false;

  const editor = document.createElement("div");
  editor.className = "richtext-editor";
  editor.contentEditable = editable ? "true" : "false";
  editor.dataset.placeholder = "Type your content, or click + for a block type...";
  editor.id = `field-${field.id}`;
  editor.dataset.fieldSlug = field.slug;
  editor.dataset.fieldType = "richtext";
  editor.innerHTML = value || "";

  const blockPlus = document.createElement("button");
  blockPlus.type = "button";
  blockPlus.className = "richtext-block-plus hidden";
  blockPlus.textContent = "+";
  blockPlus.title = "Insert block";

  const blockMenu = document.createElement("div");
  blockMenu.className = "richtext-menu hidden";
  for (const item of RICHTEXT_BLOCKS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      applyBlock(editor, item.command, item.value);
      blockMenu.classList.add("hidden");
    });
    blockMenu.appendChild(btn);
  }

  blockPlus.addEventListener("mousedown", (e) => {
    e.preventDefault();
    blockMenu.style.top = `${blockPlus.offsetTop + blockPlus.offsetHeight + 4}px`;
    blockMenu.style.left = `${blockPlus.offsetLeft}px`;
    blockMenu.classList.toggle("hidden");
  });

  const inlineToolbar = document.createElement("div");
  inlineToolbar.className = "richtext-inline-toolbar hidden";
  const inlineButtons = [
    { label: "B", command: "bold" },
    { label: "I", command: "italic" },
    { label: "Link", command: "link" },
  ];
  for (const b of inlineButtons) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = b.label;
    btn.className = `richtext-inline-btn richtext-inline-${b.command}`;
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (b.command === "link") {
        const url = window.prompt("Link URL:", "https://");
        if (url) document.execCommand("createLink", false, url);
      } else {
        document.execCommand(b.command, false, null);
      }
    });
    inlineToolbar.appendChild(btn);
  }

  function updateEmptyLineButton() {
    const sel = window.getSelection();
    if (!editable || !sel.rangeCount || !editor.contains(sel.anchorNode)) {
      blockPlus.classList.add("hidden");
      return;
    }
    const block = getCurrentBlock(editor, sel.anchorNode);
    if (block && block.textContent.trim() === "") {
      blockPlus.style.top = `${block.offsetTop}px`;
      blockPlus.classList.remove("hidden");
    } else {
      blockPlus.classList.add("hidden");
      blockMenu.classList.add("hidden");
    }
  }

  function updateInlineToolbar() {
    const sel = window.getSelection();
    if (!editable || !sel.rangeCount || sel.isCollapsed || !editor.contains(sel.anchorNode)) {
      inlineToolbar.classList.add("hidden");
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    inlineToolbar.style.left = `${rect.left - wrapperRect.left}px`;
    inlineToolbar.style.top = `${rect.top - wrapperRect.top - 42}px`;
    inlineToolbar.classList.remove("hidden");
  }

  editor.addEventListener("keyup", () => {
    updateEmptyLineButton();
    updateInlineToolbar();
  });
  editor.addEventListener("mouseup", () => {
    updateEmptyLineButton();
    updateInlineToolbar();
  });
  editor.addEventListener("focus", updateEmptyLineButton);
  editor.addEventListener("blur", () => {
    setTimeout(() => {
      if (!wrapper.contains(document.activeElement)) {
        blockPlus.classList.add("hidden");
        blockMenu.classList.add("hidden");
        inlineToolbar.classList.add("hidden");
      }
    }, 150);
  });

  wrapper.appendChild(blockPlus);
  wrapper.appendChild(blockMenu);
  wrapper.appendChild(inlineToolbar);
  wrapper.appendChild(editor);
  return wrapper;
}

function buildAssetInput(field, value, context, { multiple, images }) {
  const wrapper = document.createElement("div");
  wrapper.className = "asset-field";

  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.id = `field-${field.id}`;
  hidden.dataset.fieldSlug = field.slug;
  hidden.dataset.fieldType = field.type.toLowerCase();
  const initial = multiple ? (Array.isArray(value) ? value : []) : value || null;
  hidden.value = JSON.stringify(initial);

  const preview = document.createElement("span");
  preview.className = "asset-preview";
  preview.textContent = describeAssetValue(initial, multiple);

  const pickBtn = document.createElement("button");
  pickBtn.type = "button";
  pickBtn.className = "secondary";
  pickBtn.textContent = multiple ? "Add files..." : "Choose file...";
  if (field.isEditable === false) pickBtn.disabled = true;

  pickBtn.addEventListener("click", async () => {
    if (!context?.pickFile || !context?.uploadAsset) return;
    const paths = await context.pickFile({ multiple, images });
    if (!paths || paths.length === 0) return;

    pickBtn.disabled = true;
    preview.textContent = "Uploading...";
    try {
      const uploaded = [];
      for (const path of paths) {
        uploaded.push(await context.uploadAsset(path));
      }
      const next = multiple ? [...JSON.parse(hidden.value || "[]"), ...uploaded] : uploaded[0];
      hidden.value = JSON.stringify(next);
      preview.textContent = describeAssetValue(next, multiple);
    } catch (err) {
      preview.textContent = `Upload failed: ${err}`;
    } finally {
      pickBtn.disabled = false;
    }
  });

  wrapper.appendChild(pickBtn);
  wrapper.appendChild(preview);
  wrapper.appendChild(hidden);
  return wrapper;
}

async function buildInput(field, value, context) {
  const type = (field.type || "").toLowerCase();

  if (type === "image") return buildAssetInput(field, value, context, { multiple: false, images: true });
  if (type === "file") return buildAssetInput(field, value, context, { multiple: false, images: false });
  if (type === "multiimage") return buildAssetInput(field, value, context, { multiple: true, images: true });
  if (type === "richtext") return buildRichTextInput(field, value);

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
      el.type = "url";
      el.placeholder = "Image URL (https://...)";
      if (value?.url) el.value = value.url;
      break;

    case "multiimage":
      el = document.createElement("input");
      el.type = "text";
      el.placeholder = "Image URLs, comma-separated";
      if (Array.isArray(value)) el.value = value.map((v) => v.url).join(", ");
      break;

    case "file":
      el = document.createElement("input");
      el.type = "url";
      el.placeholder = "File URL (https://...)";
      if (value?.url) el.value = value.url;
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
    case "richtext":
      return normalizeRichTextHtml(el.innerHTML);
    case "multireference":
      return Array.from(el.selectedOptions).map((o) => o.value);
    case "image":
    case "file": {
      try {
        const parsed = JSON.parse(el.value || "null");
        return parsed && parsed.url ? parsed : null;
      } catch {
        return null;
      }
    }
    case "multiimage": {
      try {
        const parsed = JSON.parse(el.value || "[]");
        return Array.isArray(parsed) && parsed.length ? parsed : null;
      } catch {
        return null;
      }
    }
    default:
      return el.value === "" ? null : el.value;
  }
}

export function readFormValues(container, schema) {
  const values = {};
  for (const field of schema.fields) {
    const el = container.querySelector(`[data-field-slug="${CSS.escape(field.slug)}"]`);
    if (!el) continue;
    const value = readFieldValue(field, el);
    if (value !== null) {
      values[field.slug] = value;
    }
  }
  return values;
}
