# VerteX Scout — Project Documentation

> Field solar-sales scouting platform: map-based lead capture, GPS marketing runs, route analytics, roof/kW planning, a 3D solar simulator, and a role-based team hierarchy (Owner → Manager → Field Staff).

---

## 1. Project Overview

VerteX Scout (published as `solar-scout-atlas`) is a mobile-first web app (also shipped as an Android shell via Capacitor) used by solar sales teams in the field.

Core capabilities:

- **Lead capture on a map** — long-press drops a draggable pin, lead form captures name, phone, required kW, notes, photos and roof plan.
- **Marketing runs** — GPS tracking of field walks/drives; run points are stored and rendered as road-snapped routes.
- **Atlas** — aggregated map view of leads and routes, filterable by user and by administrative boundary (district → state → country).
- **Roof planner** — user enters a kW target, the app arranges the corresponding number of panels inside drawn roof outlines.
- **3D Solar Simulator** — photo uploads → photogrammetry job pipeline → kW / annual kWh estimation.
- **WhatsApp outreach** — messages leads through WhatsApp **Business** (`com.whatsapp.w4b`) using configurable templates.
- **RBAC & team hierarchy** — owner sees everything, managers see their own team, field staff see only their own data.

---

## 2. Folder Structure

```text
.
├── android/                     Capacitor Android shell (Gradle project)
├── public/                      Static assets, manifest.webmanifest
├── src/
│   ├── components/
│   │   ├── AppShell.tsx         App chrome + role-aware navigation
│   │   ├── GeoCamera.tsx        Camera capture with geotagging
│   │   ├── LeadFormSheet.tsx    Lead create/edit bottom sheet
│   │   ├── RoofPlanner.tsx      kW → panel arrangement on drawn roof
│   │   ├── ScopeSelector.tsx    District/state/world boundary scope
│   │   ├── SimViewer.tsx        Three.js viewer for simulator meshes
│   │   └── ui/                  shadcn/ui primitives
│   ├── integrations/
│   │   ├── lovable/             Lovable auth broker (Google OAuth)
│   │   └── supabase/            Generated client, admin client, auth middleware, types
│   ├── lib/
│   │   ├── auth.ts              useAuth hook, roles, role labels
│   │   ├── boundaries.ts        GeoJSON admin boundaries
│   │   ├── device.ts            Device id helper (grouping metadata)
│   │   ├── gmaps.ts             Google Maps loader
│   │   ├── photogrammetry.ts    kW / kWh estimation helpers
│   │   ├── photos.ts            Lead photo upload/signed URLs
│   │   ├── roof-planner.ts      Panel layout geometry
│   │   ├── scopes.ts            Scope definitions
│   │   ├── sim-uploads.ts       Simulator upload helpers
│   │   ├── whatsapp.ts          WhatsApp Business deep links
│   │   └── *.functions.ts       Server functions (RPC): geocode, roads, route, login, users
│   ├── routes/                  File-based routes (TanStack Router)
│   │   ├── __root.tsx           Root shell, head metadata, AuthGate
│   │   ├── index.tsx            Map / home (lead capture + run tracking)
│   │   ├── auth.tsx             Login page
│   │   ├── atlas.tsx            Leads + routes analytics map
│   │   ├── leads.tsx / leads.$id.tsx
│   │   ├── profile.index.tsx / profile.$userId.tsx
│   │   ├── simulator.tsx / simulator.$id.tsx
│   │   ├── admin.users.tsx      Access-email & user management
│   │   └── settings.tsx
│   ├── router.tsx               Router + QueryClient factory
│   ├── start.ts                 Server/function middleware registration
│   └── styles.css               Tailwind v4 theme tokens
├── capacitor.config.ts
├── vite.config.ts
└── PROJECT_DOCUMENTATION.md
```

---

## 3. Technology Stack

| Layer | Technology |
| --- | --- |
| Framework | TanStack Start v1 (React 19, SSR on edge runtime) |
| Routing | TanStack Router (file-based, `src/routes`) |
| Build | Vite 7 |
| Styling | Tailwind CSS v4 (`src/styles.css` theme tokens) + shadcn/ui + Radix |
| Data fetching | TanStack Query v5 |
| Backend | Lovable Cloud (Postgres + Auth + Storage) |
| Server logic | `createServerFn` RPC (`*.functions.ts`) and `src/routes/api/*` routes |
| Maps | Google Maps JS API, Google Routes API, Geocoding API |
| 3D | three.js, @react-three/fiber, @react-three/drei |
| Mobile | Capacitor 8 (Android shell pointing at the published URL) |
| Forms | react-hook-form + zod |

---

## 4. Database Schema

All tables live in the `public` schema with RLS enabled and explicit grants.

### `profiles`
`id uuid PK (auth user)`, `full_name`, `email`, `designation`, `phone`, `status`, `manager_id uuid` (hierarchy link), `must_change_password bool`, `created_at`, `updated_at`.

### `user_roles`
`id uuid`, `user_id uuid`, `role text` (`owner` | `manager` | `field_staff`), `created_at`. Unique on (`user_id`,`role`). Roles are **never** stored on `profiles`.

### `authorized_emails`
`id`, `email`, `role`, `track_phone bool`, `label`, `created_by uuid`, `created_at`, `updated_at`. Whitelist that drives role assignment on first sign-in.

### `leads`
`id`, `user_id uuid NOT NULL`, `device_id text`, `type`, `name`, `phone`, `required_kw numeric`, `notes`, `lat`, `lng`, `status`, `visited bool`, `photos jsonb`, `roof_plan jsonb`, `created_at`, `updated_at`.

### `runs`
`id`, `user_id uuid NOT NULL`, `device_id`, `started_at`, `ended_at`, `distance_m numeric`, `created_at`.

### `run_points`
`id bigint`, `run_id uuid`, `user_id uuid NOT NULL`, `device_id`, `lat`, `lng`, `accuracy`, `ts`.

### `settings`
`user_id uuid`, `device_id`, `sender_name`, `company_name`, `whatsapp_template`, `updated_at`.

### `sim_jobs`
`id`, `user_id`, `lead_id`, `title`, `status enum`, `provider`, `upload_paths text[]`, `mesh_url`, `kw_estimate`, `annual_kwh`, `notes`, `error`, `created_at`, `updated_at`.

### `audit_log`
`id`, `actor_id`, `actor_email`, `action`, `target_type`, `target_id`, `previous_value jsonb`, `new_value jsonb`, `ip_address`, `user_agent`, `created_at`.

### Database functions (all `SECURITY DEFINER` where noted)

| Function | Purpose |
| --- | --- |
| `has_role(_user_id, _role)` | Role check used inside RLS policies |
| `is_owner(_user_id)` | Owner check |
| `is_manager(_user_id)` | Manager check |
| `manages_user(_manager_id, _staff_id)` | True when staff's `manager_id` is the manager |
| `handle_new_user()` | Creates profile + role from `authorized_emails` on signup |
| `sync_authorized_email_role()` | Keeps `user_roles` aligned with whitelist changes |
| `set_updated_at()` | `updated_at` maintenance |

### RLS model

- **Field staff:** `user_id = auth.uid()` only.
- **Manager:** own rows + rows of users where `profiles.manager_id = auth.uid()`.
- **Owner:** all rows.
- `settings` is strictly per-user (owner override only).
- Storage buckets `lead-photos` and `sim-uploads` are private; reads go through ownership-scoped policies and signed URLs.

---

## 5. API Documentation

App-internal logic uses typed RPC via `createServerFn`. There are no Supabase edge functions.

| Module | Export | Method | Auth | Description |
| --- | --- | --- | --- | --- |
| `src/lib/geocode.functions.ts` | `geocode` | POST | session | Address ⇄ coordinates via Google Geocoding |
| `src/lib/roads.functions.ts` | `snapToRoads` | POST | session | Snaps raw GPS points to road geometry |
| `src/lib/route.functions.ts` | `computeRoute` | POST | session | Google Routes API distance/duration/polyline |
| `src/lib/login.functions.ts` | login helpers | POST | public | Credential/magic-link assistance for first login |
| `src/lib/users.functions.ts` | `createAccessUser` | POST | `requireSupabaseAuth` | Owner/manager creates a user: upserts `authorized_emails`, creates the auth user with the default password, links `manager_id`. Managers may create `field_staff` only. |
| `src/lib/users.functions.ts` | `resetAccessPassword` | POST | `requireSupabaseAuth` | Resets a subordinate's password to the default. Managers limited to field staff. |

Direct Data API access (browser Supabase client, RLS enforced) is used for `leads`, `runs`, `run_points`, `settings`, `profiles`, `user_roles`, `authorized_emails`, `sim_jobs`.

External APIs consumed: Google Maps JS, Google Geocoding, Google Routes, Google Roads.

---

## 6. Authentication Flow

1. Unauthenticated visitors hit `AuthGate` in `src/routes/__root.tsx` and are routed to `/auth`.
2. `/auth` supports **email + password** (email address is the user id) and Google OAuth through the Lovable broker.
3. Default password for provisioned accounts is `123456` (`DEFAULT_ACCESS_PASSWORD`).
4. On first sign-in, `handle_new_user()` reads `authorized_emails` and creates the `profiles` row plus the matching `user_roles` row, linking `manager_id` to the creator. Unlisted emails default to `field_staff`.
5. `useAuth()` (`src/lib/auth.ts`) hydrates `userId`, `email`, `fullName`, `roles`, `isOwner`, `isManager`, `canTrackPhone`, and subscribes to `onAuthStateChange`.
6. Server functions marked with `requireSupabaseAuth` receive a validated bearer token; `attachSupabaseAuth` in `src/start.ts` attaches it client-side.
7. Owner account: `chamalghosh.ai@gmail.com`.

---

## 7. State Management

- **Server state:** TanStack Query (`QueryClient` created in `src/router.tsx`, injected into router context). Route loaders use `ensureQueryData`; components use `useSuspenseQuery` / `useQuery`.
- **Auth state:** `useAuth()` hook backed by the Supabase auth listener.
- **Route state:** URL search params (e.g. Atlas `?userId=` filter, scope selection).
- **Local UI state:** React `useState`/`useReducer` in route and sheet components.
- **Device-local state:** `localStorage` — `vertx_device_id` and the Supabase session.

---

## 8. Environment Variables

Client-visible (`import.meta.env`):

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Backend URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `VITE_SUPABASE_PROJECT_ID` | Project identifier |
| `VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_*` | Browser-safe Maps connector fields |

Server-only (`process.env`, never exposed to the browser):

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Server-side data access |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client (user provisioning only) |
| `SUPABASE_DB_URL` | Migration/maintenance |
| `GOOGLE_MAPS_API_KEY` | Geocoding / Routes / Roads (server) |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps JS key |
| `GOOGLE_MAPS_TRACKING_ID` | Maps connector metadata |
| `LOVABLE_API_KEY` | Lovable AI Gateway / connector gateway |

All backend secrets are managed by Lovable Cloud and injected at runtime; they are not committed to the repo.

---

## 9. Installation

```bash
# 1. Clone
git clone <repository-url>
cd <repo>

# 2. Install dependencies (bun recommended; npm/pnpm also work)
bun install

# 3. Environment
cp .env.example .env      # if present; otherwise Lovable Cloud injects values

# 4. Run the dev server
bun run dev               # http://localhost:8080
```

Useful scripts:

| Script | Purpose |
| --- | --- |
| `dev` | Vite dev server |
| `build` / `build:dev` | Production / development build |
| `preview` | Preview a production build |
| `lint`, `format` | ESLint / Prettier |
| `cap:sync`, `cap:open`, `android:build` | Capacitor Android workflow |

---

## 10. Deployment

### Web

1. Push to the default branch (Lovable ↔ GitHub sync is bidirectional).
2. Publish from Lovable. Production: `https://solar-scout-atlas.lovable.app`.
3. Database changes ship as SQL migrations applied through Lovable Cloud.

### Android (Capacitor)

```bash
bun run build
bunx cap sync android
bunx cap open android      # then Build > Generate Signed Bundle / APK
```

`capacitor.config.ts` points the native shell at the published URL (`server.url`) so SSR, auth, server functions and Maps keep working inside the APK. App id: `app.lovable.vertexscout`.

---

## 11. Completed Features

- Mandatory email/password + Google login with an authorized-email whitelist.
- Full RBAC: owner / manager / field staff, hierarchy via `profiles.manager_id`, enforced by RLS.
- Owner and manager user provisioning (create access + reset password) with scope limits.
- Hierarchical profile explorer: `/profile` tree and `/profile/$userId` detail with stats, leads, runs and an Atlas deep link.
- Map lead capture: long-press draggable pin, multi-touch ignored, photo capture, roof plan, status/visited tracking.
- GPS marketing runs with point logging, distance and duration.
- Atlas: road-snapped routes, tap for route stats, long-press to delete, manual route building, per-user filtering.
- Administrative boundary scoping (district → state → country).
- Roof planner: kW input → panel count and arrangement inside drawn roof lines.
- 3D Solar Simulator scaffold: uploads bucket, `sim_jobs` pipeline, kW/kWh estimation, three.js viewer.
- WhatsApp Business deep-link outreach with configurable templates.
- Security hardening: private storage buckets, ownership-scoped photo reads, guarded `SECURITY DEFINER` functions, leaked-password protection.
- Capacitor Android shell and PWA manifest.

---

## 12. Pending Features

- Manager ↔ staff reassignment UI (currently only set at creation time).
- Forced password change on first login (`must_change_password` column exists but is not enforced in the UI).
- Real photogrammetry provider integration for `sim_jobs` (current estimation is heuristic).
- Offline lead capture with background sync.
- Audit-log viewer UI (`audit_log` table is populated but has no screen).
- Lead export (CSV/PDF) and reporting dashboards.
- Push notifications and run reminders.
- Boundary data beyond Kerala districts.

---

## 13. Known Bugs / Limitations

- Google OAuth inside the Android webview has previously reported "sign in was cancelled"; email/password is the reliable path on mobile.
- Background GPS tracking can be throttled or stopped by Android battery optimisation; runs may show gaps.
- Road snapping depends on Google Routes quota — long runs can fall back to straight segments on quota errors.
- The Android shell loads the remote published URL, so it requires connectivity and has no offline mode.
- WhatsApp Business deep links fail silently if `com.whatsapp.w4b` is not installed.
- `device_id` remains on data rows as legacy grouping metadata and is no longer an access-control boundary.

---

## 14. Future Roadmap

**Near term** — password-change enforcement, manager reassignment UI, audit-log screen, CSV export.

**Mid term** — offline-first lead capture, richer team analytics (conversion rates, coverage heatmaps), real photogrammetry pipeline with mesh viewing, quotation generation from roof plans.

**Long term** — native Android build with foreground-service GPS, customer-facing proposal portal, CRM/ERP integrations, AI-assisted lead scoring and route optimisation, multi-tenant support for other regions.

---

_Last updated: 2026-07-26_