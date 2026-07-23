# Animus Companion v3.3.0 Validation

Validated before packaging:

- JavaScript syntax: `app.js`, `engine.js`, `database.js`, and `service-worker.js`
- JSON syntax: `VERSION.json` and `manifest.webmanifest`
- Static DOM references used by the application
- All locally referenced images, scripts, styles, manifest files, and documentation paths
- Database version remains 7
- User-data version remains 3
- Storage key remains `acbf-companion-m3`
- Root-level deployment structure

Implemented usability features:

- Scale-aware low-zoom marker clustering
- Temporary close-zoom marker spreading without changing stored coordinates
- Full-width mobile search/filter controls
- Island Explorer and route-remaining action
- Nearest visible incomplete objective based on map center
- Long-press marker actions
- Local reference screenshot attachment
- Refined three-height detail sheet
- Improved touch targets, scrolling, safe areas, and landscape presentation
