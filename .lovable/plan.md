## Goal
Replace the device-scoped RLS on `leads`, `runs`, `run_points`, and `settings` with role-scoped policies so:
- **Field staff** see only their own data.
- **Managers** see their own + their direct reports' data (via `profiles.manager_id`), can edit their reports' data, cannot see peers/owners.
- **Owners** see and manage everything.

Access-management (`authorized_emails`) and profile-visibility policies already match this hierarchy — no changes there.

## Current state (verified)
- `leads`, `runs`, `run_points`, `settings` still have four permissive `Direct device access …` policies each, granted to `anon` + `authenticated`, gated only by `device_id IS NOT NULL`. Any signed-in user sees all rows.
- `user_id` columns exist on all four tables but are **nullable**; inserts in `src/routes/index.tsx` and `src/routes/atlas.tsx` already pass `user_id` from the session.
- `has_role`, `is_owner`, `is_manager`, `manages_user(_manager_id, _staff_id)` helpers already exist.
- Anon access to app data is no longer needed — sign-in is mandatory (`AuthGate` in `__root.tsx`).

## Plan

### 1. Migration: role-scoped RLS
For `leads`, `runs`, `run_points`, `settings`:

1. Drop the four `Direct device access …` policies.
2. Revoke table privileges from `anon` (keep `authenticated` + `service_role`).
3. Backfill: `UPDATE … SET user_id = <first owner id> WHERE user_id IS NULL` so legacy rows remain visible to the owner only.
4. Make `user_id` `NOT NULL` and default nothing (app supplies it).
5. New policies (all `TO authenticated`):
   - `SELECT`: `user_id = auth.uid() OR public.manages_user(auth.uid(), user_id) OR public.is_owner(auth.uid())`
   - `INSERT` `WITH CHECK`: `user_id = auth.uid() OR public.is_owner(auth.uid())`
   - `UPDATE` `USING`/`WITH CHECK`: same expression as SELECT / INSERT respectively
   - `DELETE` `USING`: same as SELECT
6. `settings` is per-user — restrict SELECT/UPDATE/DELETE to `user_id = auth.uid() OR is_owner(auth.uid())` (managers don't need staff device settings).

### 2. Client code cleanup
- `src/routes/index.tsx`, `src/routes/atlas.tsx`, `src/routes/leads.tsx`: keep `device_id` for grouping but stop filtering queries by device — rely on RLS. Ensure every insert path sets `user_id` to the current session user (block insert if no session, since auth is required).
- `src/lib/device.ts`: unchanged (still used for `device_id` metadata).
- No UI copy changes required.

### 3. Verification
- Run `supabase--linter` after migration.
- Log in as owner → sees all leads/runs.
- Confirm existing (pre-auth) rows are attributed to the owner and remain visible.

## Out of scope
- Manager ↔ staff assignment UI (`profiles.manager_id` is already writable by owners via existing profile policy; assigning managers to staff can be a follow-up).
- Changes to `authorized_emails`, `profiles`, `user_roles`, `audit_log` policies (already role-scoped correctly).
