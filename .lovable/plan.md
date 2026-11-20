# Multiple Rooms and Custom Roof Ridges

## Build
- Allow adding any number of separate room blocks on the same floor, with clear room labels and per-room roof settings.
- Add independent X-axis and Y-axis rotation controls for each room.
- Allow drawing a custom ridge line for a selected room so it can be placed off-center or begin near an edge.
- Keep room geometry, roof shading, and saved designs aligned with the new settings.

## Technical details
- Extend the existing CAD model's room/storey entries instead of introducing a separate editor or data store.
- Reuse the existing roof-drawing canvas and model controls; add transformation and custom-ridge support in the CAD geometry helpers.
- Verify the drawing, rotation, and ridge controls in the running simulator and check the preview build log.