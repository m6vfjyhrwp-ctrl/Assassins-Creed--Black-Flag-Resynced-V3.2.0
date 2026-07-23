# Known Limitations

- The supplied database contains 75 grounded records and is not a complete record-by-record catalogue of every chest, Animus fragment, shanty, manuscript, contract, tavern, warehouse, viewpoint or treasure pair.
- The map image is an upscaled source asset. It is clearer than the original small asset but does not contain additional cartographic detail beyond that source.
- Route distance and sailing time are approximations based on map-coordinate geometry. They do not model coastlines, wind, restricted passages, enemy encounters or fast travel.
- “Shortest practical route” uses nearest-neighbor plus a limited 2-opt improvement. It is optimized for phone performance rather than guaranteed mathematical optimality.
- Browser fullscreen APIs are intentionally not required on iPhone. Immersive mode fills the web app viewport and hides the app navigation, but Safari browser chrome remains controlled by iOS.
- Physical iPhone Safari and Home Screen testing was not performed in this build environment. Automated structural and syntax checks were performed.

## Database expansion status — v3.2.0

The complete documented Resynced buried-treasure set is now included. The database is not yet a claim of 100% individual-marker coverage: ordinary chests, Secrets, viewpoints, animals, Data Files and several location-level collectible classes still require a region-by-region Resynced audit. IGN’s interactive marker payload was not copied or scraped; public guides were used to verify the records added in this release.
