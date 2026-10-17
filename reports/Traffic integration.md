# Traffic and disruption integration

Integrates PR #1 (`traffic-flow-mvp`, original commit `d84e108`) with the map and disruption work on `main` (`69fb028`). Both histories are preserved by a merge commit on `integrate/traffic-disruptions`.

## Combined behavior

- Keeps the sky-blue map, Toronto camera restriction and seamless boundary fade, shared liquid-glass controls, and all four Three.js scenes including the event's concert beams.
- Adds the PR's typical citywide traffic ribbons, historical count-based estimates, weekday/weekend profiles, playback timeline, clickable baseline road details, data builder, and data file.
- Keeps native Mapbox detailed buildings and MapLibre extrusions. The alternative see-through building renderer remains available in source but is not activated or bundled into the traffic UI.
- Uses the dedicated deck.gl MapLibre adapter rather than patching private camera properties. Traffic is interleaved below boundary masks and disruption overlays.
- Shares saved scenario items and interaction state through `map-workspace.tsx`. The traffic picker defers to disruption placement and existing disruption features. Traffic panels hide while an item is being placed or edited.
- Saved full restrictions hide traffic on their matching segments. Drafts do not affect traffic. Moving, removing, or reopening an item restores the old road unless another full restriction still applies.
- Labels the wall-clock option Current time and all traffic figures as estimates. Full restrictions apply at every playback time; recorded schedules, lane reductions, and event attendance do not affect the traffic calculation. No diversions or queues are inferred.
- Pausing freezes time and streaks. Reduced-motion changes are observed dynamically. Hidden tabs stop animation; the UI updates only when its displayed minute or vehicle total changes.

## Validation

- 34 unit/data tests pass, including both branches' previous suites, all 5,659 toolbox road IDs matching the 42,987-segment traffic file, finite traffic estimates, normalized time profiles, and closure/move/reopen/overlap behavior.
- TypeScript and the production build pass.
- Local development page returns HTTP 200.
- Data file: 14.45 MB raw, 2.73 MB using gzip; Node parsed it in approximately 68 ms on this machine. This is not a browser frame-rate measurement. Traffic and the active renderer adapter load after the basemap is ready.
- No browser automation surface is enabled in this session. Combined WebGL rendering, picking, layout, and frame rate have not been visually verified.

## Browser review before merging the PR

1. With Mapbox, open the app and scrub between morning, midday, and evening, switch weekday/weekend, pause/resume, and return to Current time.
2. Switch 2D/3D, rotate, zoom, and resize. Confirm native building detail, labels, and the boundary fade remain visible; ensure traffic does not cover the outside-city mask.
3. Place, save, edit, move, cancel, and remove each of the four disruption types. Confirm models and concert beams render alongside traffic, full closures remove both flow directions only after saving, and reopening restores them.
4. Confirm clicking a disruption edits it while ordinary traffic ribbons open road details. Check keyboard placement and focus, and panels at desktop and narrow viewport sizes.
5. Test reduced motion and transparency preferences, background/restore the tab, and inspect browser errors and performance.
6. Repeat with no Mapbox token to verify MapLibre, its explicit worker URL, native extrusions, and the dedicated overlay adapter.

The integration updates the existing PR branch after verification. `main` is left unchanged for review.
