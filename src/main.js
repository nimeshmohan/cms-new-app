import { buildDynamicForm, readFormValues, itemDisplayName } from "./field-renderer.js";
import {
  formatDate,
  filterItemsByQuery,
  computePagination,
  paginateItems,
  sortItems,
  toggleSortState,
} from "./items-helpers.js";
import accessPolicy from "./access-policy.json";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const SITE_ID_KEY = "webflow_selected_site_id";
const SITE_NAME_KEY = "webflow_selected_site_name";
const COLLECTIONS_CACHE_PREFIX = "webflow_cache_collections_";
const SCHEMA_CACHE_PREFIX = "webflow_cache_schema_";

let tokenForm, tokenInput, connectBtn, statusMsg;
let connectScreen, connectedScreen, sitesList, disconnectBtn;
let workspaceScreen, collectionsList, switchSiteBtn, disconnectBtn2;
let schemaTitle, schemaTabs, schemaStatus, itemsStatus;
let itemSearchInput, newItemBtn, itemsTbody;
let dynamicForm, formHeading, saveDraftBtn, publishBtn, formStatus;
let itemModal, modalCloseBtn;
let itemsPagination, itemsPageInfo, itemsPrevBtn, itemsNextBtn;
let sortableHeaders, itemsSelectAllCheckbox;
let bulkActionsBar, bulkSelectedCount, bulkPublishBtn, bulkClearBtn;

let currentSites = [];
let currentCollections = [];
let currentCollectionId = null;
let currentSchemaBundle = null;
let activeSchemaId = null;
let currentItems = [];
let displayedItems = [];
let editingItemId = null;
let itemsPage = 1;
let sortState = { key: null, direction: "asc" };
let selectedItemIds = new Set();
let formSnapshot = null;
const ITEMS_PER_PAGE = 50;
const itemsCache = new Map();

function setStatus(el, message, kind) {
  el.textContent = message || "";
  el.className = "status" + (kind ? ` ${kind}` : "");
}

function showScreen(screen) {
  for (const s of [connectScreen, connectedScreen, workspaceScreen]) {
    s.classList.add("hidden");
  }
  screen.classList.remove("hidden");
}

function renderSitePicker(sites) {
  sitesList.innerHTML = "";
  if (sites.length === 0) {
    sitesList.textContent = "Token is valid, but no sites are accessible with it.";
    return;
  }
  for (const site of sites) {
    const item = document.createElement("div");
    item.className = "site-item clickable";
    item.textContent = site.displayName + (site.shortName ? ` (${site.shortName})` : "");
    item.addEventListener("click", () => selectSite(site));
    sitesList.appendChild(item);
  }
}

async function selectSite(site) {
  localStorage.setItem(SITE_ID_KEY, site.id);
  localStorage.setItem(SITE_NAME_KEY, site.displayName);
  await loadCollections(site.id);
}

function cacheCollections(siteId, collections) {
  try {
    localStorage.setItem(
      COLLECTIONS_CACHE_PREFIX + siteId,
      JSON.stringify({ collections, cachedAt: new Date().toISOString() })
    );
  } catch (err) {
    console.error("Failed to cache collections:", err);
  }
}

function readCachedCollections(siteId) {
  try {
    const raw = localStorage.getItem(COLLECTIONS_CACHE_PREFIX + siteId);
    return raw ? JSON.parse(raw).collections : null;
  } catch {
    return null;
  }
}

const LOCKED_NAMES = new Set(
  (accessPolicy.lockedCollectionNames || []).map((n) => n.toLowerCase())
);

function isLocked(collection) {
  if (!collection) return false;
  return (
    LOCKED_NAMES.has((collection.displayName || "").toLowerCase()) ||
    LOCKED_NAMES.has((collection.slug || "").toLowerCase())
  );
}

function isLockedId(collectionId) {
  const collection = currentCollections.find((c) => c.id === collectionId);
  return isLocked(collection);
}

function renderSidebar(collections) {
  collectionsList.innerHTML = "";
  if (collections.length === 0) {
    collectionsList.textContent = "No collections in this site yet.";
    return;
  }
  for (const c of collections) {
    const item = document.createElement("div");
    item.className = "sidebar-item" + (c.id === currentCollectionId ? " active" : "");
    item.textContent = c.displayName;
    if (isLocked(c)) {
      const lock = document.createElement("span");
      lock.className = "lock-icon";
      lock.textContent = "🔒";
      lock.title = "Locked: view only";
      item.appendChild(lock);
    }
    item.addEventListener("click", () => selectCollection(c));
    collectionsList.appendChild(item);
  }
}

function cacheSchemaBundle(collectionId, bundle) {
  try {
    localStorage.setItem(SCHEMA_CACHE_PREFIX + collectionId, JSON.stringify(bundle));
  } catch (err) {
    console.error("Failed to cache schema:", err);
  }
}

function readCachedSchemaBundle(collectionId) {
  try {
    const raw = localStorage.getItem(SCHEMA_CACHE_PREFIX + collectionId);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function allSchemasInBundle(bundle) {
  return [bundle.main, ...bundle.referenced];
}

function renderSchemaTabs(bundle) {
  schemaTabs.innerHTML = "";
  const schemas = allSchemasInBundle(bundle);
  for (const schema of schemas) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "tab" + (schema.id === activeSchemaId ? " active" : "");
    tab.textContent =
      schema.id === bundle.main.id ? schema.displayName : `${schema.displayName} (linked)`;
    tab.addEventListener("click", () => {
      activeSchemaId = schema.id;
      renderSchemaTabs(bundle);
      resetEditingState();
      loadItems(schema.id);
    });
    schemaTabs.appendChild(tab);
  }
}

function activeSchema() {
  if (!currentSchemaBundle) return null;
  return allSchemasInBundle(currentSchemaBundle).find((s) => s.id === activeSchemaId) || null;
}

async function getItemsCached(collectionId, { forceRefresh = false } = {}) {
  if (!forceRefresh && itemsCache.has(collectionId)) {
    return itemsCache.get(collectionId);
  }
  const items = await invoke("get_items", { collectionId });
  itemsCache.set(collectionId, items);
  return items;
}

const LOCK_MESSAGE = "You don't have permission to edit or create items in this collection.";

function guardedOpenItemModal(item) {
  if (isLockedId(currentCollectionId)) {
    setStatus(itemsStatus, LOCK_MESSAGE, "error");
    return;
  }
  openItemModal(item);
}

function renderPaginationControls(totalItems) {
  const { page, start, end, hasPrev, hasNext } = computePagination(totalItems, itemsPage, ITEMS_PER_PAGE);
  itemsPage = page;

  if (totalItems === 0) {
    itemsPagination.classList.add("hidden");
    return;
  }

  itemsPagination.classList.remove("hidden");
  itemsPageInfo.textContent = `${start}–${end} of ${totalItems}`;
  itemsPrevBtn.disabled = !hasPrev;
  itemsNextBtn.disabled = !hasNext;
}

function updateSortIndicators() {
  for (const th of sortableHeaders) {
    const indicator = th.querySelector(".sort-indicator");
    if (th.dataset.sortKey === sortState.key) {
      indicator.textContent = sortState.direction === "asc" ? "▲" : "▼";
    } else {
      indicator.textContent = "";
    }
  }
}

function computeVisibleItems() {
  return sortItems(filterItemsByQuery(currentItems, itemSearchInput.value), sortState);
}

function updateBulkActionsBar() {
  if (isLockedId(currentCollectionId) || selectedItemIds.size === 0) {
    bulkActionsBar.classList.add("hidden");
    return;
  }
  bulkActionsBar.classList.remove("hidden");
  bulkSelectedCount.textContent = `${selectedItemIds.size} selected`;
}

function syncSelectionUI() {
  const rowCheckboxes = itemsTbody.querySelectorAll("[data-item-id]");
  for (const checkbox of rowCheckboxes) {
    checkbox.checked = selectedItemIds.has(checkbox.dataset.itemId);
  }

  if (rowCheckboxes.length === 0) {
    itemsSelectAllCheckbox.checked = false;
    itemsSelectAllCheckbox.indeterminate = false;
  } else {
    const selectedOnPage = Array.from(rowCheckboxes).filter((c) => c.checked).length;
    itemsSelectAllCheckbox.checked = selectedOnPage === rowCheckboxes.length;
    itemsSelectAllCheckbox.indeterminate = selectedOnPage > 0 && selectedOnPage < rowCheckboxes.length;
  }

  updateBulkActionsBar();
}

function renderItemsTable(items) {
  displayedItems = items;
  renderPaginationControls(items.length);
  updateSortIndicators();

  const tableWrap = itemsTbody.closest(".table-wrap");
  if (tableWrap) tableWrap.scrollTop = 0;

  itemsTbody.innerHTML = "";
  if (items.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 6;
    cell.textContent = "No items match.";
    cell.className = "empty-cell";
    row.appendChild(cell);
    itemsTbody.appendChild(row);
    syncSelectionUI();
    return;
  }

  const locked = isLockedId(currentCollectionId);
  const pageItems = paginateItems(items, itemsPage, ITEMS_PER_PAGE);
  for (const item of pageItems) {
    const row = document.createElement("tr");
    row.addEventListener("click", () => guardedOpenItemModal(item));

    const checkboxCell = document.createElement("td");
    checkboxCell.className = "checkbox-col";
    if (!locked) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.itemId = item.id;
      checkbox.checked = selectedItemIds.has(item.id);
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedItemIds.add(item.id);
        } else {
          selectedItemIds.delete(item.id);
        }
        syncSelectionUI();
      });
      checkboxCell.appendChild(checkbox);
    }
    row.appendChild(checkboxCell);

    const nameCell = document.createElement("td");
    nameCell.textContent = itemDisplayName(item);
    row.appendChild(nameCell);

    const publishedCell = document.createElement("td");
    if (item.isDraft) {
      publishedCell.textContent = "—";
    } else {
      const dot = document.createElement("span");
      dot.className = "publish-dot";
      publishedCell.appendChild(dot);
      publishedCell.appendChild(document.createTextNode(formatDate(item.lastPublished)));
    }
    row.appendChild(publishedCell);

    const statusCell = document.createElement("td");
    const statusSpan = document.createElement("span");
    statusSpan.className = "status-text " + (item.isDraft ? "draft" : "live");
    statusSpan.textContent = item.isDraft ? "Draft" : "Published";
    statusCell.appendChild(statusSpan);
    row.appendChild(statusCell);

    const createdCell = document.createElement("td");
    createdCell.textContent = formatDate(item.createdOn);
    row.appendChild(createdCell);

    const modifiedCell = document.createElement("td");
    modifiedCell.textContent = formatDate(item.lastUpdated);
    row.appendChild(modifiedCell);

    itemsTbody.appendChild(row);
  }

  syncSelectionUI();
}

function applyItemSearch({ resetPage = true } = {}) {
  if (resetPage) itemsPage = 1;
  renderItemsTable(computeVisibleItems());
}

function applySort(key) {
  sortState = toggleSortState(sortState, key);
  itemsPage = 1;
  renderItemsTable(computeVisibleItems());
}

function goToItemsPage(page) {
  itemsPage = page;
  renderItemsTable(displayedItems);
}

function handleSelectAllOnPage() {
  const rowCheckboxes = itemsTbody.querySelectorAll("[data-item-id]");
  const shouldSelect = itemsSelectAllCheckbox.checked;
  for (const checkbox of rowCheckboxes) {
    if (shouldSelect) {
      selectedItemIds.add(checkbox.dataset.itemId);
    } else {
      selectedItemIds.delete(checkbox.dataset.itemId);
    }
  }
  syncSelectionUI();
}

async function handleBulkPublish() {
  const schema = activeSchema();
  if (!schema || isLockedId(currentCollectionId) || selectedItemIds.size === 0) return;

  const itemIds = Array.from(selectedItemIds);
  setStatus(itemsStatus, `Publishing ${itemIds.length} item(s)...`, "loading");
  try {
    await invoke("publish_items", { collectionId: schema.id, itemIds });
    selectedItemIds.clear();
    setStatus(itemsStatus, `Published ${itemIds.length} item(s).`, "success");
    await loadItems(schema.id);
  } catch (err) {
    setStatus(itemsStatus, String(err), "error");
  }
}

function handleBulkClear() {
  selectedItemIds.clear();
  syncSelectionUI();
}

async function loadItems(collectionId) {
  itemsTbody.innerHTML = "";
  itemSearchInput.value = "";
  itemsPage = 1;
  sortState = { key: null, direction: "asc" };
  selectedItemIds.clear();
  setStatus(itemsStatus, "Loading items...", "loading");
  try {
    const items = await getItemsCached(collectionId, { forceRefresh: true });
    currentItems = items;
    setStatus(itemsStatus, items.length === 0 ? "" : `${items.length} item${items.length === 1 ? "" : "s"} loaded.`, "");
    renderItemsTable(items);
  } catch (err) {
    setStatus(itemsStatus, String(err), "error");
  }
}

async function pickFile({ multiple, images }) {
  return invoke("pick_files", { images: Boolean(images), multiple: Boolean(multiple) });
}

async function uploadAsset(filePath) {
  const siteId = localStorage.getItem(SITE_ID_KEY);
  return invoke("upload_asset", { siteId, filePath });
}

async function renderForm(schema, initialValues = {}) {
  dynamicForm.innerHTML = "";
  const form = await buildDynamicForm(schema, initialValues, {
    getReferencedItems: (collectionId) => getItemsCached(collectionId),
    pickFile,
    uploadAsset,
  });
  dynamicForm.appendChild(form);
}

function resetEditingState() {
  editingItemId = null;
}

function snapshotForm() {
  const schema = activeSchema();
  if (!schema) return null;
  return JSON.stringify(readFormValues(dynamicForm, schema));
}

function isFormDirty() {
  return formSnapshot !== null && snapshotForm() !== formSnapshot;
}

function confirmDiscardIfDirty() {
  return !isFormDirty() || window.confirm("You have unsaved changes. Discard them?");
}

async function openItemModal(item) {
  const schema = activeSchema();
  if (!schema) return;

  editingItemId = item ? item.id : null;
  formHeading.textContent = item ? `Edit: ${itemDisplayName(item)}` : "New item";
  setStatus(formStatus, "", "");

  await renderForm(schema, item ? item.fieldData : {});
  formSnapshot = snapshotForm();
  itemModal.showModal();
}

function closeItemModal() {
  formSnapshot = null;
  itemModal.close();
}

function requestCloseItemModal() {
  if (confirmDiscardIfDirty()) closeItemModal();
}

async function handleSaveItem(publish) {
  const schema = activeSchema();
  if (!schema) return;
  const fieldData = readFormValues(dynamicForm, schema);

  setStatus(formStatus, publish ? "Publishing..." : "Saving as draft...", "loading");
  try {
    let item;
    if (editingItemId) {
      item = await invoke("update_item", {
        collectionId: schema.id,
        itemId: editingItemId,
        fieldData,
        isDraft: !publish,
      });
    } else {
      item = await invoke("create_item", {
        collectionId: schema.id,
        fieldData,
        isDraft: !publish,
      });
    }
    if (publish) {
      await invoke("publish_item", { collectionId: schema.id, itemId: item.id });
    }
    setStatus(formStatus, publish ? "Published." : "Saved as draft.", "success");
    await loadItems(schema.id);
    setTimeout(closeItemModal, 500);
  } catch (err) {
    setStatus(formStatus, String(err), "error");
  }
}

async function selectCollection(collection) {
  currentCollectionId = collection.id;
  activeSchemaId = collection.id;
  schemaTitle.textContent = collection.displayName;
  schemaTabs.innerHTML = "";
  renderSidebar(currentCollections);

  const cached = readCachedSchemaBundle(collection.id);
  if (cached) {
    currentSchemaBundle = cached;
    renderSchemaTabs(cached);
    setStatus(schemaStatus, "Showing cached schema, refreshing...", "loading");
  } else {
    setStatus(schemaStatus, "Loading schema...", "loading");
  }

  resetEditingState();
  loadItems(collection.id);

  try {
    const bundle = await invoke("get_collection_schema_bundle", { collectionId: collection.id });
    currentSchemaBundle = bundle;
    setStatus(schemaStatus, "", "");
    renderSchemaTabs(bundle);
    cacheSchemaBundle(collection.id, bundle);
  } catch (err) {
    setStatus(schemaStatus, String(err), "error");
  }
}

async function loadCollections(siteId) {
  showScreen(workspaceScreen);

  const cached = readCachedCollections(siteId);
  if (cached) {
    currentCollections = cached;
    renderSidebar(cached);
    if (cached.length > 0) selectCollection(cached[0]);
  }

  try {
    const collections = await invoke("get_collections", { siteId });
    currentCollections = collections;
    renderSidebar(collections);
    cacheCollections(siteId, collections);
    if (collections.length > 0 && !currentCollectionId) {
      selectCollection(collections[0]);
    }
  } catch (err) {
    setStatus(schemaStatus, String(err), "error");
  }
}

function showConnected(sites) {
  currentSites = sites;
  const savedSiteId = localStorage.getItem(SITE_ID_KEY);

  if (sites.length === 1) {
    selectSite(sites[0]);
    return;
  }

  if (savedSiteId && sites.some((s) => s.id === savedSiteId)) {
    loadCollections(savedSiteId);
    return;
  }

  showScreen(connectedScreen);
  renderSitePicker(sites);
}

function showConnectScreen() {
  showScreen(connectScreen);
}

async function handleConnectSubmit(e) {
  e.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus(statusMsg, "Enter a token first.", "error");
    return;
  }

  connectBtn.disabled = true;
  connectBtn.textContent = "Connecting...";
  setStatus(statusMsg, "Validating token with Webflow...", "loading");

  try {
    const sites = await invoke("connect_with_token", { token });
    setStatus(statusMsg, "Connected. Token stored in OS keyring.", "success");
    tokenInput.value = "";
    showConnected(sites);
  } catch (err) {
    setStatus(statusMsg, String(err), "error");
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
  }
}

async function handleDisconnect() {
  try {
    await invoke("disconnect");
  } catch (err) {
    console.error(err);
  }
  localStorage.removeItem(SITE_ID_KEY);
  localStorage.removeItem(SITE_NAME_KEY);
  currentCollectionId = null;
  showConnectScreen();
  setStatus(statusMsg, "", "");
}

function handleSwitchSite() {
  localStorage.removeItem(SITE_ID_KEY);
  localStorage.removeItem(SITE_NAME_KEY);
  currentCollectionId = null;
  showScreen(connectedScreen);
  renderSitePicker(currentSites);
}

let rateLimitBanner;
let rateLimitTimer = null;

function showRateLimitBanner(waitSecs) {
  if (rateLimitTimer) clearInterval(rateLimitTimer);
  let remaining = Math.max(1, Math.round(waitSecs));

  const update = () => {
    rateLimitBanner.textContent = `Webflow rate limit hit, retrying in ${remaining}s...`;
  };
  update();
  rateLimitBanner.classList.add("visible");

  rateLimitTimer = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(rateLimitTimer);
      rateLimitTimer = null;
      rateLimitBanner.classList.remove("visible");
      return;
    }
    update();
  }, 1000);
}

async function tryAutoReconnect() {
  setStatus(statusMsg, "Checking for saved token...", "loading");
  try {
    const sites = await invoke("try_reconnect");
    setStatus(statusMsg, "", "");
    showConnected(sites);
  } catch {
    setStatus(statusMsg, "", "");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  rateLimitBanner = document.querySelector("#rate-limit-banner");
  listen("rate-limited", (event) => {
    showRateLimitBanner(event.payload.waitSecs);
  });

  connectScreen = document.querySelector("#connect-screen");
  connectedScreen = document.querySelector("#connected-screen");
  tokenForm = document.querySelector("#token-form");
  tokenInput = document.querySelector("#token-input");
  connectBtn = document.querySelector("#connect-btn");
  statusMsg = document.querySelector("#status-msg");
  sitesList = document.querySelector("#sites-list");
  disconnectBtn = document.querySelector("#disconnect-btn");

  workspaceScreen = document.querySelector("#workspace-screen");
  collectionsList = document.querySelector("#collections-list");
  switchSiteBtn = document.querySelector("#switch-site-btn");
  disconnectBtn2 = document.querySelector("#disconnect-btn-2");
  schemaTitle = document.querySelector("#schema-title");
  schemaTabs = document.querySelector("#schema-tabs");
  schemaStatus = document.querySelector("#schema-status");
  itemsStatus = document.querySelector("#items-status");
  itemSearchInput = document.querySelector("#item-search");
  newItemBtn = document.querySelector("#new-item-btn");
  itemsTbody = document.querySelector("#items-tbody");
  itemsPagination = document.querySelector("#items-pagination");
  itemsPageInfo = document.querySelector("#items-page-info");
  itemsPrevBtn = document.querySelector("#items-prev-btn");
  itemsNextBtn = document.querySelector("#items-next-btn");
  sortableHeaders = document.querySelectorAll("#items-table th[data-sort-key]");
  itemsSelectAllCheckbox = document.querySelector("#items-select-all");
  bulkActionsBar = document.querySelector("#bulk-actions-bar");
  bulkSelectedCount = document.querySelector("#bulk-selected-count");
  bulkPublishBtn = document.querySelector("#bulk-publish-btn");
  bulkClearBtn = document.querySelector("#bulk-clear-btn");

  dynamicForm = document.querySelector("#dynamic-form");
  formHeading = document.querySelector("#form-heading");
  saveDraftBtn = document.querySelector("#save-draft-btn");
  publishBtn = document.querySelector("#publish-btn");
  formStatus = document.querySelector("#form-status");
  itemModal = document.querySelector("#item-modal");
  modalCloseBtn = document.querySelector("#modal-close-btn");

  tokenForm.addEventListener("submit", handleConnectSubmit);
  disconnectBtn.addEventListener("click", handleDisconnect);
  disconnectBtn2.addEventListener("click", handleDisconnect);
  switchSiteBtn.addEventListener("click", handleSwitchSite);
  newItemBtn.addEventListener("click", () => guardedOpenItemModal(null));
  saveDraftBtn.addEventListener("click", () => handleSaveItem(false));
  publishBtn.addEventListener("click", () => handleSaveItem(true));
  modalCloseBtn.addEventListener("click", requestCloseItemModal);
  itemModal.addEventListener("cancel", (e) => {
    if (!confirmDiscardIfDirty()) e.preventDefault();
  });
  itemSearchInput.addEventListener("input", () => applyItemSearch());
  itemsPrevBtn.addEventListener("click", () => goToItemsPage(itemsPage - 1));
  itemsNextBtn.addEventListener("click", () => goToItemsPage(itemsPage + 1));
  for (const th of sortableHeaders) {
    th.addEventListener("click", () => applySort(th.dataset.sortKey));
  }
  itemsSelectAllCheckbox.addEventListener("change", handleSelectAllOnPage);
  bulkPublishBtn.addEventListener("click", handleBulkPublish);
  bulkClearBtn.addEventListener("click", handleBulkClear);

  tryAutoReconnect();
});
