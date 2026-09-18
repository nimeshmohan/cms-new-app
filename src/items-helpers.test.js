import { describe, it, expect } from "vitest";
import { filterItemsByQuery, computePagination, paginateItems, sortItems, toggleSortState } from "./items-helpers.js";

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

describe("toggleSortState", () => {
  it("sorts ascending when a new column is clicked", () => {
    expect(toggleSortState({ key: null, direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
    expect(toggleSortState({ key: "created", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });

  it("flips direction when the same column is clicked again", () => {
    expect(toggleSortState({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(toggleSortState({ key: "name", direction: "desc" }, "name")).toEqual({
      key: "name",
      direction: "asc",
    });
  });
});

describe("sortItems", () => {
  const items = [
    { id: "b", fieldData: { name: "Banana" }, isDraft: false, createdOn: "2026-01-02T00:00:00Z" },
    { id: "a", fieldData: { name: "Apple" }, isDraft: true, createdOn: "2026-01-03T00:00:00Z" },
    { id: "c", fieldData: { name: "Cherry" }, isDraft: false, createdOn: null },
  ];

  it("returns the items unchanged when no sort key is set", () => {
    expect(sortItems(items, { key: null, direction: "asc" })).toEqual(items);
    expect(sortItems(items, null)).toEqual(items);
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    sortItems(items, { key: "name", direction: "asc" });
    expect(items).toEqual(copy);
  });

  it("sorts by name alphabetically, and reverses on desc", () => {
    expect(sortItems(items, { key: "name", direction: "asc" }).map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(sortItems(items, { key: "name", direction: "desc" }).map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts drafts before published items alphabetically by status label", () => {
    expect(sortItems(items, { key: "status", direction: "asc" }).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("treats a missing date as the oldest value instead of throwing", () => {
    const result = sortItems(items, { key: "created", direction: "asc" });
    expect(result[0].id).toBe("c"); // null createdOn sorts first (treated as -Infinity)
    expect(result.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
});
