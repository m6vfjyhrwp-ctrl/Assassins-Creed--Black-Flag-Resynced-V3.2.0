"use strict";
(() => {
  const locations = window.ACBF_LOCATIONS || [];
  const systems = window.ACBF_JACKDAW_SYSTEMS || [];
  const STORE = "acbf-companion-m3";
  const BACKUP_FORMAT = "animus-companion-backup";
  const APP_VERSION = "3.0.0";
  const STATUS_VALUES = ["not-started", "discovered", "attempted", "completed", "needs-recheck"];
  const MODE_COPY = {
    normal: "Balanced visibility. All stored locations are visible with full details.",
    explorer: "Reduces spoilers. Undiscovered names and detailed rewards are concealed where practical.",
    completionist: "Shows every stored objective, completion state, reward, and requirement."
  };
  const defaults = {
    version: window.ACBF_USER_DATA_VERSION || 3,
    settings: { mode: "normal", reduceMotion: false },
    filters: { categories: [], hideCompleted: false, favoritesOnly: false, incompleteOnly: false, discoveredOnly: false, verifiedOnly: false, legacyOnly: false, region: "all" },
    locations: {}, jackdaw: Object.fromEntries(systems.map(s => [s.id, 0])), log: [],
    route: { ids: [], source: "visible-incomplete", strategy: "nearest", manualIds: [] }
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
        route: { ...defaults.route, ...(saved.route || {}), ids: Array.isArray(saved.route?.ids) ? saved.route.ids : [], manualIds: Array.isArray(saved.route?.manualIds) ? saved.route.manualIds : [] }
      };
    } catch (error) {
      console.error("Save load failed", error);
      return clone(defaults);
    }
  }

  const data = safeLoad();
  let query = "";
  let logQuery = "";
  let selectedId = null;
  let searchAcrossAll = false;
  let devTaps = 0;
  let browserOpen = false;
  let sheetTouchStart = null;

  function save() {
    data.version = window.ACBF_USER_DATA_VERSION || 3;
    localStorage.setItem(STORE, JSON.stringify(data));
  }
  function stateFor(id) {
    return data.locations[id] ||= { status: "not-started", favorite: false, note: "", checklist: {} };
  }
  function toast(message) {
    const element = $("toast");
    element.textContent = message;
    element.hidden = false;
    clearTimeout(element.timer);
    element.timer = setTimeout(() => element.hidden = true, 2400);
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
    if (mapState.scale >= 1.75 || list.length < 25) return list.map(location => ({ kind: "location", location }));
    const cellSize = mapState.scale < 1.25 ? 10 : 7;
    const buckets = new Map();
    list.forEach(location => {
      const key = `${Math.floor(location.mapPosition.x / cellSize)}:${Math.floor(location.mapPosition.y / cellSize)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(location);
    });
    return [...buckets.values()].map(group => group.length === 1 ? { kind: "location", location: group[0] } : { kind: "cluster", group, x: group.reduce((s, l) => s + l.mapPosition.x, 0) / group.length, y: group.reduce((s, l) => s + l.mapPosition.y, 0) / group.length });
  }

  function markerClass(location) {
    const state = stateFor(location.id);
    return `marker marker-${location.type}${state.status === "completed" ? " completed" : ""}${state.favorite ? " favorite" : ""}${String(location.verification).startsWith("Legacy") ? " legacy" : ""}${selectedId === location.id ? " selected" : ""}`;
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
      button.style.left = `${location.mapPosition.x}%`; button.style.top = `${location.mapPosition.y}%`;
      button.dataset.id = location.id;
      if (routeIndex.has(location.id)) button.dataset.routeOrder = routeIndex.get(location.id);
      button.setAttribute("aria-label", data.settings.mode === "explorer" && !revealForMode(location) ? "Undiscovered location" : location.name);
      button.innerHTML = `<span>${location.icon || "•"}</span>`;
      button.addEventListener("pointerdown", event => event.stopPropagation());
      button.addEventListener("click", event => { event.stopPropagation(); openLocation(location.id); });
      host.appendChild(button);
    });
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
    selectedId = id;
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
      <h3>Captain’s Notes</h3><textarea id="noteField" rows="4" placeholder="Your private notes…">${esc(state.note)}</textarea>
    `;
    $("closeSheetButton").onclick = closeSheet;
    $("statusSelect").onchange = event => {
      const previous = state.status;
      state.status = event.target.value;
      if (state.status === "completed" && previous !== "completed") data.log.unshift({ id: crypto.randomUUID?.() || Date.now(), date: new Date().toISOString(), title: `Completed: ${location.name}`, body: `${location.region} • ${location.gameCoordinates}`, locationId: location.id });
      save(); renderAll(); openLocation(id);
    };
    $("favoriteToggle").onchange = event => { state.favorite = event.target.checked; save(); renderAll(); };
    $("noteField").oninput = event => { state.note = event.target.value; save(); };
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
    renderMarkers();
  }
  function focusLocation(location) {
    const rect = $("viewport").getBoundingClientRect();
    window.ACBF_MAP?.focusPercent?.(location.mapPosition.x, location.mapPosition.y, Math.max(2.35, window.ACBF_MAP?.getState?.().scale || 1), rect.width / 2, rect.height * .36);
    setTimeout(renderMarkers, 230);
  }
  function closeSheet() {
    $("sheetBackdrop").classList.remove("show"); $("detailSheet").classList.remove("open");
    selectedId = null; renderMarkers();
    setTimeout(() => $("sheetBackdrop").hidden = true, 240);
  }
  function cycleSheet() {
    const order = ["compact", "half", "full"];
    const current = $("detailSheet").dataset.size || "half";
    $("detailSheet").dataset.size = order[(order.indexOf(current) + 1) % order.length];
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

  function renderSettings() {
    $("playMode").value = data.settings.mode; $("reduceMotion").checked = !!data.settings.reduceMotion;
    document.body.classList.toggle("reduce-motion", !!data.settings.reduceMotion);
    $("modeExplanation").textContent = MODE_COPY[data.settings.mode];
    $("devStats").innerHTML = `<p>Database records: ${locations.length}</p><p>Visible records: ${getVisibleLocations({ ignoreQuery: true }).length}</p><p>Saved location states: ${Object.keys(data.locations).length}</p><p>Route stops: ${data.route.ids.length}</p><p>Cache: acbf-v3.0-flagship</p>`;
  }

  function renderFilterState() {
    ["hideCompleted", "favoritesOnly", "incompleteOnly", "discoveredOnly", "verifiedOnly", "legacyOnly"].forEach(key => $(key).checked = !!data.filters[key]);
  }
  function renderAll() {
    renderCategoryControls(); renderQuickFilters(); renderRegionFilter(); renderFilterState(); renderOverview(); renderDirectory(); renderMarkers(); drawRoute(); renderJackdaw(); renderProgress(); renderLog(); renderSettings(); renderRouteCandidateSummary();
  }

  function switchTab(name) {
    document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("active", tab.dataset.tab === name));
    document.querySelectorAll(".app-panel").forEach(panel => panel.classList.remove("active"));
    $(`${name}Panel`).classList.add("active");
    if (name === "map") setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
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
  function exportBackup() { download(`animus-companion-backup-${new Date().toISOString().slice(0, 10)}.json`, { format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, data }); }

  // Events
  $("locationSearch").oninput = event => { query = event.target.value; renderDirectory(); renderMarkers(); renderOverview(); drawRoute(); };
  $("searchAllLocations").onchange = event => { searchAcrossAll = event.target.checked; renderDirectory(); };
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
  $("fullScreenButton").onclick = enterFullScreen; $("exitFullScreenButton").onclick = exitFullScreen;
  $("viewport").addEventListener("click", event => { if (event.target.closest("button")) return; if (!document.body.classList.contains("app-fullscreen")) enterFullScreen(); });
  $("sheetBackdrop").onclick = closeSheet; $("sheetHandle").onclick = cycleSheet;
  $("detailSheet").addEventListener("touchstart", event => { sheetTouchStart = event.touches[0]?.clientY || null; }, { passive: true });
  $("detailSheet").addEventListener("touchend", event => { if (sheetTouchStart == null) return; const dy = (event.changedTouches[0]?.clientY || sheetTouchStart) - sheetTouchStart; sheetTouchStart = null; if (dy > 90) { const size = $("detailSheet").dataset.size; if (size === "full") $("detailSheet").dataset.size = "half"; else if (size === "half") $("detailSheet").dataset.size = "compact"; else closeSheet(); } else if (dy < -90) cycleSheet(); }, { passive: true });
  document.querySelectorAll(".tab").forEach(tab => tab.onclick = () => switchTab(tab.dataset.tab));
  window.addEventListener("acbf:map-reset", resetTemporaryMapState);
  window.addEventListener("acbf:map-change", renderMarkers);
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
      Object.keys(data).forEach(key => delete data[key]);
      Object.assign(data, { ...clone(defaults), ...imported, settings: { ...defaults.settings, ...(imported.settings || {}) }, filters: { ...defaults.filters, ...(imported.filters || {}) }, jackdaw: { ...defaults.jackdaw, ...(imported.jackdaw || {}) }, route: { ...defaults.route, ...(imported.route || {}) } });
      save(); renderAll(); $("settingsStatus").textContent = "Backup imported successfully.";
    } catch (error) {
      Object.keys(data).forEach(key => delete data[key]); Object.assign(data, snapshot);
      $("settingsStatus").textContent = `Import failed: ${error.message}. Existing data was preserved.`;
    } finally { event.target.value = ""; }
  };
  $("resetProgress").onclick = () => { if (confirm("Reset location progress, notes, favorites, Jackdaw tiers and log entries? Settings and filters will remain.")) { data.locations = {}; data.jackdaw = clone(defaults.jackdaw); data.log = []; data.route = clone(defaults.route); save(); renderAll(); } };
  $("resetSettings").onclick = () => { if (confirm("Reset play mode, filters and visual settings? Progress will remain.")) { data.settings = clone(defaults.settings); data.filters = clone(defaults.filters); save(); renderAll(); } };
  $("fullReset").onclick = () => { if (confirm("Erase all Animus Companion data? This cannot be undone.")) { localStorage.removeItem(STORE); location.reload(); } };
  $("versionButton").onclick = () => { if (++devTaps >= 7) { $("devPanel").hidden = !$("devPanel").hidden; devTaps = 0; toast("Developer Mode toggled"); } };
  $("exportDiagnostics").onclick = () => download("animus-diagnostics.json", { appVersion: APP_VERSION, databaseVersion: window.ACBF_DATABASE_VERSION, records: locations.length, visibleRecords: getVisibleLocations({ ignoreQuery: true }).length, filters: data.filters, route: data.route, settings: data.settings, stateCounts: STATUS_VALUES.map(status => [status, locations.filter(location => stateFor(location.id).status === status).length]) });

  window.addEventListener("error", event => { console.error(event.error || event.message); toast("A recoverable app error occurred"); });
  renderAll();
  setTimeout(() => $("bootScreen")?.classList.add("hide"), 650); setTimeout(() => $("bootScreen")?.remove(), 1150);
  if ("serviceWorker" in navigator) window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./service-worker.js");
      registration.addEventListener("updatefound", () => { const worker = registration.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) toast("Update available. Reopen the app to apply it."); }); });
    } catch (error) { console.error("Service worker registration failed", error); }
  });
})();
