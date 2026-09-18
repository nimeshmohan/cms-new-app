import { describe, it, expect } from "vitest";
import { filterItemsByQuery, computePagination, paginateItems } from "./items-helpers.js";

function makeItems(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i + 1}`,
    fieldData: { name: `Item ${i + 1}` },
  }));
}

describe("filterItemsByQuery", () => {
  const items = [
    { id: "1", fieldData: { name: "Blog post about cats" } },
    { id: "2", fieldData: { name: "Recipe for dogs" } },
    { id: "3", fieldData: { title: "CAT toys" } },
  ];

  it("returns all items when the query is empty or whitespace", () => {
    expect(filterItemsByQuery(items, "")).toEqual(items);
    expect(filterItemsByQuery(items, "   ")).toEqual(items);
  });

  it("filters case-insensitively against the item's display name", () => {
    const result = filterItemsByQuery(items, "cat");
    expect(result.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("falls back to the item id when no name/title/slug is present", () => {
    const withIdOnly = [{ id: "item-xyz", fieldData: {} }];
    expect(filterItemsByQuery(withIdOnly, "xyz")).toHaveLength(1);
    expect(filterItemsByQuery(withIdOnly, "nomatch")).toHaveLength(0);
  });
});

describe("computePagination", () => {
  it("splits 151 items into 4 pages of 50", () => {
    expect(computePagination(151, 1, 50)).toMatchObject({
      page: 1,
      totalPages: 4,
      start: 1,
      end: 50,
      hasPrev: false,
      hasNext: true,
    });
    expect(computePagination(151, 2, 50)).toMatchObject({
      page: 2,
      start: 51,
      end: 100,
      hasPrev: true,
      hasNext: true,
    });
    expect(computePagination(151, 4, 50)).toMatchObject({
      page: 4,
      start: 151,
      end: 151,
      hasPrev: true,
      hasNext: false,
    });
  });

  it("handles zero items without dividing by zero or going negative", () => {
    expect(computePagination(0, 1, 50)).toMatchObject({
      page: 1,
      totalPages: 1,
      start: 0,
      end: 0,
      hasPrev: false,
      hasNext: false,
    });
  });

  it("clamps a requested page beyond the last page back to the last page", () => {
    expect(computePagination(151, 99, 50)).toMatchObject({ page: 4, start: 151, end: 151 });
  });

  it("clamps a requested page below 1 up to page 1", () => {
    expect(computePagination(151, 0, 50)).toMatchObject({ page: 1, start: 1, end: 50 });
  });

  it("handles an exact multiple of the page size without an empty trailing page", () => {
    expect(computePagination(100, 2, 50)).toMatchObject({ totalPages: 2, page: 2, start: 51, end: 100 });
  });
});

describe("paginateItems", () => {
  it("returns the correct slice for each page", () => {
    const items = makeItems(151);
    expect(paginateItems(items, 1, 50)).toHaveLength(50);
    expect(paginateItems(items, 1, 50)[0].id).toBe("id-1");
    expect(paginateItems(items, 2, 50)[0].id).toBe("id-51");
    expect(paginateItems(items, 4, 50)).toHaveLength(1);
    expect(paginateItems(items, 4, 50)[0].id).toBe("id-151");
  });

  it("clamps an out-of-range page to the last page's items", () => {
    const items = makeItems(151);
    expect(paginateItems(items, 999, 50)).toEqual(paginateItems(items, 4, 50));
  });
});
