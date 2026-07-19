## Goal

Make the app login-first. Every user (owner, manager, field staff) signs in with their email + password before seeing anything. Unauthenticated visitors only see the login page.

## Behavior

- Visiting any URL while signed out redirects to `/auth`.
- `/auth` shows a clean login form: **Email** + **Password** + Sign in.
- Successful sign-in redirects to `/` (Run tab), or back to the page they tried to open.
- The Profile page gets a **Sign out** button.
- On sign-out, cache is cleared and the user is returned to `/auth`.

## Password rules

Supabase enforces a minimum password length of **6 characters**, so `12345` will be rejected when creating users. Two options:

- **Recommended:** change default password to `123456` (6 chars).
- Alternative: keep `12345` — I'll only be able to do this if you're OK relaxing the Supabase minimum; not all projects allow lowering it below 6.

I'll go with `123456` unless you say otherwise.

## What changes

### 1. Route structure
- Create `src/routes/_authenticated/route.tsx` — pathless layout that redirects to `/auth` when there's no Supabase session.
- Move every current app route file into `src/routes/_authenticated/`:
  - `index.tsx`, `atlas.tsx`, `leads.tsx`, `leads.$id.tsx`, `profile.tsx`, `settings.tsx`, `admin.users.tsx`, `simulator.tsx`, `simulator.$id.tsx`
- `/auth` stays public.

### 2. Login page (`src/routes/auth.tsx`)
- Replace the current redirect stub with a real form.
- Email + password inputs, validated with zod (email format, password ≥ 6).
- Calls `supabase.auth.signInWithPassword`.
- Shows friendly error for wrong credentials.
- If already signed in, redirects to `/`.
- Optional "Forgot password?" text — for now just tells the user to ask their owner/manager to reset it (matches existing "Reset to default password" flow in Admin).

### 3. Sign-out
- Add a **Sign out** button on `/profile`.
- Calls `queryClient.cancelQueries()` → `clear()` → `supabase.auth.signOut()` → navigate to `/auth` with `replace: true`.

### 4. Default password
- Update `DEFAULT_ACCESS_PASSWORD` in `src/lib/users.functions.ts` from `12345` to `123456`.
- Admin UI hint text and toasts already reference the constant, so they update automatically.

### 5. Owner bootstrap
- `chamalghosh.ai@gmail.com` is already the seeded owner in `authorized_emails` / `handle_new_user` trigger.
- I'll run one migration to (re)set that owner's auth password to `123456` so you can log in immediately with `chamalghosh.ai@gmail.com` / `123456`.

## What does NOT change

- RBAC and RLS policies stay exactly as they are.
- Admin > Users flow (create manager/staff, reset password) stays the same — just uses the new default password.
- Google sign-in is **removed from the flow** (email/password only), per your request that "email id is user id". Let me know if you also want the Google button kept as an option.

## Technical details

```text
src/routes/
├── auth.tsx                       ← public login page
└── _authenticated/
    ├── route.tsx                  ← redirect to /auth if no session
    ├── index.tsx                  (moved)
    ├── atlas.tsx                  (moved)
    ├── leads.tsx                  (moved)
    ├── leads.$id.tsx              (moved)
    ├── profile.tsx                (moved + Sign out button)
    ├── settings.tsx               (moved)
    ├── admin.users.tsx            (moved)
    ├── simulator.tsx              (moved)
    └── simulator.$id.tsx          (moved)
```

The `_authenticated` layout uses `ssr: false` + `supabase.auth.getUser()` in `beforeLoad`, matching Lovable's Supabase integration pattern. This avoids SSR redirect loops because the session is in browser localStorage.

Root `onAuthStateChange` in `__root.tsx` already invalidates the router on `SIGNED_IN` / `SIGNED_OUT` — I'll verify it's wired; if not, add it in the same pass.

Migration: `UPDATE auth.users SET encrypted_password = crypt('123456', gen_salt('bf')) WHERE email = 'chamalghosh.ai@gmail.com';` (Supabase supports this via the admin API — I'll actually use `supabaseAdmin.auth.admin.updateUserById` inside a one-shot server function, or a SQL migration using `crypt`, whichever is cleaner).

## Confirm before I build

1. OK with default password `123456` (6 chars) instead of `12345`?
2. Remove Google sign-in entirely, or keep it as a secondary button below email/password?
