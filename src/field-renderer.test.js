import { describe, it, expect } from "vitest";
import {
  itemDisplayName,
  toDatetimeLocalValue,
  normalizeRichTextHtml,
  filenameFromUrl,
  describeAssetValue,
  buildDynamicForm,
  readFormValues,
} from "./field-renderer.js";

describe("itemDisplayName", () => {
  it("prefers name, then title, then slug, then falls back to id", () => {
    expect(itemDisplayName({ id: "1", fieldData: { name: "N", title: "T", slug: "s" } })).toBe("N");
    expect(itemDisplayName({ id: "1", fieldData: { title: "T", slug: "s" } })).toBe("T");
    expect(itemDisplayName({ id: "1", fieldData: { slug: "s" } })).toBe("s");
    expect(itemDisplayName({ id: "1", fieldData: {} })).toBe("1");
    expect(itemDisplayName({ id: "1" })).toBe("1");
  });
});

describe("toDatetimeLocalValue", () => {
  it("formats a valid ISO date into a datetime-local value", () => {
    expect(toDatetimeLocalValue("2026-09-18T10:30:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("returns an empty string for an invalid date", () => {
    expect(toDatetimeLocalValue("not-a-date")).toBe("");
  });
});

describe("normalizeRichTextHtml", () => {
  it("treats empty content and a bare <br> as no content", () => {
    expect(normalizeRichTextHtml("")).toBeNull();
    expect(normalizeRichTextHtml("   ")).toBeNull();
    expect(normalizeRichTextHtml("<br>")).toBeNull();
  });

  it("wraps plain text in a paragraph", () => {
    expect(normalizeRichTextHtml("hello")).toBe("<p>hello</p>");
  });

  it("leaves existing HTML untouched", () => {
    expect(normalizeRichTextHtml("<h1>Title</h1>")).toBe("<h1>Title</h1>");
  });
});

describe("filenameFromUrl", () => {
  it("extracts and decodes the filename, stripping query params", () => {
    expect(filenameFromUrl("https://cdn.example.com/path/My%20File.png?v=2")).toBe("My File.png");
  });

  it("falls back to the raw url if it can't be parsed", () => {
    expect(filenameFromUrl("not a url with %")).toBe("not a url with %");
  });
});

describe("describeAssetValue", () => {
  it("describes a single asset", () => {
    expect(describeAssetValue(null, false)).toBe("No file chosen");
    expect(describeAssetValue({ url: "https://x/y/photo.png" }, false)).toBe("photo.png");
  });

  it("describes multiple assets", () => {
    expect(describeAssetValue([], true)).toBe("No files chosen");
    expect(describeAssetValue([{ url: "a" }, { url: "b" }], true)).toBe("2 file(s) selected");
  });
});

describe("buildDynamicForm / readFormValues round trip", () => {
  const schema = {
    id: "coll-1",
    fields: [
      { id: "f1", slug: "title", displayName: "Title", type: "PlainText", isRequired: true },
      { id: "f2", slug: "price", displayName: "Price", type: "Number" },
      { id: "f3", slug: "featured", displayName: "Featured", type: "Switch" },
      {
        id: "f4",
        slug: "category",
        displayName: "Category",
        type: "Option",
        validations: { options: [{ id: "opt-a", name: "A" }, { id: "opt-b", name: "B" }] },
      },
    ],
  };

  it("reads back values matching what was rendered", async () => {
    const initialValues = { title: "Hello", price: 9.5, featured: true, category: "opt-b" };
    const form = await buildDynamicForm(schema, initialValues, {});

    expect(form.querySelector('[data-field-slug="title"]').value).toBe("Hello");
    expect(form.querySelector('[data-field-slug="price"]').value).toBe("9.5");
    expect(form.querySelector('[data-field-slug="featured"]').checked).toBe(true);
    expect(form.querySelector('[data-field-slug="category"]').value).toBe("opt-b");

    const values = readFormValues(form, schema);
    expect(values).toEqual({
      title: "Hello",
      price: 9.5,
      featured: true,
      category: "opt-b",
    });
  });

  it("omits fields left blank instead of writing null/empty values", async () => {
    const form = await buildDynamicForm(schema, {}, {});
    const values = readFormValues(form, schema);
    // switch defaults to false, which is a real value and should be included;
    // untouched text/number/select fields should be omitted entirely.
    expect(values).toEqual({ featured: false });
  });

  it("resolves reference fields against the referenced collection's items", async () => {
    const refSchema = {
      id: "coll-2",
      fields: [
        {
          id: "f1",
          slug: "author",
          displayName: "Author",
          type: "Reference",
          validations: { collectionId: "authors" },
        },
      ],
    };
    const referencedItems = [
      { id: "a1", fieldData: { name: "Ada" } },
      { id: "a2", fieldData: { name: "Grace" } },
    ];
    const context = {
      getReferencedItems: async (collectionId) => (collectionId === "authors" ? referencedItems : []),
    };

    const form = await buildDynamicForm(refSchema, { author: "a2" }, context);
    const select = form.querySelector('[data-field-slug="author"]');
    expect(select.value).toBe("a2");
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["-- select --", "Ada", "Grace"]);

    expect(readFormValues(form, refSchema)).toEqual({ author: "a2" });
  });
});
