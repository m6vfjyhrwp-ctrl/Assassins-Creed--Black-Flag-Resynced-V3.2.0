# Changelog

## 3.2.0 — Resynced Treasure & Discovery Database Expansion

- Added the full documented set of 26 Black Flag Resynced buried-treasure dig locations with map-source coordinates, landmark guidance, prerequisites and rewards.
- Preserved and enriched the existing Florida and Sacrifice Island treasure IDs so current completion state remains compatible.
- Added all three July 2026 community treasure-hunt chests and their reported rewards.
- Added Blackbeard’s Treasure as a Resynced side quest and Exotic Sea Shells as an early trinket pickup.
- Increased database coverage from 75 to 104 unique records.
- Preserved database-independent storage keys, calibrated map artwork, route logic, map gestures, branding and application navigation.
- Incremented the service-worker cache to force replacement of the earlier database bundle.


## 3.0.1 — Approved branding update

- Applied the approved black-and-gold Man-o’-War identity to PWA icons, Apple Touch Icon, favicons, the existing header branding placement, and the initial synchronization screen.
- Preserved version 3.0 application code, map behavior, database, save keys, and user-data compatibility.
- Added new branding assets to the offline cache and incremented the cache version.
- Added `BRANDING_IMPLEMENTATION.md`.

## 3.0.0 — Flagship Map-First Release

### Map and filtering
- Made the Caribbean map the primary application surface.
- Added immersive full-screen map mode with safe-area-aware floating controls.
- Added a centralized visible-location dataset used by the map, location directory, progress calculations, search and route candidates.
- Selecting a single category now hides every unrelated marker and directory record.
- Added multi-category filtering, region filtering, hide-completed, favorites, incomplete, discovered, verified and legacy filters.
- Added responsive marker clustering at low zoom levels.
- Added marker focus and sensible zoom when opening search, progress or log-linked locations.

### Routing
- Routes are automatically restricted to currently visible filtered locations.
- Added visible-incomplete, all-visible, visible-favorites and manual-selection sources.
- Added nearest-first, shortest-practical and custom-order strategies.
- Added numbered route markers, reverse route, stop removal, distance estimate and approximate sailing effort.
- Filter changes safely remove route stops that are no longer visible.
- Added Jackdaw readiness warnings for route objectives.

### Location experience
- Added collapsible, half-height and full-height location bottom sheets.
- Added swipe and handle controls for resizing the sheet.
- Added route and manual-route actions, progress state, favorites, notes and checklists in the sheet.
- Explorer Mode now conceals detailed location information until discovery.

### Persistence and PWA
- Preserved the `acbf-companion-m3` storage key and user-data version.
- Backup export now includes filters, routes, settings and manual route selections.
- Import validation preserves existing data on failure.
- Added separate progress reset, settings reset and full app reset.
- Updated the service-worker cache and update notification behavior.


## 3.1.3 — Smooth Map Interaction & Compact Viewport Update
- Reworked map gesture handling for stable two-finger pinch zoom anchored between both fingers.
- Improved one-finger panning with frame-synchronized rendering and gentler inertial movement.
- Prevented browser page gestures and image dragging from interfering with map control.
- Reduced mobile and landscape toolbar spacing so the map uses more of the available screen.
- Preserved the database, storage key, saved-data schema, routing, filters, markers, progress, favorites, notes, Captain’s Log, and Jackdaw Planner.
