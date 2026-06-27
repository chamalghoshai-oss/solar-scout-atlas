# Field Marketing & Solar Survey App — Plan

A mobile-first PWA for VertX Energies field reps: track GPS routes, drop pins on potential houses, capture leads with photos, and follow up via WhatsApp Business — all without login.

## Screens

1. **Live Run (home)** — Google Map centered on your location, big "Start Marketing Run" button. While running:
  - Live breadcrumb polyline drawn as you move (GPS sampled every few seconds).
  - "Stop Run" + run duration / distance counter.
  - Tap anywhere on the map → opens **Lead Capture** sheet with that coordinate.
  - Long-press / "+" button → drop a **Potential House** pin (lighter, just a marker — no full form).
2. **Atlas (coverage view)** — All-time map showing:
  - Every past run's polyline overlaid, with **repeat segments colored hotter** (1× gray-blue, 2× orange, 3+× red) and a numeric badge on heavily repeated streets.
  - Toggleable layers: Leads, Potential Houses, Visited/Not-Visited pins.
  - "Gray = unvisited" naturally emerges: areas with no lines stand out.
3. **Leads list** — Scrollable, filterable by Status (Interested / Not Home / Follow-up / Converted / Not Interested), sorted by recency or distance.
4. **Lead Detail** — Photo, contact info, kW, notes, geotag mini-map, Status dropdown, Visited toggle, and a prominent **"Contact on WhatsApp"** button.

## Lead Capture Form

- Auto-captured GPS coords (editable by dragging the pin).
- Photo upload (camera or gallery; multiple photos, stored in Lovable Cloud Storage).
- Name, Phone (with +91 default, validated).
- Required kW (number), Notes (textarea).
- Status dropdown: Interested / Not Home / Follow-up Required / Converted / Not Interested.
- Type: **Lead** (full form) vs **Potential House** (just pin + optional note, upgradeable to full lead later).
- Visited toggle (auto-true on save, can flip later).

## WhatsApp Integration

"Contact on WhatsApp" opens `https://wa.me/<phone>?text=<encoded>` with template:

> Hi {name}, this is Aureon from VertX Energies. I am following up on our chat about the {kW}kW solar system for your site...

Editable in a Settings page so you can tweak the script without redeploys.

## Atlas: how repeat routes are detected

GPS points snapped to a coarse grid (~20 m cells). Each cell tracks visit count across all runs. The map overlay colors polylines by the max cell-count they pass through, with a small numeric badge for cells visited 3+ times. This gives you the "don't knock the same door twice / don't skip a street" view you asked for.

## Tech / data

- **Backend:** Lovable Cloud (auto-provisioned) for leads, runs, GPS points, photos, settings. No login — a device-local anonymous ID identifies your data.
- **Map:** Google Maps via the Google Maps connector (you'll be prompted to connect it; the managed key works on `*.lovable.app`).
- **PWA:** installable on Android home screen, works with intermittent connectivity (queued writes sync when online).

## Technical details

- Tables: `runs`, `run_points` (run_id, lat, lng, ts), `leads` (with type='lead'|'potential', status, kW, notes, phone, name, geotag, photos[]), `settings` (whatsapp_template, sender_name).
- Storage bucket `lead-photos` (public read for simplicity; signed URLs if you prefer).
- Routes: `/` (Live Run), `/atlas`, `/leads`, `/leads/$id`, `/settings`.
- GPS: `navigator.geolocation.watchPosition` with high accuracy; throttled writes (every ~5 s or ~10 m moved).
- Repeat-heat: client-side aggregation of `run_points` into a grid (geohash precision 7) on Atlas load, cached.
- WhatsApp link: `wa.me` works for both WhatsApp and WhatsApp Business on the device.
- Mobile-first layout, bottom tab nav (Run / Atlas / Leads / Settings).

## Out of scope (ask later if you want them)

- Multi-rep team view / admin dashboard.
- Offline-first sync beyond simple queueing.
- Auto-generated proposal PDFs.
- Importing leads from a CSV.

Confirm and I'll build it. If you have a preferred WhatsApp template wording or sender name different from "Aureon / VertX Energies", drop it in the reply and I'll bake it in as the default.

&nbsp;

&nbsp;

Also add geo tag picture option