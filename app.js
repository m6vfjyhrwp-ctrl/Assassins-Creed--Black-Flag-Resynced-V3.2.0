"use strict";
(() => {
  const locations = window.ACBF_LOCATIONS || [];
  const systems = window.ACBF_JACKDAW_SYSTEMS || [];
  const STORE = "acbf-companion-m3";
  const BACKUP_FORMAT = "animus-companion-backup";
  const APP_VERSION = "3.4.0";
  const STATUS_VALUES = ["not-started", "discovered", "attempted", "completed", "needs-recheck"];
  const MODE_COPY = {
    normal: "Balanced visibility. All stored locations are visible with full details.",
    explorer: "Reduces spoilers. Undiscovered names and detailed rewards are concealed where practical.",
    completionist: "Shows every stored objective, completion state, reward, and requirement."
  };
  const defaults = {
    version: window.ACBF_USER_DATA_VERSION || 3,
    settings: { mode: "normal", reduceMotion: false, onboardingComplete: false, includeCompletedSuggestions: false },
    filters: { categories: [], hideCompleted: false, favoritesOnly: false, incompleteOnly: false, discoveredOnly: false, verifiedOnly: false, legacyOnly: false, region: "all" },
    locations: {}, jackdaw: Object.fromEntries(systems.map(s => [s.id, 0])), log: [],
    route: { ids: [], source: "visible-incomplete", strategy: "nearest", manualIds: [] },
    ui: { activeTab: "map", selectedId: null, sheetSize: "half", searchAcrossAll: false, query: "", nextObjectiveId: null },
    mapView: { x: 0, y: 0, scale: 1 },
    playSession: { status: "idle", title: "", ids: [], completedIds: [], skippedIds: [], currentIndex: 0, estimatedMinutes: 0, startedAt: null, pausedAt: null },
    snapshots: [], pendingCorrections: [], lastBackupAt: null
  };

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
  const clone = value => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const label = value => String(value || "").replaceAll("-", " ").replace(/\b\w/g, c => c.toUpperCase());
  const byId = id => locations.find(location => location.id === id);
  const unique = list => [...new Set(list)];

  function safeLoad() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return clone(defaults);
      const saved = JSON.parse(raw);
      return {
        ...clone(defaults), ...saved,
        settings: { ...defaults.settings, ...(saved.settings || {}) },
        filters: { ...defaults.filters, ...(saved.filters || {}) },
        locations: saved.locations || {},
        jackdaw: { ...defaults.jackdaw, ...(saved.jackdaw || {}) },
        log: Array.isArray(saved.log) ? saved.log : [],
        route: { ...defaults.route, ...(saved.route || {}), ids: Array.isArray(saved.route?.ids) ? saved.route.ids.filter(byId) : [], manualIds: Array.isArray(saved.route?.manualIds) ? saved.route.manualIds.filter(byId) : [] },
        ui: { ...defaults.ui, ...(saved.ui || {}) },
        mapView: { ...defaults.mapView, ...(saved.mapView || {}) },
        playSession: { ...defaults.playSession, ...(saved.playSession || {}), ids: Array.isArray(saved.playSession?.ids) ? saved.playSession.ids.filter(byId) : [], completedIds: Array.isArray(saved.playSession?.completedIds) ? saved.playSession.completedIds : [], skippedIds: Array.isArray(saved.playSession?.skippedIds) ? saved.playSession.skippedIds : [] },
        snapshots: Array.isArray(saved.snapshots) ? saved.snapshots.slice(0, 3) : [],
        pendingCorrections: Array.isArray(saved.pendingCorrections) ? saved.pendingCorrections : []
      };
    } catch (error) {
      console.error("Save load failed", error);
      return clone(defaults);
    }
  }

  const data = safeLoad();
  let query = String(data.ui?.query || "");
  let logQuery = "";
  let selectedId = byId(data.ui?.selectedId) ? data.ui.selectedId : null;
  let searchAcrossAll = !!data.ui?.searchAcrossAll;
  let devTaps = 0;
  let browserOpen = false;
  let sheetTouchStart = null;
  let contextLocationId = null;
  let suppressMarkerClickUntil = 0;

  function save() {
    data.version = window.ACBF_USER_DATA_VERSION || 3;
    data.ui = { ...(data.ui || defaults.ui), selectedId, searchAcrossAll, query, sheetSize: $("detailSheet")?.dataset.size || data.ui?.sheetSize || "half" };
    const map = window.ACBF_MAP?.getState?.(); if (map) data.mapView = map;
    localStorage.setItem(STORE, JSON.stringify(data));
  }
  function stateFor(id) {
    return data.locations[id] ||= { status: "not-started", favorite: false, note: "", checklist: {} };
  }
  function toast(message, undoAction = null) {
    const element = $("toast");
    element.innerHTML = `<span>${esc(message)}</span>${undoAction ? '<button id="toastUndo" type="button">Undo</button>' : ''}`;
    element.hidden = false;
    element.setAttribute("role", "status");
    clearTimeout(element.timer);
    if (undoAction) $("toastUndo").onclick = () => { undoAction(); element.hidden = true; };
    const hide = () => element.timer = setTimeout(() => element.hidden = true, 3600);
    element.onmouseenter = () => clearTimeout(element.timer); element.onmouseleave = hide;
    element.ontouchstart = () => clearTimeout(element.timer); element.ontouchend = hide;
    hide();
  }
  function revealForMode(location) {
    return true; // Explorer Mode conceals details rather than removing objectives from the dataset.
  }
  function searchableText(location) {
    const state = stateFor(location.id);
    return [location.name, location.type, location.region, location.gameCoordinates, location.description, location.strategy, location.storyRequirements, location.verification, ...(location.rewards || []), ...(location.prerequisites || []), state.note, state.status, state.favorite ? "favorite" : ""].join(" ").toLowerCase();
  }

  /** One source of truth for map, directory, progress and route candidates. */
  function getVisibleLocations({ ignoreQuery = false, ignoreMode = false } = {}) {
    const f = data.filters;
    const normalizedQuery = query.trim().toLowerCase();
    return locations.filter(location => {
      const state = stateFor(location.id);
      if (!ignoreMode && !revealForMode(location)) return false;
      if (f.categories.length && !f.categories.includes(location.type)) return false;
      if (f.region !== "all" && location.region !== f.region) return false;
      if (f.hideCompleted && state.status === "completed") return false;
      if (f.favoritesOnly && !state.favorite) return false;
      if (f.incompleteOnly && state.status === "completed") return false;
      if (f.discoveredOnly && state.status === "not-started") return false;
      if (f.verifiedOnly && location.verification !== "Resynced verified") return false;
      if (f.legacyOnly && !String(location.verification).startsWith("Legacy")) return false;
      if (!ignoreQuery && normalizedQuery && !searchableText(location).includes(normalizedQuery)) return false;
      return true;
    });
  }
  function getDirectoryLocations() {
    if (searchAcrossAll && query.trim()) {
      const q = query.trim().toLowerCase();
      return locations.filter(location => searchableText(location).includes(q));
    }
    return getVisibleLocations();
  }
  function routeCandidates() {
    const visible = getVisibleLocations();
    if (data.route.source === "visible-all") return visible;
    if (data.route.source === "favorites") return visible.filter(location => stateFor(location.id).favorite);
    if (data.route.source === "manual") return data.route.manualIds.map(byId).filter(Boolean).filter(location => visible.some(v => v.id === location.id));
    return visible.filter(location => stateFor(location.id).status !== "completed");
  }
  function completion(list) {
    const total = list.length;
    const completed = list.filter(location => stateFor(location.id).status === "completed").length;
    return { total, completed, percent: total ? Math.round(completed / total * 100) : 0 };
  }
  function readiness() {
    const max = systems.reduce((sum, system) => sum + (system.max || 5), 0) || 1;
    return Math.round(systems.reduce((sum, system) => sum + Number(data.jackdaw[system.id] || 0), 0) / max * 100);
  }
  function locationReadiness(location) {
    const rec = location.recommendedTiers || {};
    const missing = Object.entries(rec).filter(([id, tier]) => Number(data.jackdaw[id] || 0) < Number(tier)).map(([id, tier]) => `${systems.find(s => s.id === id)?.name || label(id)} tier ${tier}`);
    return { missing, ready: !missing.length };
  }

  function filterDescription() {
    const f = data.filters;
    const parts = [];
    if (f.categories.length) parts.push(f.categories.map(label).join(" + "));
    if (f.region !== "all") parts.push(f.region);
    if (f.hideCompleted) parts.push("Hide completed");
    if (f.favoritesOnly) parts.push("Favorites");
    if (f.incompleteOnly) parts.push("Incomplete");
    if (f.discoveredOnly) parts.push("Discovered");
    if (f.verifiedOnly) parts.push("Verified");
    if (f.legacyOnly) parts.push("Legacy");
    return parts.length ? parts.join(" • ") : "All visible locations";
  }

  function renderOverview() {
    const visible = getVisibleLocations();
    const stats = completion(visible);
    $("visibleCompletion").textContent = `${stats.percent}%`;
    $("visibleCount").textContent = `${stats.total} visible`;
    $("mapContext").textContent = filterDescription();
    $("mapTitle").textContent = data.filters.categories.length === 1 ? label(data.filters.categories[0]) : "Caribbean Map";
    $("activeFilterSummary").innerHTML = filterDescription() === "All visible locations" ? "" : filterDescription().split(" • ").map(text => `<span class="summary-chip">${esc(text)}</span>`).join("");
  }

  function clusterLocations(list) {
    const mapState = window.ACBF_MAP?.getState?.() || { scale: 1 };
    const scale = mapState.scale || 1;
    const viewport = $("viewport");
    const width = Math.max(320, viewport?.clientWidth || 320);
    const height = Math.max(320, viewport?.clientHeight || 320);

    if (scale < 1.9 && list.length >= 18) {
      const cellSize = scale < 1.25 ? 9.5 : 6.5;
      const buckets = new Map();
      list.forEach(location => {
        const key = `${Math.floor(location.mapPosition.x / cellSize)}:${Math.floor(location.mapPosition.y / cellSize)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(location);
      });
      return [...buckets.values()].map(group => group.length === 1
        ? { kind: "location", location: group[0], x: group[0].mapPosition.x, y: group[0].mapPosition.y }
        : { kind: "cluster", group, x: group.reduce((sum, item) => sum + item.mapPosition.x, 0) / group.length, y: group.reduce((sum, item) => sum + item.mapPosition.y, 0) / group.length });
    }

    // At closer zoom levels, nearby pins are visually spread without changing stored coordinates.
    const thresholdPx = scale >= 4 ? 34 : scale >= 2.8 ? 42 : 48;
    const remaining = [...list];
    const groups = [];
    while (remaining.length) {
      const seed = remaining.shift();
      const group = [seed];
      for (let index = remaining.length - 1; index >= 0; index--) {
        const candidate = remaining[index];
        const dx = (candidate.mapPosition.x - seed.mapPosition.x) / 100 * width * scale;
        const dy = (candidate.mapPosition.y - seed.mapPosition.y) / 100 * height * scale;
        if (Math.hypot(dx, dy) < thresholdPx) group.push(remaining.splice(index, 1)[0]);
      }
      groups.push(group);
    }

    return groups.flatMap(group => {
      if (group.length === 1) return [{ kind: "location", location: group[0], x: group[0].mapPosition.x, y: group[0].mapPosition.y }];
      const radiusPx = Math.min(58, 23 + group.length * 3.4);
      return group.map((location, index) => {
        const angle = -Math.PI / 2 + index * (Math.PI * 2 / group.length);
        const ring = group.length > 8 && index >= 8 ? 1.55 : 1;
        const dxPercent = Math.cos(angle) * radiusPx * ring / (width * scale) * 100;
        const dyPercent = Math.sin(angle) * radiusPx * ring / (height * scale) * 100;
        return { kind: "location", location, x: location.mapPosition.x + dxPercent, y: location.mapPosition.y + dyPercent, displaced: true };
      });
    });
  }

  function markerClass(location) {
    const state = stateFor(location.id);
    return `marker marker-${location.type}${state.status === "completed" ? " completed" : ""}${state.favorite ? " favorite" : ""}${String(location.verification).startsWith("Legacy") ? " legacy" : ""}${selectedId === location.id ? " selected" : ""}${data.ui?.nextObjectiveId === location.id ? " next-objective" : ""}`;
  }
  function renderMarkers() {
    const host = $("markerLayer");
    host.innerHTML = "";
    const routeIndex = new Map(data.route.ids.map((id, i) => [id, i + 1]));
    clusterLocations(getVisibleLocations()).forEach(item => {
      if (item.kind === "cluster") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "marker cluster";
        button.style.left = `${item.x}%`; button.style.top = `${item.y}%`;
        button.textContent = item.group.length;
        button.setAttribute("aria-label", `${item.group.length} nearby locations`);
        button.onclick = event => {
          event.stopPropagation();
          const rect = $("viewport").getBoundingClientRect();
          window.ACBF_MAP?.focusPercent?.(item.x, item.y, Math.max(2.2, (window.ACBF_MAP?.getState?.().scale || 1) * 1.6), rect.width / 2, rect.height / 2);
          setTimeout(renderMarkers, 230);
        };
        host.appendChild(button);
        return;
      }
      const location = item.location;
      const button = document.createElement("button");
      button.type = "button";
      button.className = markerClass(location) + (routeIndex.has(location.id) ? " route-stop" : "");
      button.style.left = `${item.x ?? location.mapPosition.x}%`; button.style.top = `${item.y ?? location.mapPosition.y}%`;
      if (item.displaced) button.classList.add("spread-marker");
      button.dataset.id = location.id;
      if (routeIndex.has(location.id)) button.dataset.routeOrder = routeIndex.get(location.id);
      button.setAttribute("aria-label", data.settings.mode === "explorer" && !revealForMode(location) ? "Undiscovered location" : location.name);
      button.innerHTML = `<span>${location.icon || "•"}</span>`;
      let longPressTimer = 0;
      let startPoint = null;
      button.addEventListener("pointerdown", event => {
        event.stopPropagation();
        startPoint = { x: event.clientX, y: event.clientY };
        longPressTimer = window.setTimeout(() => {
          suppressMarkerClickUntil = Date.now() + 700;
          openMarkerContext(location.id, event.clientX, event.clientY);
          navigator.vibrate?.(18);
        }, 520);
      });
      button.addEventListener("pointermove", event => {
        if (startPoint && Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y) > 10) clearTimeout(longPressTimer);
      });
      ["pointerup", "pointercancel", "pointerleave"].forEach(type => button.addEventListener(type, () => clearTimeout(longPressTimer)));
      button.addEventListener("contextmenu", event => { event.preventDefault(); openMarkerContext(location.id, event.clientX, event.clientY); });
      button.addEventListener("click", event => { if (Date.now() < suppressMarkerClickUntil) return; event.stopPropagation(); closeMarkerContext(); openLocation(location.id); });
      host.appendChild(button);
    });
  }

  function closeMarkerContext() {
    const menu = $("markerContextMenu");
    if (!menu) return;
    menu.hidden = true;
    menu.innerHTML = "";
    contextLocationId = null;
  }

  function openMarkerContext(id, clientX, clientY) {
    const location = byId(id); if (!location) return;
    const state = stateFor(id);
    contextLocationId = id;
    const menu = $("markerContextMenu");
    menu.innerHTML = `<strong>${esc(location.name)}</strong><button data-context-action="favorite">${state.favorite ? "★ Remove favorite" : "☆ Favorite"}</button><button data-context-action="complete">${state.status === "completed" ? "↶ Mark incomplete" : "✓ Mark complete"}</button><button data-context-action="route">${data.route.ids.includes(id) ? "Remove from route" : "⌁ Route here"}</button><button data-context-action="notes">✎ Notes</button><button data-context-action="screenshot">▧ Add screenshot</button>`;
    menu.hidden = false;
    const pad = 12;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(pad, Math.min(window.innerWidth - rect.width - pad, clientX - rect.width / 2))}px`;
    menu.style.top = `${Math.max(pad + 44, Math.min(window.innerHeight - rect.height - pad, clientY - rect.height - 12))}px`;
    menu.querySelectorAll("[data-context-action]").forEach(button => button.onclick = () => {
      const action = button.dataset.contextAction;
      if (action === "favorite") { const previous = state.favorite; state.favorite = !state.favorite; setTimeout(() => toast(state.favorite ? "Added to favorites" : "Removed from favorites", () => { state.favorite = previous; save(); renderAll(); }), 0); }
      if (action === "complete") { const previous = state.status; state.status = state.status === "completed" ? "not-started" : "completed"; syncActiveSessionCompletion(id, state.status === "completed"); setTimeout(() => toast(state.status === "completed" ? "Marked complete" : "Marked incomplete", () => { state.status = previous; syncActiveSessionCompletion(id, previous === "completed"); save(); renderAll(); }), 0); }
      if (action === "route") data.route.ids = data.route.ids.includes(id) ? data.route.ids.filter(item => item !== id) : [...data.route.ids, id];
      if (action === "notes") { closeMarkerContext(); openLocation(id); setTimeout(() => $("noteField")?.focus(), 260); return; }
      if (action === "screenshot") { $("contextScreenshotInput").click(); return; }
      save(); closeMarkerContext(); renderAll();
    });
  }

  function nearestToMapCenter() {
    const candidates = getVisibleLocations().filter(location => stateFor(location.id).status !== "completed");
    if (!candidates.length) return toast("No incomplete visible locations");
    const map = window.ACBF_MAP?.getState?.() || { x: 0, y: 0, scale: 1 };
    const viewport = $("viewport");
    const centerX = ((viewport.clientWidth / 2 - map.x) / map.scale) / viewport.clientWidth * 100;
    const centerY = ((viewport.clientHeight / 2 - map.y) / map.scale) / viewport.clientHeight * 100;
    const nearest = [...candidates].sort((a, b) => Math.hypot(a.mapPosition.x - centerX, a.mapPosition.y - centerY) - Math.hypot(b.mapPosition.x - centerX, b.mapPosition.y - centerY))[0];
    if (!data.route.ids.includes(nearest.id)) data.route.ids = [nearest.id, ...data.route.ids.filter(id => id !== nearest.id)];
    save(); openLocation(nearest.id, true); drawRoute(); toast(`Nearest visible objective: ${nearest.name}`);
  }

  function renderIslandExplorer() {
    const host = $("islandExplorer");
    const region = data.filters.region;
    if (!host || region === "all") { if (host) host.hidden = true; return; }
    const list = locations.filter(location => location.region === region);
    const stats = completion(list);
    const remaining = list.filter(location => stateFor(location.id).status !== "completed");
    const counts = Object.entries(remaining.reduce((acc, location) => { acc[location.type] = (acc[location.type] || 0) + 1; return acc; }, {})).sort((a,b)=>b[1]-a[1]).slice(0,4);
    host.hidden = false;
    host.innerHTML = `<div><span>Island Explorer</span><strong>${esc(region)}</strong><small>${stats.completed}/${stats.total} complete • ${stats.percent}%</small></div><div class="island-progress"><span style="width:${stats.percent}%"></span></div><p>${counts.length ? counts.map(([type,count]) => `${count} ${label(type)}`).join(" • ") : "Everything complete"}</p><button id="routeRegionRemaining" class="primary" ${remaining.length ? "" : "disabled"}>Route remaining (${remaining.length})</button>`;
    $("routeRegionRemaining")?.addEventListener("click", () => { data.route.ids = nearestRoute(remaining).map(location => location.id); save(); drawRoute(); renderMarkers(); toast(`Route built for ${region}`); });
  }

  function renderCategoryControls() {
    const types = unique(locations.map(location => location.type)).sort();
    const active = data.filters.categories;
    const chipHtml = ["all", ...types].map(type => `<button class="filter-chip ${type === "all" ? (!active.length ? "active" : "") : (active.includes(type) ? "active" : "")}" data-category="${type}">${type === "all" ? "All" : label(type)}</button>`).join("");
    $("locationFilters").innerHTML = chipHtml;
    $("drawerCategoryFilters").innerHTML = types.map(type => `<button class="${active.includes(type) ? "active" : ""}" data-drawer-category="${type}">${label(type)}</button>`).join("");
    document.querySelectorAll("[data-category]").forEach(button => button.onclick = () => {
      const type = button.dataset.category;
      data.filters.categories = type === "all" ? [] : [type];
      save(); renderAll();
    });
    document.querySelectorAll("[data-drawer-category]").forEach(button => button.onclick = () => {
      const type = button.dataset.drawerCategory;
      data.filters.categories = data.filters.categories.includes(type) ? data.filters.categories.filter(value => value !== type) : [...data.filters.categories, type];
      button.classList.toggle("active", data.filters.categories.includes(type));
    });
  }
  function renderQuickFilters() {
    const options = [
      ["hideCompleted", "Hide completed"], ["favoritesOnly", "Favorites"], ["incompleteOnly", "Incomplete"], ["verifiedOnly", "Verified"]
    ];
    $("quickFilters").innerHTML = options.map(([key, text]) => `<button class="filter-chip ${data.filters[key] ? "active" : ""}" data-quick-filter="${key}">${text}</button>`).join("");
    document.querySelectorAll("[data-quick-filter]").forEach(button => button.onclick = () => {
      const key = button.dataset.quickFilter;
      data.filters[key] = !data.filters[key];
      if (key === "verifiedOnly" && data.filters[key]) data.filters.legacyOnly = false;
      save(); renderAll();
    });
  }
  function renderRegionFilter() {
    const regions = unique(locations.map(location => location.region).filter(Boolean)).sort();
    $("regionFilter").innerHTML = `<option value="all">All regions</option>${regions.map(region => `<option value="${esc(region)}" ${data.filters.region === region ? "selected" : ""}>${esc(region)}</option>`).join("")}`;
  }
  function renderDirectory() {
    const rows = getDirectoryLocations();
    $("locationCount").textContent = `${rows.length} shown • ${locations.length} stored`;
    $("locationDirectory").innerHTML = rows.length ? rows.map(location => {
      const state = stateFor(location.id);
      const hiddenName = data.settings.mode === "explorer" && !revealForMode(location);
      return `<button class="location-row" data-open-location="${location.id}"><span>${location.icon || "•"}</span><span><b>${hiddenName ? "Undiscovered location" : esc(location.name)}</b><small>${label(location.type)} • ${esc(location.region)} • ${label(state.status)}</small></span><span class="coord">${hiddenName ? "—" : esc(location.gameCoordinates)}</span></button>`;
    }).join("") : `<p class="empty-state">No locations match the active dataset.</p>`;
    document.querySelectorAll("[data-open-location]").forEach(button => button.onclick = () => openLocation(button.dataset.openLocation, true));
  }

  function openLocation(id, focus = false) {
    const location = byId(id); if (!location) return;
    selectedId = id; data.ui.selectedId = id; save();
    const state = stateFor(id);
    const explorerHidden = data.settings.mode === "explorer" && state.status === "not-started";
    const ready = locationReadiness(location);
    const inRoute = data.route.ids.includes(id);
    const manual = data.route.manualIds.includes(id);
    $("detailContent").className = "detail-content";
    $("detailContent").innerHTML = `
      <div class="detail-title-row"><div><h2>${explorerHidden ? "Undiscovered location" : esc(location.name)}</h2><span class="verification">${esc(location.verification)}</span></div><button id="closeSheetButton" class="icon-button">✕</button></div>
      <div class="detail-grid">
        <div class="detail-block"><span>Category</span><strong>${label(location.type)}</strong></div>
        <div class="detail-block"><span>Coordinates</span><strong>${explorerHidden ? "Hidden until discovered" : esc(location.gameCoordinates)}</strong></div>
        <div class="detail-block"><span>Region</span><strong>${esc(location.region)}</strong></div>
        <div class="detail-block"><span>Readiness</span><strong>${ready.ready ? "Ready" : `${ready.missing.length} upgrade warning${ready.missing.length === 1 ? "" : "s"}`}</strong></div>
      </div>
      <div class="detail-actions">
        <label>Status<select id="statusSelect">${STATUS_VALUES.map(status => `<option value="${status}" ${state.status === status ? "selected" : ""}>${label(status)}</option>`).join("")}</select></label>
        <label class="switch"><input id="favoriteToggle" type="checkbox" ${state.favorite ? "checked" : ""}><span>Favorite</span></label>
        <button id="routeToggle" class="${inRoute ? "danger" : "primary"}">${inRoute ? "Remove from route" : "Add to route"}</button>
        <button id="manualToggle">${manual ? "Remove manual selection" : "Select for manual route"}</button>
      </div>
      ${explorerHidden ? `<p class="empty-state">Explorer Mode hides detailed rewards and directions until this location is discovered.</p>` : `
        <section class="detail-block"><span>Description</span><p>${esc(location.description || "No verified description stored.")}</p></section>
        <section class="detail-block"><span>Rewards</span><p>${(location.rewards || []).length ? location.rewards.map(esc).join(" • ") : "No verified reward stored."}</p></section>
        <section class="detail-block"><span>Requirements</span><p>${esc(location.storyRequirements || (location.prerequisites || []).join(" • ") || "No verified requirement stored.")}</p></section>
        <section class="detail-block"><span>Directions / strategy</span><p>${esc(location.strategy || "No verified walkthrough stored.")}</p></section>
        ${ready.missing.length ? `<section class="detail-block"><span>Jackdaw recommendation</span><p>${esc(ready.missing.join(" • "))}</p></section>` : ""}
      `}
      <h3>Checklist</h3><div class="checklist">${(location.checklist || []).map((item, index) => `<label><input type="checkbox" data-check="${index}" ${state.checklist[index] ? "checked" : ""}> ${esc(item)}</label>`).join("") || `<p class="empty-state">No checklist stored.</p>`}</div>
      ${state.screenshot ? `<h3>Reference Screenshot</h3><div class="saved-screenshot"><img src="${state.screenshot}" alt="Saved reference for ${esc(location.name)}"><button id="removeScreenshot" class="danger">Remove screenshot</button></div>` : ""}
      <h3>Captain’s Notes</h3><textarea id="noteField" rows="4" placeholder="Your private notes…">${esc(state.note)}</textarea>
    `;
    $("closeSheetButton").onclick = closeSheet;
    $("statusSelect").onchange = event => {
      const previous = state.status;
      state.status = event.target.value;
      syncActiveSessionCompletion(id, state.status === "completed");
      if (state.status === "completed" && previous !== "completed") data.log.unshift({ id: crypto.randomUUID?.() || Date.now(), date: new Date().toISOString(), title: `Completed: ${location.name}`, body: `${location.region} • ${location.gameCoordinates}`, locationId: location.id });
      save(); renderAll(); openLocation(id); toast(state.status === "completed" ? "Marked complete" : "Status updated", () => { state.status=previous; syncActiveSessionCompletion(id, previous === "completed"); save(); renderAll(); openLocation(id); });
    };
    $("favoriteToggle").onchange = event => { state.favorite = event.target.checked; save(); renderAll(); };
    $("noteField").oninput = event => { state.note = event.target.value; save(); };
    $("removeScreenshot")?.addEventListener("click", () => { delete state.screenshot; save(); openLocation(id); });
    document.querySelectorAll("[data-check]").forEach(control => control.onchange = event => { state.checklist[event.target.dataset.check] = event.target.checked; save(); renderProgress(); });
    $("routeToggle").onclick = () => {
      data.route.ids = inRoute ? data.route.ids.filter(routeId => routeId !== id) : [...data.route.ids, id];
      save(); renderAll(); openLocation(id); drawRoute();
    };
    $("manualToggle").onclick = () => {
      data.route.manualIds = manual ? data.route.manualIds.filter(routeId => routeId !== id) : [...data.route.manualIds, id];
      save(); openLocation(id); renderRouteCandidateSummary();
    };
    $("sheetBackdrop").hidden = false;
    requestAnimationFrame(() => { $("sheetBackdrop").classList.add("show"); $("detailSheet").classList.add("open"); });
    if (focus) focusLocation(location);
    renderMarkers(); setTimeout(addCorrectionButton, 0);
  }
  function focusLocation(location) {
    const rect = $("viewport").getBoundingClientRect();
    window.ACBF_MAP?.focusPercent?.(location.mapPosition.x, location.mapPosition.y, Math.max(2.35, window.ACBF_MAP?.getState?.().scale || 1), rect.width / 2, rect.height * .36);
    setTimeout(renderMarkers, 230);
  }
  function closeSheet() {
    $("sheetBackdrop").classList.remove("show"); $("detailSheet").classList.remove("open");
    selectedId = null; data.ui.selectedId = null; save(); renderMarkers();
    setTimeout(() => $("sheetBackdrop").hidden = true, 240);
  }
  function cycleSheet() {
    const order = ["compact", "half", "full"];
    const current = $("detailSheet").dataset.size || "half";
    $("detailSheet").dataset.size = order[(order.indexOf(current) + 1) % order.length]; save();
  }

  function nearestRoute(input) {
    if (input.length < 2) return [...input];
    const remaining = [...input];
    const route = [remaining.shift()];
    while (remaining.length) {
      const current = route[route.length - 1];
      remaining.sort((a, b) => Math.hypot(a.mapPosition.x - current.mapPosition.x, a.mapPosition.y - current.mapPosition.y) - Math.hypot(b.mapPosition.x - current.mapPosition.x, b.mapPosition.y - current.mapPosition.y));
      route.push(remaining.shift());
    }
    return route;
  }
  function routeDistance(route) {
    return route.slice(1).reduce((sum, location, index) => sum + Math.hypot(location.mapPosition.x - route[index].mapPosition.x, location.mapPosition.y - route[index].mapPosition.y), 0);
  }
  function improveRoute2Opt(route) {
    let best = [...route], improved = true, passes = 0;
    while (improved && passes++ < 3 && best.length < 120) {
      improved = false;
      for (let i = 1; i < best.length - 2; i++) for (let j = i + 1; j < best.length - 1; j++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        if (routeDistance(candidate) + .001 < routeDistance(best)) { best = candidate; improved = true; }
      }
    }
    return best;
  }
  function buildRoute() {
    let candidates = routeCandidates();
    if (!candidates.length) return toast("No visible locations match this route source");
    if (data.route.strategy === "custom") {
      const order = data.route.source === "manual" ? data.route.manualIds : data.route.ids;
      const index = new Map(order.map((id, i) => [id, i]));
      candidates = [...candidates].sort((a, b) => (index.get(a.id) ?? 99999) - (index.get(b.id) ?? 99999));
    } else {
      candidates = nearestRoute(candidates);
      if (data.route.strategy === "shortest") candidates = improveRoute2Opt(candidates);
    }
    data.route.ids = candidates.map(location => location.id);
    save(); drawRoute(); renderAll(); closeDrawer("routeDrawer"); toast(`Route built with ${candidates.length} visible stop${candidates.length === 1 ? "" : "s"}`);
  }
  function drawRoute() {
    const visibleIds = new Set(getVisibleLocations().map(location => location.id));
    const route = data.route.ids.map(byId).filter(Boolean).filter(location => visibleIds.has(location.id));
    if (route.length !== data.route.ids.length) {
      data.route.ids = route.map(location => location.id);
      save();
    }
    const routeLayer = $("routeLayer");
    if (route.length < 2) routeLayer.innerHTML = "";
    else routeLayer.innerHTML = `<polyline class="route-line" points="${route.map(location => `${location.mapPosition.x * 10},${location.mapPosition.y * 10}`).join(" ")}"></polyline>`;
    if (!route.length) { $("routeSummary").hidden = true; $("routeSummary").innerHTML = ""; return; }
    const distance = routeDistance(route);
    const warnings = unique(route.flatMap(location => locationReadiness(location).missing));
    $("routeSummary").hidden = false;
    $("routeSummary").innerHTML = `<strong>${route.length} visible route stop${route.length === 1 ? "" : "s"}</strong><small> • ${distance.toFixed(1)} map units • estimated ${Math.max(5, Math.round(distance * 1.6))} min sailing effort</small>${warnings.length ? `<p>⚠ Upgrade warnings: ${esc(warnings.slice(0, 4).join(" • "))}</p>` : ""}<ol>${route.map(location => `<li><button data-route-open="${location.id}">${esc(location.name)} <small>${esc(location.gameCoordinates)}</small></button></li>`).join("")}</ol><button id="reverseRouteInline">Reverse</button><button id="clearRouteInline">Clear route</button>`;
    document.querySelectorAll("[data-route-open]").forEach(button => button.onclick = () => openLocation(button.dataset.routeOpen, true));
    $("reverseRouteInline").onclick = reverseRoute;
    $("clearRouteInline").onclick = clearRoute;
  }
  function reverseRoute() { data.route.ids.reverse(); save(); drawRoute(); renderMarkers(); }
  function clearRoute() { data.route.ids = []; save(); drawRoute(); renderMarkers(); toast("Route cleared"); }
  function renderRouteCandidateSummary() {
    const candidates = routeCandidates();
    $("routeCandidateSummary").innerHTML = `<strong>${candidates.length} eligible visible location${candidates.length === 1 ? "" : "s"}</strong><p>Hidden markers are excluded automatically. ${data.route.source === "manual" ? `${data.route.manualIds.length} manually selected.` : ""}</p>`;
  }

  function renderJackdaw() {
    $("jackdawControls").innerHTML = systems.map(system => `<label class="upgrade-control"><span>${esc(system.name)}</span><select data-system="${system.id}">${Array.from({ length: (system.max || 5) + 1 }, (_, tier) => `<option value="${tier}" ${Number(data.jackdaw[system.id]) === tier ? "selected" : ""}>Tier ${tier}</option>`).join("")}</select></label>`).join("");
    document.querySelectorAll("[data-system]").forEach(select => select.onchange = event => { data.jackdaw[event.target.dataset.system] = Number(event.target.value); save(); renderJackdaw(); });
    const score = readiness();
    $("overallReadiness").textContent = `${score}%`; $("overallReadinessBar").style.width = `${score}%`;
    $("readinessMessage").textContent = score >= 85 ? "Prepared for the hardest naval encounters." : score >= 55 ? "Strong mid-game readiness; elite encounters may remain difficult." : "Prioritize hull, broadside cannons, mortar, and heavy shot.";
    const difficult = locations.filter(location => ["legendary-ship", "fort", "dive-location", "shipwreck"].includes(location.type)).map(location => ({ location, result: locationReadiness(location) })).filter(item => item.result.missing.length).slice(0, 6);
    $("upgradeSuggestions").innerHTML = difficult.length ? `<h3>Suggested upgrades</h3>${difficult.map(item => `<p><b>${esc(item.location.name)}</b><br><small>${esc(item.result.missing.join(", "))}</small></p>`).join("")}` : `<p class="empty-state">No stored readiness warnings.</p>`;
  }

  function progressGroup(key, source = locations) {
    const groups = {};
    source.forEach(location => (groups[location[key]] ||= []).push(location));
    return Object.entries(groups).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([name, list]) => {
      const stats = completion(list);
      return `<div class="progress-group"><div><span>${esc(key === "type" ? label(name) : name)}</span><strong>${stats.completed}/${stats.total}</strong></div><div class="progress-track"><span style="width:${stats.percent}%"></span></div></div>`;
    }).join("");
  }
  function renderProgress() {
    const overall = completion(locations);
    const visible = getVisibleLocations();
    const visibleStats = completion(visible);
    const found = locations.filter(location => stateFor(location.id).status !== "not-started").length;
    const favorites = locations.filter(location => stateFor(location.id).favorite).length;
    $("progressMetrics").innerHTML = `<div class="metric"><span>Completed</span><strong>${overall.completed}/${overall.total}</strong></div><div class="metric"><span>Discovered</span><strong>${found}</strong></div><div class="metric"><span>Favorites</span><strong>${favorites}</strong></div><div class="metric"><span>Overall</span><strong>${overall.percent}%</strong></div>`;
    $("visibleProgress").innerHTML = `<div class="progress-group"><div><span>${esc(filterDescription())}</span><strong>${visibleStats.completed}/${visibleStats.total} • ${visibleStats.percent}%</strong></div><div class="progress-track"><span style="width:${visibleStats.percent}%"></span></div></div>`;
    $("categoryProgress").innerHTML = progressGroup("type"); $("regionProgress").innerHTML = progressGroup("region");
    const incomplete = visible.filter(location => stateFor(location.id).status !== "completed");
    $("locationProgressList").innerHTML = incomplete.slice(0, 150).map(location => `<button class="progress-row" data-progress-open="${location.id}"><span>${location.icon || "•"}</span><span><b>${esc(location.name)}</b><small>${label(stateFor(location.id).status)} • ${esc(location.region)}</small></span><span>${esc(location.gameCoordinates)}</span></button>`).join("") || `<p class="empty-state">Every location in the active dataset is complete.</p>`;
    document.querySelectorAll("[data-progress-open]").forEach(button => button.onclick = () => { switchTab("map"); openLocation(button.dataset.progressOpen, true); });
  }

  function renderLog() {
    const q = logQuery.trim().toLowerCase();
    const entries = data.log.filter(entry => !q || [entry.title, entry.body].join(" ").toLowerCase().includes(q));
    $("logEntries").innerHTML = entries.length ? entries.map(entry => `<article class="log-entry" data-log="${entry.id}"><div><strong>${esc(entry.title)}</strong><time>${new Date(entry.date).toLocaleString()}</time></div><textarea data-log-body="${entry.id}" rows="2">${esc(entry.body)}</textarea><div class="log-actions">${entry.locationId ? `<button data-log-location="${entry.locationId}">Open location</button>` : ""}<button data-save-log="${entry.id}">Save</button><button data-delete-log="${entry.id}" class="danger">Delete</button></div></article>`).join("") : `<p class="empty-state">No matching entries.</p>`;
    document.querySelectorAll("[data-save-log]").forEach(button => button.onclick = () => { const entry = data.log.find(item => String(item.id) === button.dataset.saveLog); entry.body = document.querySelector(`[data-log-body="${CSS.escape(String(entry.id))}"]`).value; save(); toast("Log entry saved"); });
    document.querySelectorAll("[data-delete-log]").forEach(button => button.onclick = () => { if (confirm("Delete this log entry?")) { data.log = data.log.filter(item => String(item.id) !== button.dataset.deleteLog); save(); renderLog(); } });
    document.querySelectorAll("[data-log-location]").forEach(button => button.onclick = () => { switchTab("map"); openLocation(button.dataset.logLocation, true); });
  }

  function mapCenterPercent() {
    const map = window.ACBF_MAP?.getState?.() || { x: 0, y: 0, scale: 1 };
    const viewport = $("viewport");
    return { x: ((viewport.clientWidth / 2 - map.x) / map.scale) / viewport.clientWidth * 100, y: ((viewport.clientHeight / 2 - map.y) / map.scale) / viewport.clientHeight * 100 };
  }
  function chooseNextObjective(skipCurrent = false) {
    const incomplete = locations.filter(location => data.settings.includeCompletedSuggestions || stateFor(location.id).status !== "completed");
    const center = mapCenterPercent();
    const nearest = list => [...list].sort((a,b)=>Math.hypot(a.mapPosition.x-center.x,a.mapPosition.y-center.y)-Math.hypot(b.mapPosition.x-center.x,b.mapPosition.y-center.y))[0];
    const routeNext = data.route.ids.map(byId).find(location => location && (data.settings.includeCompletedSuggestions || stateFor(location.id).status !== "completed"));
    const pinned = byId(data.ui?.pinnedId);
    const regionList = data.filters.region !== "all" ? incomplete.filter(location => location.region === data.filters.region) : [];
    const visible = getVisibleLocations().filter(location => incomplete.includes(location));
    const favorite = incomplete.filter(location => stateFor(location.id).favorite);
    let next = routeNext || pinned || nearest(regionList) || nearest(visible) || nearest(favorite) || nearest(incomplete);
    if (skipCurrent && next?.id === data.ui.nextObjectiveId) next = nearest(incomplete.filter(location => location.id !== next.id));
    data.ui.nextObjectiveId = next?.id || null; save(); renderNextObjective(); renderMarkers(); return next;
  }
  function renderNextObjective() {
    const host = $("nextObjectiveCard"); if (!host) return;
    const location = byId(data.ui?.nextObjectiveId) || chooseNextObjective();
    if (!location) { host.innerHTML = '<span>No incomplete objectives remain.</span>'; return; }
    const routePosition = data.route.ids.indexOf(location.id);
    host.innerHTML = `<div><small>NEXT OBJECTIVE</small><strong>${esc(location.name)}</strong><span>${esc(location.region)} • ${esc(location.gameCoordinates)} • ${esc(location.verification)}</span>${routePosition >= 0 ? `<em>Route stop ${routePosition+1} • ${Math.max(0,data.route.ids.length-routePosition-1)} remaining</em>` : ''}</div><div><button id="openNextObjective" class="primary">Open</button><button id="skipNextObjective">Choose another</button></div>`;
    $("openNextObjective").onclick = () => openLocation(location.id, true);
    $("skipNextObjective").onclick = () => { chooseNextObjective(true); toast("Next objective updated"); };
  }
  function snapshot(reason="Manual snapshot") {
    const copy = clone(data); delete copy.snapshots;
    data.snapshots = [{ id: Date.now(), date: new Date().toISOString(), reason, data: copy }, ...(data.snapshots||[])].slice(0,3); save(); renderBackupCenter();
  }
  function backupSummary() {
    return { completed: locations.filter(l=>stateFor(l.id).status==="completed").length, favorites: locations.filter(l=>stateFor(l.id).favorite).length, notes: locations.filter(l=>stateFor(l.id).note).length, routeStops: data.route.ids.length, sessionStops: data.playSession.ids.length };
  }
  function renderBackupCenter() {
    const host=$("backupCenter"); if(!host)return; const summary=backupSummary(); const latest=data.snapshots?.[0];
    host.innerHTML=`<h2>Backup Center</h2><div class="metric-grid"><div class="metric"><span>Completed</span><strong>${summary.completed}</strong></div><div class="metric"><span>Favorites</span><strong>${summary.favorites}</strong></div><div class="metric"><span>Notes</span><strong>${summary.notes}</strong></div><div class="metric"><span>Route stops</span><strong>${summary.routeStops}</strong></div></div><p>Last export: ${data.lastBackupAt ? new Date(data.lastBackupAt).toLocaleString() : "Never"}<br>Latest recovery snapshot: ${latest ? new Date(latest.date).toLocaleString()+" — "+esc(latest.reason) : "None"}</p><div class="button-grid"><button id="createSnapshot">Create recovery snapshot</button><button id="restoreSnapshot" ${latest?'':'disabled'}>Restore latest snapshot</button></div>`;
    $("createSnapshot").onclick=()=>{snapshot();toast("Recovery snapshot created")};
    $("restoreSnapshot").onclick=()=>{if(!latest||!confirm("Restore the latest recovery snapshot? Current data will be snapshotted first."))return; snapshot("Before snapshot restore"); const restored=clone(latest.data); Object.keys(data).forEach(k=>delete data[k]); Object.assign(data,restored); save(); renderAll(); toast("Recovery snapshot restored")};
  }
  function sessionCandidates() {
    const region=$("sessionRegion")?.value||"all", minutes=Number($("sessionMinutes")?.value||30), maxStops=Math.max(1,Number($("sessionMaxStops")?.value||8));
    const categories=[...document.querySelectorAll('[data-session-category]:checked')].map(x=>x.value);
    let list=locations.filter(l=>stateFor(l.id).status!=="completed" && (region==="all"||l.region===region) && (!categories.length||categories.includes(l.type)));
    if($("sessionFavorites")?.checked) list=list.filter(l=>stateFor(l.id).favorite);
    const perStop=$("sessionShip")?.checked?6:8; const limit=Math.min(maxStops,Math.max(1,Math.floor(minutes/perStop)));
    return { list: nearestRoute(list).slice(0,limit), minutes };
  }
  function planSession() { const {list,minutes}=sessionCandidates(); data.playSession={...defaults.playSession,status:"planned",title:`${minutes}-minute Caribbean run`,ids:list.map(l=>l.id),estimatedMinutes:minutes,currentIndex:0,completedIds:[],skippedIds:[]}; save(); renderPlaySession(); toast(`Session planned with ${list.length} stops`); }
  function syncActiveSessionCompletion(id, completed) {
    const s=data.playSession; if(!s?.ids?.includes(id)) return;
    s.completedIds = (s.completedIds||[]).filter(item=>item!==id);
    if(completed) s.completedIds.push(id);
    if(s.status==="active" && s.completedIds.length + (s.skippedIds||[]).length >= s.ids.length) s.status="completed";
  }
  function renderPlaySession() {
    const host=$("playSessionPanel"); if(!host)return; const s=data.playSession; const regions=unique(locations.map(l=>l.region)).sort(); const types=unique(locations.map(l=>l.type)).sort();
    const remaining=s.ids.filter(id=>!s.completedIds.includes(id)&&!s.skippedIds.includes(id)); const current=byId(remaining[0]);
    host.innerHTML=`<h2>Play Session</h2><div class="session-form"><label>Starting region<select id="sessionRegion"><option value="all">Current map / all regions</option>${regions.map(r=>`<option>${esc(r)}</option>`).join('')}</select></label><label>Available time<select id="sessionMinutes"><option>15</option><option selected>30</option><option>45</option><option>60</option></select></label><label>Maximum stops<input id="sessionMaxStops" type="number" min="1" max="30" value="8"></label><label><input id="sessionShip" type="checkbox" checked> Ship travel allowed</label><label><input id="sessionFavorites" type="checkbox"> Favorites only</label><fieldset><legend>Categories</legend><div class="session-categories">${types.map(t=>`<label><input data-session-category type="checkbox" value="${esc(t)}"> ${label(t)}</label>`).join('')}</div></fieldset></div><div class="button-grid"><button id="planSession">Recalculate</button><button id="startSession" class="primary" ${s.ids.length?'':'disabled'}>${s.status==="active"?'Resume':'Start Session'}</button><button id="pauseSession" ${s.status==='active'?'':'disabled'}>Pause</button><button id="finishSession" ${s.ids.length?'':'disabled'}>Finish</button><button id="clearSession">End/Clear</button></div>${s.ids.length?`<div class="session-summary"><strong>${esc(s.title)}</strong><span>${s.completedIds.length}/${s.ids.length} complete • ${remaining.length} remaining • about ${Math.max(0,Math.round(s.estimatedMinutes*(remaining.length/Math.max(1,s.ids.length))))} min remaining</span>${current?`<button id="openSessionCurrent">Current: ${esc(current.name)}</button>`:''}<ol>${s.ids.map((id,i)=>{const l=byId(id);return l?`<li class="${s.completedIds.includes(id)?'done':''}">${i+1}. ${esc(l.name)} <button data-skip-session="${id}">Skip</button></li>`:''}).join('')}</ol></div>`:''}`;
    $("planSession").onclick=planSession; $("startSession").onclick=()=>{data.playSession.status="active";data.playSession.startedAt ||= new Date().toISOString();data.route.ids=[...data.playSession.ids];save();renderAll();toast("Play Session started")}; $("pauseSession").onclick=()=>{data.playSession.status="paused";data.playSession.pausedAt=new Date().toISOString();save();renderPlaySession();toast("Play Session paused")}; $("finishSession").onclick=()=>{data.playSession.status="completed";save();renderPlaySession();toast("Play Session completed")}; $("clearSession").onclick=()=>{data.playSession=clone(defaults.playSession);save();renderPlaySession();toast("Session cleared")}; $("openSessionCurrent")?.addEventListener("click",()=>{switchTab("map");openLocation(current.id,true)}); document.querySelectorAll('[data-skip-session]').forEach(b=>b.onclick=()=>{data.playSession.skippedIds.push(b.dataset.skipSession);save();renderPlaySession();toast("Stop skipped")});
  }
  function renderHelp() { const host=$("helpPanel"); if(!host)return; host.innerHTML=`<h2>Help & Gestures</h2><div class="help-grid"><article><strong>Move and zoom</strong><p>Drag with one finger. Pinch with two fingers. Tap a cluster to zoom into nearby locations.</p></article><article><strong>Quick actions</strong><p>Tap a marker for details or hold it for favorite, completion, route, notes, and screenshot actions.</p></article><article><strong>Planning</strong><p>Next Objective chooses a sensible next stop. Play Session creates a short approximate route based on available time.</p></article><article><strong>Trust and backups</strong><p>Verification labels show source confidence. Export backups regularly; everything stays local.</p></article></div><button id="replayOnboarding">Replay onboarding</button>`; $("replayOnboarding").onclick=()=>showOnboarding(true); }
  function showOnboarding(force=false) { if(data.settings.onboardingComplete&&!force)return; const modal=$("onboarding"); modal.hidden=false; let page=0; const pages=[['Move naturally','One finger pans. Two fingers pinch to zoom.'],['Find objectives','Tap markers, hold for quick actions, and tap clusters to expand them.'],['Plan your play','Use Next Objective or build a timed Play Session.'],['Protect progress','Export backups and use recovery snapshots before major changes.']]; const render=()=>{ $("onboardingContent").innerHTML=`<small>${page+1} of ${pages.length}</small><h2>${pages[page][0]}</h2><p>${pages[page][1]}</p>`; $("onboardingBack").disabled=page===0; $("onboardingNext").textContent=page===pages.length-1?'Start Exploring':'Next'; }; $("onboardingBack").onclick=()=>{page--;render()}; $("onboardingSkip").onclick=()=>{data.settings.onboardingComplete=true;save();modal.hidden=true}; $("onboardingNext").onclick=()=>{if(page===pages.length-1){data.settings.onboardingComplete=true;save();modal.hidden=true}else{page++;render()}}; render(); }
  function addCorrectionButton() { if(!selectedId||$("reportCorrection"))return; const host=$("detailContent"); const b=document.createElement('button'); b.id='reportCorrection'; b.textContent='Report a correction'; b.onclick=()=>{const l=byId(selectedId); const note=prompt('Describe the correction or source evidence:'); if(!note)return; data.pendingCorrections.push({id:Date.now(),locationId:l.id,current:{name:l.name,type:l.type,region:l.region,coordinates:l.gameCoordinates},note,date:new Date().toISOString()});save();download(`correction-${l.id}.json`,data.pendingCorrections.at(-1));toast('Correction report saved locally')}; host.appendChild(b); }
  function renderSettings() {
    $("playMode").value = data.settings.mode; $("reduceMotion").checked = !!data.settings.reduceMotion;
    document.body.classList.toggle("reduce-motion", !!data.settings.reduceMotion);
    $("modeExplanation").textContent = MODE_COPY[data.settings.mode];
    renderBackupCenter(); renderPlaySession(); renderHelp();
    $("devStats").innerHTML = `<p>Database records: ${locations.length}</p><p>Visible records: ${getVisibleLocations({ ignoreQuery: true }).length}</p><p>Saved location states: ${Object.keys(data.locations).length}</p><p>Route stops: ${data.route.ids.length}</p><p>Cache: acbf-v3.0-flagship</p>`;
  }

  function renderFilterState() {
    ["hideCompleted", "favoritesOnly", "incompleteOnly", "discoveredOnly", "verifiedOnly", "legacyOnly"].forEach(key => $(key).checked = !!data.filters[key]);
  }
  function renderAll() {
    renderCategoryControls(); renderQuickFilters(); renderRegionFilter(); renderFilterState(); renderOverview(); renderIslandExplorer(); renderDirectory(); renderMarkers(); drawRoute(); renderJackdaw(); renderProgress(); renderLog(); renderSettings(); renderRouteCandidateSummary(); renderNextObjective();
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
    document.querySelectorAll(".app-panel").forEach(panel => panel.classList.remove("active"));
    $(`${name}Panel`).classList.add("active");
    data.ui.activeTab = name; save(); if (name === "map") setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
  }
  function setBrowser(open) {
    browserOpen = open;
    document.body.classList.toggle("browser-open", open);
  }
  function enterFullScreen() {
    switchTab("map"); document.body.classList.add("app-fullscreen"); setBrowser(false); setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
  }
  function exitFullScreen() { document.body.classList.remove("app-fullscreen"); setBrowser(false); setTimeout(() => window.dispatchEvent(new Event("resize")), 50); }
  function openDrawer(id) {
    $("modalBackdrop").hidden = false;
    requestAnimationFrame(() => { $("modalBackdrop").classList.add("show"); $(id).classList.add("open"); $(id).setAttribute("aria-hidden", "false"); });
  }
  function closeDrawer(id) {
    $(id).classList.remove("open"); $(id).setAttribute("aria-hidden", "true");
    if (!["filterDrawer", "routeDrawer"].some(drawerId => $(drawerId).classList.contains("open"))) {
      $("modalBackdrop").classList.remove("show"); setTimeout(() => $("modalBackdrop").hidden = true, 220);
    }
  }
  function runScan() {
    const wave = $("scanWave"); wave.classList.remove("active"); void wave.offsetWidth; wave.classList.add("active");
    document.querySelectorAll(".marker").forEach((marker, index) => setTimeout(() => { marker.classList.add("scan-pulse"); setTimeout(() => marker.classList.remove("scan-pulse"), 900); }, Math.min(index * 22, 800)));
  }
  function resetTemporaryMapState() {
    data.route.ids = []; selectedId = null; query = ""; $("locationSearch").value = "";
    save(); closeSheet(); drawRoute(); $("scanWave").classList.remove("active"); renderAll(); toast("Map, route, scan, search and selection reset");
  }

  function validateBackup(payload) {
    return !!(payload && payload.format === BACKUP_FORMAT && payload.data && typeof payload.data === "object" && Array.isArray(payload.data.log) && typeof payload.data.locations === "object");
  }
  function download(name, object) {
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(object, null, 2)], { type: "application/json" }));
    anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportBackup() { data.lastBackupAt = new Date().toISOString(); save(); download(`animus-companion-backup-${new Date().toISOString().slice(0, 10)}.json`, { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, data }); }

  // Events
  $("locationSearch").oninput = event => { query = event.target.value; data.ui.query=query; save(); renderDirectory(); renderMarkers(); renderOverview(); drawRoute(); };
  $("searchAllLocations").onchange = event => { searchAcrossAll = event.target.checked; data.ui.searchAcrossAll=searchAcrossAll; save(); renderDirectory(); };
  $("globalSearchButton").onclick = () => { switchTab("map"); setBrowser(true); setTimeout(() => $("locationSearch").focus(), 200); };
  $("mapStatusButton").onclick = () => setBrowser(!browserOpen);
  $("brandHome").onclick = () => switchTab("map");
  $("closeBrowser").onclick = () => setBrowser(false);
  $("filterButton").onclick = () => openDrawer("filterDrawer");
  $("routeButton").onclick = () => openDrawer("routeDrawer");
  $("closeFilterDrawer").onclick = () => closeDrawer("filterDrawer");
  $("closeRouteDrawer").onclick = () => closeDrawer("routeDrawer");
  $("modalBackdrop").onclick = () => { closeDrawer("filterDrawer"); closeDrawer("routeDrawer"); };
  $("applyFilters").onclick = () => { save(); closeDrawer("filterDrawer"); renderAll(); };
  $("clearFilters").onclick = () => { data.filters = clone(defaults.filters); save(); renderAll(); };
  ["hideCompleted", "favoritesOnly", "incompleteOnly", "discoveredOnly", "verifiedOnly", "legacyOnly"].forEach(key => $(key).onchange = event => {
    data.filters[key] = event.target.checked;
    if (key === "verifiedOnly" && event.target.checked) data.filters.legacyOnly = false;
    if (key === "legacyOnly" && event.target.checked) data.filters.verifiedOnly = false;
    renderFilterState();
  });
  $("regionFilter").onchange = event => { data.filters.region = event.target.value; save(); renderAll(); };
  $("routeSource").onchange = event => { data.route.source = event.target.value; save(); renderRouteCandidateSummary(); };
  $("routeStrategy").onchange = event => { data.route.strategy = event.target.value; save(); };
  $("buildRoute").onclick = buildRoute; $("reverseRoute").onclick = reverseRoute; $("clearRoute").onclick = clearRoute;
  $("scanButton").onclick = runScan;
  $("nearestButton").onclick = nearestToMapCenter;
  $("contextScreenshotInput").onchange = event => {
    const file = event.target.files?.[0];
    const id = contextLocationId;
    if (!file || !id) return;
    if (file.size > 1800000) { toast("Choose an image smaller than 1.8 MB"); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => { stateFor(id).screenshot = reader.result; save(); closeMarkerContext(); toast("Screenshot saved locally"); if (selectedId === id) openLocation(id); };
    reader.readAsDataURL(file); event.target.value = "";
  };
  document.addEventListener("pointerdown", event => { if (!event.target.closest("#markerContextMenu") && !event.target.closest(".marker")) closeMarkerContext(); });
  $("fullScreenButton").onclick = enterFullScreen; $("exitFullScreenButton").onclick = exitFullScreen;
  $("viewport").addEventListener("click", event => { if (event.target.closest("button")) return; if (!document.body.classList.contains("app-fullscreen")) enterFullScreen(); });
  $("sheetBackdrop").onclick = closeSheet; $("sheetHandle").onclick = cycleSheet;
  $("detailSheet").addEventListener("touchstart", event => { sheetTouchStart = event.touches[0]?.clientY || null; }, { passive: true });
  $("detailSheet").addEventListener("touchend", event => { if (sheetTouchStart == null) return; const dy = (event.changedTouches[0]?.clientY || sheetTouchStart) - sheetTouchStart; sheetTouchStart = null; if (dy > 90) { const size = $("detailSheet").dataset.size; if (size === "full") $("detailSheet").dataset.size = "half"; else if (size === "half") $("detailSheet").dataset.size = "compact"; else closeSheet(); } else if (dy < -90) cycleSheet(); }, { passive: true });
  document.querySelectorAll(".tab").forEach(tab => tab.onclick = () => switchTab(tab.dataset.tab));
  window.addEventListener("acbf:map-reset", resetTemporaryMapState);
  window.addEventListener("acbf:map-change", () => { renderMarkers(); clearTimeout(window.__mapSaveTimer); window.__mapSaveTimer=setTimeout(save,180); });
  $("addLogEntry").onclick = () => { const title = $("logTitle"), body = $("logBody"); if (!title.value.trim() && !body.value.trim()) return toast("Add a title or note first"); data.log.unshift({ id: crypto.randomUUID?.() || Date.now(), date: new Date().toISOString(), title: title.value.trim() || "Captain's Log", body: body.value.trim() }); title.value = ""; body.value = ""; save(); renderLog(); };
  $("logSearch").oninput = event => { logQuery = event.target.value; renderLog(); };
  $("playMode").onchange = event => { data.settings.mode = event.target.value; save(); renderAll(); toast(`${label(event.target.value)} Mode enabled`); };
  $("reduceMotion").onchange = event => { data.settings.reduceMotion = event.target.checked; save(); renderSettings(); };
  $("exportBackup").onclick = exportBackup;
  $("importBackup").onchange = async event => {
    const snapshot = clone(data);
    try {
      const file = event.target.files?.[0]; if (!file) return;
      const payload = JSON.parse(await file.text()); if (!validateBackup(payload)) throw new Error("Invalid backup format");
      const imported = payload.data;
      snapshot("Before backup import");
      Object.keys(data).forEach(key => delete data[key]);
      Object.assign(data, { ...clone(defaults), ...imported, settings: { ...defaults.settings, ...(imported.settings || {}) }, filters: { ...defaults.filters, ...(imported.filters || {}) }, jackdaw: { ...defaults.jackdaw, ...(imported.jackdaw || {}) }, route: { ...defaults.route, ...(imported.route || {}) } });
      save(); renderAll(); $("settingsStatus").textContent = "Backup imported successfully.";
    } catch (error) {
      Object.keys(data).forEach(key => delete data[key]); Object.assign(data, snapshot);
      $("settingsStatus").textContent = `Import failed: ${error.message}. Existing data was preserved.`;
    } finally { event.target.value = ""; }
  };
  $("resetProgress").onclick = () => { if (confirm("Reset location progress, notes, favorites, Jackdaw tiers and log entries? Settings and filters will remain.")) { snapshot("Before progress reset"); data.locations = {}; data.jackdaw = clone(defaults.jackdaw); data.log = []; data.route = clone(defaults.route); save(); renderAll(); } };
  $("resetSettings").onclick = () => { if (confirm("Reset play mode, filters and visual settings? Progress will remain.")) { snapshot("Before settings reset"); data.settings = clone(defaults.settings); data.filters = clone(defaults.filters); save(); renderAll(); } };
  $("fullReset").onclick = () => { if (confirm("Erase all Animus Companion data? This cannot be undone.")) { localStorage.removeItem(STORE); location.reload(); } };
  $("versionButton").onclick = () => { if (++devTaps >= 7) { $("devPanel").hidden = !$("devPanel").hidden; devTaps = 0; toast("Developer Mode toggled"); } };
  $("exportDiagnostics").onclick = () => download("animus-diagnostics.json", { appVersion: APP_VERSION, databaseVersion: window.ACBF_DATABASE_VERSION, records: locations.length, visibleRecords: getVisibleLocations({ ignoreQuery: true }).length, filters: data.filters, route: data.route, settings: data.settings, stateCounts: STATUS_VALUES.map(status => [status, locations.filter(location => stateFor(location.id).status === status).length]) });

  window.addEventListener("error", event => { console.error(event.error || event.message); toast("A recoverable app error occurred"); });
  $("locationSearch").value=query; $("searchAllLocations").checked=searchAcrossAll; $("detailSheet").dataset.size=data.ui.sheetSize||"half"; renderAll(); switchTab(data.ui.activeTab||"map"); setTimeout(()=>{ if(data.mapView?.scale>1.001) window.ACBF_MAP?.setState?.(data.mapView); if(selectedId) openLocation(selectedId,false); showOnboarding(false); },120);
  setTimeout(() => $("bootScreen")?.classList.add("hide"), 650); setTimeout(() => $("bootScreen")?.remove(), 1150);
  if ("serviceWorker" in navigator) window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js");
      registration.addEventListener("updatefound", () => { const worker = registration.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) toast("Update available. Reopen the app to apply it."); }); });
    } catch (error) { console.error("Service worker registration failed", error); }
  });
})();
