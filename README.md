# Carpool

A mobile-first web app that helps parents share driving for their kids' activities.
Parents connect with each other, create rides with ordered stops, volunteer to drive,
and follow live check-off progress with a rough ETA. Nothing here uses a paid or keyed
API: no maps, geocoding or SMS.

**Stack:** Next.js (App Router) · Supabase (Auth, Postgres, Realtime) · Tailwind CSS.

Every privacy rule is enforced in Postgres with Row Level Security, triggers and
`SECURITY DEFINER` functions, not only in the UI. See `supabase/migrations/0001_init.sql`.

## Screens

| Route | What it does |
| --- | --- |
| `/login`, `/signup` | Email + password accounts |
| `/onboarding` | Name, phone, home address, car |
| `/` | Upcoming rides split into *Invitations*, *I'm driving*, *My kids are riding*, *Needs a driver*; past rides tab |
| `/rides/new` | Destination (saved place or new), date/time, riders, ordered stops with planned times, weekly repeat, volunteer to drive |
| `/rides/[id]` | Driver card with Call/Text, invite accept/decline, "I'll drive", live stop progress + ETA, check-off buttons for the driver, driver links, cancel |
| `/kids` | Children (first name + notes) |
| `/connections` | Search parents by name, requests, connected parents |
| `/places` | Saved places |
| `/profile` | Edit profile, log out |
| `/notifications` | In-app notifications (drop-offs, invites, driver changes) |
| `/drive/[token]` | Driver link page: stops and check-off buttons, no login |

## Setup

1. **Create a Supabase project** (free tier is fine). In *Authentication → Providers → Email*
   you can leave "Confirm email" on; the app handles both confirmed and unconfirmed sign-ups.
   Set *Authentication → URL configuration → Site URL* to where the app runs
   (e.g. `http://localhost:3000`) and add `http://localhost:3000/auth/callback` to the redirect URLs.
2. **Apply the migration.** Either paste `supabase/migrations/0001_init.sql` into the SQL editor,
   or with the Supabase CLI:
   ```bash
   npx supabase link --project-ref YOUR_REF
   npx supabase db push
   ```
   The migration also adds the tables to the `supabase_realtime` publication, which is what
   makes check-offs appear on other parents' phones without a refresh.
3. **Configure the app.**
   ```bash
   cp .env.example .env.local   # fill in NEXT_PUBLIC_SUPABASE_URL and the publishable key
   npm install
   npm run dev
   ```
   Open http://localhost:3000 on a phone-sized viewport (390px wide is the design target).

## Trying it with two parents

1. Sign up as Parent A and Parent B (two browsers or a private window). Complete onboarding
   and add a kid for each.
2. As A, go to *Friends*, search for B by name (results show names only), send a request.
   As B, accept it. Both now see each other's kids' first names, but not addresses or phones.
3. As A, create a ride and add B's kid. B gets an invitation on the home screen and accepts.
4. The ride shows "Needs a driver". Either parent taps **I'll drive** and confirms the driver
   name, phone and car (editable per ride, e.g. "Ana (our babysitter)"). The other parent sees
   the details with working **Call** and **Text** buttons.
5. The driver taps **Start ride** and checks off each stop. The other parent's ride screen
   updates within a couple of seconds via realtime, and the remaining times shift
   ("about 4:45 pm (running 5 min late)"). Drop-offs create a notification for that kid's parent.
6. The driver can also create a **driver link** and send it to whoever actually drives.
   It works for that ride only, and stops working once the ride is finished or the link is revoked.

## Privacy model (enforced in the database)

- `profiles` holds only a name. Phone, home address and car live in `profile_private`,
  readable by the owner alone.
- A home address is exposed only through `get_ride_stops()` / the driver-link functions,
  only to the driver of a ride that kid is on, only for that ride's stops, and only while the
  ride is scheduled or in progress.
- Rides, riders, stops and driver details are readable only by participants (creator,
  driver, parents of invited kids).
- Triggers make it impossible to set `driver_id` to anyone but yourself, to edit driver details
  unless you are the driver, to check off stops unless you are the driver and the ride has
  started, or to backdate a check-off.
- Driver links are 48-hex-character server-generated tokens; the anon role can only call the
  four `driver_link_*` functions, which validate the token and the ride status on every call.

## Verifying the rules without the UI

`supabase/tests/rls_test.sql` exercises every "done when" rule by switching to the
`authenticated` / `anon` roles with a JWT claim, exactly like PostgREST does. Run it against
a throwaway local Postgres (needs `initdb`, `pg_ctl`, `psql`; no Docker required):

```bash
./supabase/tests/run-local.sh
```

Or run the same checks against your Supabase project from the SQL editor by prefixing a
query with the role switch, for example:

```sql
begin;
select set_config('request.jwt.claims', '{"sub":"<some other parent's uuid>"}', true);
set local role authenticated;
select * from public.profile_private;   -- only their own row (or none)
select * from public.ride_stops;        -- only rides they are part of
rollback;
```

## Not in version 1

Kid accounts, live GPS, maps or drive-time APIs, chat, payments or gas splitting,
native app, calendar sync.
