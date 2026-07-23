# Architecture

## Production modules

- `database.js` — read-only location and Jackdaw definitions.
- `engine.js` — dependency-free map pan, pinch zoom, inertia, clamping and marker focusing.
- `app.js` — application state, persistence, centralized filtering, routing, search, progress, Jackdaw, log, backup and UI binding.
- `styles.css` — responsive map-first interface, iPhone safe areas, drawers, bottom sheets and content panels.
- `service-worker.js` — offline application shell and version-sensitive update strategy.

## Centralized dataset

`getVisibleLocations()` is the canonical source for map markers, filtered progress and route eligibility. The location directory also uses this dataset unless the user explicitly selects “Search entire database.” Route construction never accepts hidden locations. Existing route stops are removed safely after filter changes.

## Save compatibility

The app continues to use `acbf-companion-m3`. Version 3 adds `filters` and `route` objects while merging older saves into defaults, so prior location states, notes, favorites, Jackdaw levels and log entries remain readable.
