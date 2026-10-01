# Fork changelog

## 2.0.15-fork.2 (2026-10-01)

- Chat quotes and notes capture the whole selection, even with a slow drag. Before, a pause during the drag kept
  only the first word.
- The quoted text stays highlighted while you write the note. The note box shows exactly what will be quoted
  and sits below the selection.
- The composer chip shows the quoted text, with the full quote and note on hover.
- The canvas plugin (outside the repo, `~/.config/opencode/plugins/opencode-preview`) no longer hangs a turn when
  two projects start the canvas at once. See `handoff.md`.

## 2.0.15-fork.1 (2026-09-30)

This is the first versioned release. It is based on upstream opencode v2.0.15 plus Cline's chat stack.

### v1 UX restored on v2
- v1 look and layout, Chat, Code and Laya view modes, topics and side chat.
- A web Browser pane with a loopback direct frame and the annotator.
- Generated-file cards with download and preview, and pdf.js PDF preview.
- Timeline freeze fix for 75% zoom (the virtualizer settle tolerance).
- The file-card black screen fix: no `createResource` in the timeline.

### Launcher and Windows
- The launcher signs in without a Basic-auth prompt.
- Plugins no longer open console windows, and Playwright runs headless.
- IDM no longer hijacks previews:
  - file reads go to `/api/fs/read/~b64~<base64url>` and return `application/octet-stream`
  - sounds are inlined
- An open window offers a "new version, Reload" toast after each deploy.

### Chat
- `[[OPENCODE_TASK_COMPLETE]]` is hidden. The runner still uses it.
- Canvas output from the opencode-preview and opencode-artifacts plugins opens in a side-panel tab, not a
  browser window.

### Maps and spatial analysis (free only)
- Tools:
  - `maps_search`, `maps_ask`, `maps_route`, `maps_matrix`, `maps_poi` and `map_show`.
  - `geo_compute`, which covers geodesics, UTM, buffers, hulls, DBSCAN, ranking, classification (best of Jenks,
    quantile, equal, std-dev and head/tail by GVF), Moran's I, Getis-Ord Gi*, Clark–Evans and centrography.
- Data sources:
  - OpenStreetMap: Nominatim (preferring POIs), Photon, OSRM and Overpass.
  - Free enrichment: OSM hours, stars and contacts, plus Wikimedia photos whose title names the place.
  - Google Maps via the Gemini free tier: disabled for new keys (2.5 models retired), falls back to OSM, never
    billed.
- Settings → Maps:
  - key, a free-tier confirmation and daily-limit guard
  - a "429 means stop for the day" rule
- The Research providers block is collapsed and points to Maps.
- UI:
  - A Map tab in the side panel with numbered pins, name chips and a card strip. It opens on the first result.
  - Gemini-style inline place cards in replies.
  - A photo carousel in tool cards.
- Research for place, hotel and event queries uses Maps. The Laya fallback follows a spatial ranking.

Hook-by-hook details: [`../FORK-HOOKS.md`](../FORK-HOOKS.md). Deploy history and rollback: [`handoff.md`](handoff.md).
