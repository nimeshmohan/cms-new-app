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

function timeOrMinusInfinity(iso) {
  if (!iso) return -Infinity;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

export const SORT_ACCESSORS = {
  name: (item) => itemDisplayName(item).toLowerCase(),
  published: (item) => timeOrMinusInfinity(item.lastPublished),
  status: (item) => (item.isDraft ? "draft" : "published"),
  created: (item) => timeOrMinusInfinity(item.createdOn),
  modified: (item) => timeOrMinusInfinity(item.lastUpdated),
};

export function toggleSortState(current, key) {
  if (!current || current.key !== key) return { key, direction: "asc" };
  return { key, direction: current.direction === "asc" ? "desc" : "asc" };
}

export function sortItems(items, sortState) {
  const accessor = sortState && SORT_ACCESSORS[sortState.key];
  if (!accessor) return items;
  const sign = sortState.direction === "desc" ? -1 : 1;
  return [...items].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
}

export function relativeTimeFromNow(iso, now = Date.now()) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";

  const diffSec = Math.round(Math.max(0, now - t) / 1000);
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;

  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}
