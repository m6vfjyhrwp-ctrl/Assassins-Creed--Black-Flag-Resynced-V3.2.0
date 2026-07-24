# v3.4.0 Seamless Experience

Preserves v3.3.0 functionality, storage key, saves, marker IDs, coordinates, map artwork, clustering, spiderfying, routing, and database records. Adds continuity restoration, Next Objective, Play Sessions, undo feedback, onboarding/help, recovery snapshots, correction reporting, accessibility improvements, and offline cache v3.4.0.

# Testing Report

## Automated checks completed

- JavaScript syntax validation for `app.js`, `engine.js`, `database.js` and `service-worker.js`.
- JSON parsing for `VERSION.json` and `manifest.webmanifest`.
- Verified every local asset referenced by `index.html` exists.
- Verified every service-worker core-cache path exists.
- Verified every DOM ID referenced through the application `$()` helper exists in `index.html`.
- Verified the database loads in an isolated JavaScript context and contains 75 records.
- Verified every location has an ID, type, map position and supported verification label.
- Verified ZIP files are stored directly at the archive root.

## Logic reviewed

- One centralized visible-location function feeds map markers, filtered progress and route candidates.
- Single-category selection is exclusive; drawer selection supports multiple categories.
- Hidden locations are removed from active routes after filtering.
- Import failure restores the in-memory pre-import snapshot and does not save partial data.
- Map Reset clears temporary route, search, scan and selected-location state without deleting progress or filters.

## Not physically tested

- Actual iPhone Safari gesture feel, Home Screen installation and safe-area appearance.
- Real offline launch after installation on a physical iPhone.
- Long-duration performance with a future database containing hundreds or thousands of records.

## v3.2.0 database validation

- Database JavaScript parses successfully.
- 104 records load with 104 unique IDs.
- Database version is 7; user-data version remains 3.
- Existing storage key remains `acbf-companion-m3`.
- 29 buried-treasure records are available: 26 guide-documented map treasures plus 3 community-event chests.
- Service-worker cache identifier was incremented and all core paths resolve.
