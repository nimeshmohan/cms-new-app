import { itemDisplayName } from "./field-renderer.js";

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function filterItemsByQuery(items, query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return items;
  return items.filter((item) => itemDisplayName(item).toLowerCase().includes(trimmed));
}

export function computePagination(totalItems, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const start = totalItems === 0 ? 0 : (clampedPage - 1) * pageSize + 1;
  const end = Math.min(clampedPage * pageSize, totalItems);
  return {
    page: clampedPage,
    totalPages,
    start,
    end,
    hasPrev: clampedPage > 1,
    hasNext: clampedPage < totalPages,
  };
}

export function paginateItems(items, page, pageSize) {
  const { page: clampedPage } = computePagination(items.length, page, pageSize);
  const start = (clampedPage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
