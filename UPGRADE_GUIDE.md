# Upgrade Guide — 2.0 to 3.0

1. Export a JSON backup from the existing app as a precaution.
2. Replace the repository-root files with every file from the 3.0 ZIP.
3. Commit and wait for GitHub Pages deployment.
4. Open the site in Safari and reload once.
5. Close and reopen the Home Screen app so the new service worker activates.

Version 3.0 preserves the `acbf-companion-m3` storage key. Existing progress, favorites, notes, checklists, Jackdaw tiers and Captain’s Log entries should migrate automatically. New filter and route fields are added through default merging.
