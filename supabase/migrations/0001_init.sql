-- Carpool: initial schema, Row Level Security, triggers and RPCs.
-- Every privacy rule is enforced here, not only in the UI.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- True when the statement is being executed directly through the API as an
-- end user (PostgREST switches to the `authenticated` or `anon` role). Inside a
-- SECURITY DEFINER function the current user is the function owner, so the
-- trusted server-side code paths skip the per-user restrictions.
create or replace function public.is_api_user()
returns boolean
language sql stable
set search_path = public, pg_temp
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- Everything a parent should never show to other parents lives in its own
-- table so a simple "owner only" policy covers it.
create table public.profile_private (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone text not null check (char_length(btrim(phone)) between 3 and 40),
  home_address text not null check (char_length(btrim(home_address)) between 1 and 300),
  car_make text check (car_make is null or char_length(car_make) <= 60),
  car_color text check (car_color is null or char_length(car_color) <= 40),
  car_open_seats integer check (car_open_seats is null or car_open_seats between 0 and 12),
  updated_at timestamptz not null default now()
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles(id) on delete cascade,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 60),
  notes text check (notes is null or char_length(notes) <= 300),
  created_at timestamptz not null default now()
);
create index children_parent_idx on public.children(parent_id);

create type public.connection_status as enum ('pending', 'accepted');

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status public.connection_status not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
-- One connection per pair of parents, whichever direction it was sent.
create unique index connections_pair_idx
  on public.connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index connections_addressee_idx on public.connections(addressee_id);

create table public.places (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  address text not null check (char_length(btrim(address)) between 1 and 300),
  created_at timestamptz not null default now()
);
create index places_owner_idx on public.places(owner_id);

create type public.ride_status as enum ('scheduled', 'in_progress', 'finished', 'cancelled');

create table public.rides (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  series_id uuid,
  destination_name text not null check (char_length(btrim(destination_name)) between 1 and 80),
  destination_address text not null check (char_length(btrim(destination_address)) between 1 and 300),
  starts_at timestamptz not null,
  status public.ride_status not null default 'scheduled',
  -- The account responsible for driving. Only ever set to the caller's own id.
  driver_id uuid references public.profiles(id) on delete set null,
  -- Per-ride driver details (may describe a babysitter etc.).
  driver_name text check (driver_name is null or char_length(btrim(driver_name)) between 1 and 80),
  driver_phone text check (driver_phone is null or char_length(btrim(driver_phone)) between 3 and 40),
  driver_car text check (driver_car is null or char_length(driver_car) <= 120),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (driver_id is null and driver_name is null and driver_phone is null and driver_car is null)
    or (driver_id is not null and driver_name is not null and driver_phone is not null)
  )
);
create index rides_creator_idx on public.rides(creator_id);
create index rides_driver_idx on public.rides(driver_id);
create index rides_starts_idx on public.rides(starts_at);

create type public.rider_status as enum ('pending', 'accepted', 'declined');

create table public.ride_riders (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  -- Denormalised from children.parent_id (set by trigger) so policies are cheap.
  parent_id uuid not null references public.profiles(id) on delete cascade,
  status public.rider_status not null default 'pending',
  invited_by uuid not null references public.profiles(id) on delete cascade,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, child_id)
);
create index ride_riders_parent_idx on public.ride_riders(parent_id);
create index ride_riders_ride_idx on public.ride_riders(ride_id);

create type public.stop_kind as enum ('pickup', 'destination', 'dropoff');

create table public.ride_stops (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  position integer not null check (position >= 0),
  kind public.stop_kind not null,
  child_id uuid references public.children(id) on delete cascade,
  planned_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (ride_id, position),
  check (
    (kind = 'destination' and child_id is null)
    or (kind <> 'destination' and child_id is not null)
  )
);
create index ride_stops_ride_idx on public.ride_stops(ride_id);
-- Home addresses are NOT stored on stops. They are resolved at read time by
-- get_ride_stops() / the driver-link functions, which apply the privacy rule.

create table public.driver_links (
  id uuid primary key default gen_random_uuid(),
  ride_id uuid not null references public.rides(id) on delete cascade,
  token text not null unique,
  created_by uuid not null references public.profiles(id) on delete cascade,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index driver_links_ride_idx on public.driver_links(ride_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  ride_id uuid references public.rides(id) on delete cascade,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);

-- Realtime: UPDATE/DELETE events carry the full old row so filters work.
alter table public.ride_stops replica identity full;
alter table public.rides replica identity full;
alter table public.ride_riders replica identity full;
alter table public.notifications replica identity full;

-- ---------------------------------------------------------------------------
-- Access helper functions (SECURITY DEFINER so policies never recurse)
-- ---------------------------------------------------------------------------

create or replace function public.are_connected(a uuid, b uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select a is not null and b is not null and (a = b or exists (
    select 1 from public.connections c
    where c.status = 'accepted'
      and ((c.requester_id = a and c.addressee_id = b) or (c.requester_id = b and c.addressee_id = a))
  ));
$$;

-- A participant is the creator, the driver, or a parent whose child was
-- invited (pending or accepted). Declined invites drop you out.
create or replace function public.is_ride_participant(p_ride uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1 from public.rides r
    where r.id = p_ride
      and (r.creator_id = p_user or r.driver_id = p_user
           or exists (select 1 from public.ride_riders rr
                      where rr.ride_id = r.id and rr.parent_id = p_user and rr.status <> 'declined'))
  );
$$;

create or replace function public.can_see_child(p_child uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_user is not null and exists (
    select 1 from public.children ch
    where ch.id = p_child
      and (ch.parent_id = p_user
           or public.are_connected(p_user, ch.parent_id)
           or exists (select 1 from public.ride_riders rr
                      where rr.child_id = ch.id and public.is_ride_participant(rr.ride_id, p_user)))
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profile_private enable row level security;
alter table public.children enable row level security;
alter table public.connections enable row level security;
alter table public.places enable row level security;
alter table public.rides enable row level security;
alter table public.ride_riders enable row level security;
alter table public.ride_stops enable row level security;
alter table public.driver_links enable row level security;
alter table public.notifications enable row level security;

-- profiles: names are searchable by any signed-in parent. Nothing else is here.
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- profile_private: owner only. Addresses reach drivers via get_ride_stops().
create policy profile_private_all on public.profile_private for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- children
create policy children_select on public.children for select to authenticated
  using (public.can_see_child(id, auth.uid()));
create policy children_insert on public.children for insert to authenticated with check (parent_id = auth.uid());
create policy children_update on public.children for update to authenticated using (parent_id = auth.uid()) with check (parent_id = auth.uid());
create policy children_delete on public.children for delete to authenticated using (parent_id = auth.uid());

-- connections
create policy connections_select on public.connections for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
create policy connections_insert on public.connections for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');
create policy connections_update on public.connections for update to authenticated
  using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
create policy connections_delete on public.connections for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- places
create policy places_all on public.places for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- rides
-- The direct creator/driver checks let INSERT ... RETURNING see the new row;
-- the function covers parents of invited kids.
create policy rides_select on public.rides for select to authenticated
  using (creator_id = auth.uid() or driver_id = auth.uid() or public.is_ride_participant(id, auth.uid()));
create policy rides_insert on public.rides for insert to authenticated with check (creator_id = auth.uid());
create policy rides_update on public.rides for update to authenticated
  using (public.is_ride_participant(id, auth.uid())) with check (public.is_ride_participant(id, auth.uid()));
create policy rides_delete on public.rides for delete to authenticated using (creator_id = auth.uid());

-- ride_riders
create policy ride_riders_select on public.ride_riders for select to authenticated
  using (public.is_ride_participant(ride_id, auth.uid()));
create policy ride_riders_insert on public.ride_riders for insert to authenticated
  with check (exists (select 1 from public.rides r where r.id = ride_id and r.creator_id = auth.uid()));
create policy ride_riders_update on public.ride_riders for update to authenticated
  using (parent_id = auth.uid()) with check (parent_id = auth.uid());
create policy ride_riders_delete on public.ride_riders for delete to authenticated
  using (parent_id = auth.uid() or exists (select 1 from public.rides r where r.id = ride_id and r.creator_id = auth.uid()));

-- ride_stops
create policy ride_stops_select on public.ride_stops for select to authenticated
  using (public.is_ride_participant(ride_id, auth.uid()));
create policy ride_stops_insert on public.ride_stops for insert to authenticated
  with check (exists (select 1 from public.rides r where r.id = ride_id and r.creator_id = auth.uid() and r.status = 'scheduled'));
create policy ride_stops_update on public.ride_stops for update to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id and (r.creator_id = auth.uid() or r.driver_id = auth.uid())))
  with check (exists (select 1 from public.rides r where r.id = ride_id and (r.creator_id = auth.uid() or r.driver_id = auth.uid())));
create policy ride_stops_delete on public.ride_stops for delete to authenticated
  using (exists (select 1 from public.rides r where r.id = ride_id and r.creator_id = auth.uid() and r.status = 'scheduled'));

-- driver_links: only the parent who generated a link can ever read its token.
create policy driver_links_select on public.driver_links for select to authenticated using (created_by = auth.uid());
create policy driver_links_insert on public.driver_links for insert to authenticated
  with check (created_by = auth.uid()
              and exists (select 1 from public.rides r where r.id = ride_id and r.driver_id = auth.uid()
                          and r.status in ('scheduled', 'in_progress')));
create policy driver_links_update on public.driver_links for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy driver_links_delete on public.driver_links for delete to authenticated using (created_by = auth.uid());

-- notifications: read/mark your own. Only triggers create them.
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Triggers: business rules that must hold no matter which client writes
-- ---------------------------------------------------------------------------

create or replace function public.notify(p_user uuid, p_ride uuid, p_body text)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  insert into public.notifications (user_id, ride_id, body) values (p_user, p_ride, p_body);
$$;

-- profile_private.updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger profile_private_touch before update on public.profile_private
  for each row execute function public.touch_updated_at();

-- connections: the addressee can only move pending -> accepted.
create or replace function public.connections_before_update()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_api_user() then
    if new.requester_id <> old.requester_id or new.addressee_id <> old.addressee_id then
      raise exception 'Cannot change who a connection is between';
    end if;
    if not (old.status = 'pending' and new.status = 'accepted') then
      raise exception 'A connection request can only be accepted (or deleted to decline)';
    end if;
  end if;
  if new.status = 'accepted' and old.status <> 'accepted' then
    new.responded_at := now();
  end if;
  return new;
end $$;
create trigger connections_before_update before update on public.connections
  for each row execute function public.connections_before_update();

create or replace function public.connections_after_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_name text;
begin
  if tg_op = 'INSERT' then
    select name into v_name from public.profiles where id = new.requester_id;
    perform public.notify(new.addressee_id, null, coalesce(v_name, 'A parent') || ' wants to connect with you');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status <> 'accepted' then
    select name into v_name from public.profiles where id = new.addressee_id;
    perform public.notify(new.requester_id, null, coalesce(v_name, 'A parent') || ' accepted your connection request');
  end if;
  return new;
end $$;
create trigger connections_after_change after insert or update on public.connections
  for each row execute function public.connections_after_change();

-- rides: insert
create or replace function public.rides_before_insert()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_api_user() then
    new.creator_id := auth.uid();
    new.status := 'scheduled';
    new.started_at := null;
    new.finished_at := null;
    -- The creator may volunteer themselves, and only themselves.
    if new.driver_id is not null and new.driver_id <> auth.uid() then
      raise exception 'You can only volunteer yourself as the driver';
    end if;
  end if;
  if new.driver_id is not null then
    new.driver_name := nullif(btrim(new.driver_name), '');
    new.driver_phone := nullif(btrim(new.driver_phone), '');
    new.driver_car := nullif(btrim(coalesce(new.driver_car, '')), '');
    if new.driver_name is null or new.driver_phone is null then
      raise exception 'Driver name and phone are required';
    end if;
  end if;
  return new;
end $$;
create trigger rides_before_insert before insert on public.rides
  for each row execute function public.rides_before_insert();

-- rides: update. This is where "nobody can be assigned as driver by someone
-- else" is enforced for every client, including the SQL editor used as a
-- normal user.
create or replace function public.rides_before_update()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare me uuid := auth.uid();
begin
  if public.is_api_user() then
    if new.creator_id <> old.creator_id or new.created_at <> old.created_at then
      raise exception 'Cannot change the ride creator';
    end if;
    new.started_at := old.started_at;
    new.finished_at := old.finished_at;

    -- Driver assignment
    if new.driver_id is distinct from old.driver_id then
      if new.driver_id is not null then
        if old.driver_id is not null then
          raise exception 'This ride already has a driver';
        end if;
        if new.driver_id <> me then
          raise exception 'Only the person volunteering can become the driver';
        end if;
        if old.status <> 'scheduled' then
          raise exception 'This ride is no longer open for a driver';
        end if;
      else
        if old.driver_id <> me then
          raise exception 'Only the driver can step down';
        end if;
        if old.status <> 'scheduled' then
          raise exception 'The driver cannot step down after the ride has started';
        end if;
      end if;
    end if;

    -- Driver details (when the driver is not changing; assignment is handled above)
    if new.driver_id is not distinct from old.driver_id
       and (new.driver_name is distinct from old.driver_name
        or new.driver_phone is distinct from old.driver_phone
        or new.driver_car is distinct from old.driver_car) then
      if new.driver_id is null or new.driver_id <> me then
        raise exception 'Only the driver can change the driver details';
      end if;
      if new.status in ('finished', 'cancelled') then
        raise exception 'This ride is over';
      end if;
    end if;

    -- Ride details
    if (new.destination_name <> old.destination_name
        or new.destination_address <> old.destination_address
        or new.starts_at <> old.starts_at
        or new.series_id is distinct from old.series_id) then
      if old.creator_id <> me then
        raise exception 'Only the ride creator can edit the ride';
      end if;
      if old.status <> 'scheduled' then
        raise exception 'The ride can no longer be edited';
      end if;
    end if;

    -- Status transitions
    if new.status <> old.status then
      if new.status = 'in_progress' then
        if old.status <> 'scheduled' then raise exception 'Ride cannot be started'; end if;
        if old.driver_id is null or old.driver_id <> me then
          raise exception 'Only the driver can start the ride';
        end if;
      elsif new.status = 'finished' then
        if old.status not in ('scheduled', 'in_progress') then raise exception 'Ride cannot be finished'; end if;
        if old.driver_id is null or old.driver_id <> me then
          raise exception 'Only the driver can finish the ride';
        end if;
      elsif new.status = 'cancelled' then
        if old.status not in ('scheduled', 'in_progress') then raise exception 'Ride cannot be cancelled'; end if;
        if old.creator_id <> me then
          raise exception 'Only the ride creator can cancel the ride';
        end if;
      else
        raise exception 'Invalid status change';
      end if;
    end if;
  end if;

  if new.driver_id is not null then
    new.driver_name := nullif(btrim(new.driver_name), '');
    new.driver_phone := nullif(btrim(new.driver_phone), '');
    new.driver_car := nullif(btrim(coalesce(new.driver_car, '')), '');
    if new.driver_name is null or new.driver_phone is null then
      raise exception 'Driver name and phone are required';
    end if;
  else
    new.driver_name := null; new.driver_phone := null; new.driver_car := null;
  end if;

  if new.status = 'in_progress' and old.status <> 'in_progress' then
    new.started_at := coalesce(new.started_at, now());
  end if;
  if new.status in ('finished', 'cancelled') and old.status not in ('finished', 'cancelled') then
    new.finished_at := coalesce(new.finished_at, now());
  end if;
  return new;
end $$;
create trigger rides_before_update before update on public.rides
  for each row execute function public.rides_before_update();

create or replace function public.rides_after_update()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare p record;
begin
  if new.driver_id is not null and old.driver_id is null then
    for p in select distinct rr.parent_id from public.ride_riders rr
             where rr.ride_id = new.id and rr.status <> 'declined' and rr.parent_id <> new.driver_id
             union select new.creator_id where new.creator_id <> new.driver_id loop
      perform public.notify(p.parent_id, new.id, new.driver_name || ' is driving to ' || new.destination_name);
    end loop;
  elsif new.driver_id is null and old.driver_id is not null and new.status = 'scheduled' then
    for p in select distinct rr.parent_id from public.ride_riders rr
             where rr.ride_id = new.id and rr.status <> 'declined'
             union select new.creator_id loop
      if p.parent_id <> old.driver_id then
        perform public.notify(p.parent_id, new.id, 'The ride to ' || new.destination_name || ' needs a driver again');
      end if;
    end loop;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    for p in select distinct rr.parent_id from public.ride_riders rr
             where rr.ride_id = new.id and rr.status <> 'declined' and rr.parent_id <> new.creator_id loop
      perform public.notify(p.parent_id, new.id, 'The ride to ' || new.destination_name || ' was cancelled');
    end loop;
  end if;
  return new;
end $$;
create trigger rides_after_update after update on public.rides
  for each row execute function public.rides_after_update();

-- ride_riders: insert
create or replace function public.ride_riders_before_insert()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare v_parent uuid; v_ride public.rides%rowtype;
begin
  select parent_id into v_parent from public.children where id = new.child_id;
  if v_parent is null then raise exception 'You can only add your own kids or kids of connected parents'; end if;
  new.parent_id := v_parent;
  select * into v_ride from public.rides where id = new.ride_id;
  if public.is_api_user() then
    new.invited_by := auth.uid();
    if v_ride.status <> 'scheduled' then
      raise exception 'Riders can only be added before the ride starts';
    end if;
    if v_parent <> auth.uid() and not public.are_connected(auth.uid(), v_parent) then
      raise exception 'You can only add your own kids or kids of connected parents';
    end if;
  end if;
  -- Your own kid needs no acceptance; another parent's kid does.
  if new.parent_id = new.invited_by then
    new.status := 'accepted';
    new.responded_at := now();
  else
    new.status := 'pending';
    new.responded_at := null;
  end if;
  return new;
end $$;
create trigger ride_riders_before_insert before insert on public.ride_riders
  for each row execute function public.ride_riders_before_insert();

create or replace function public.ride_riders_before_update()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_api_user() then
    if new.ride_id <> old.ride_id or new.child_id <> old.child_id or new.parent_id <> old.parent_id
       or new.invited_by <> old.invited_by then
      raise exception 'Only the invite status can change';
    end if;
    if new.status not in ('accepted', 'declined') then
      raise exception 'Invites can only be accepted or declined';
    end if;
  end if;
  if new.status <> old.status then new.responded_at := now(); end if;
  return new;
end $$;
create trigger ride_riders_before_update before update on public.ride_riders
  for each row execute function public.ride_riders_before_update();

create or replace function public.ride_riders_after_change()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ride public.rides%rowtype; v_child text; v_inviter text; v_parent text;
begin
  select * into v_ride from public.rides where id = new.ride_id;
  select first_name into v_child from public.children where id = new.child_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select name into v_inviter from public.profiles where id = new.invited_by;
    perform public.notify(new.parent_id, new.ride_id,
      coalesce(v_inviter, 'A parent') || ' invited ' || v_child || ' to a ride to ' || v_ride.destination_name);
  elsif tg_op = 'UPDATE' and new.status <> old.status and new.parent_id <> v_ride.creator_id then
    select name into v_parent from public.profiles where id = new.parent_id;
    perform public.notify(v_ride.creator_id, new.ride_id,
      coalesce(v_parent, 'A parent') || case when new.status = 'accepted' then ' accepted' else ' declined' end
      || ' the ride invite for ' || v_child);
  end if;
  return new;
end $$;
create trigger ride_riders_after_change after insert or update on public.ride_riders
  for each row execute function public.ride_riders_after_change();

-- ride_stops
create or replace function public.ride_stops_before_write()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
declare v_ride public.rides%rowtype; me uuid := auth.uid();
begin
  select * into v_ride from public.rides where id = new.ride_id;
  if tg_op = 'INSERT' then
    if public.is_api_user() then new.completed_at := null; end if;
    if new.child_id is not null and not exists (
        select 1 from public.ride_riders rr where rr.ride_id = new.ride_id and rr.child_id = new.child_id) then
      raise exception 'Every pickup/drop-off must belong to a rider on this ride';
    end if;
    return new;
  end if;
  if public.is_api_user() then
    if new.ride_id <> old.ride_id then raise exception 'Cannot move a stop to another ride'; end if;
    if new.completed_at is distinct from old.completed_at then
      if v_ride.driver_id is null or v_ride.driver_id <> me then
        raise exception 'Only the driver can check off stops';
      end if;
      if v_ride.status <> 'in_progress' then
        raise exception 'Start the ride before checking off stops';
      end if;
      -- The check-off time is always "now"; clients cannot backdate it.
      if new.completed_at is not null then new.completed_at := now(); end if;
    end if;
    if (new.position <> old.position or new.kind <> old.kind or new.child_id is distinct from old.child_id
        or new.planned_at <> old.planned_at) then
      if v_ride.creator_id <> me then raise exception 'Only the ride creator can edit stops'; end if;
      if v_ride.status <> 'scheduled' then raise exception 'Stops can no longer be edited'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger ride_stops_before_write before insert or update on public.ride_stops
  for each row execute function public.ride_stops_before_write();

-- After a check-off: notify the parent on drop-off, and finish the ride once
-- every stop is done.
create or replace function public.ride_stops_after_update()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_child record; v_ride public.rides%rowtype; v_remaining integer;
begin
  if new.completed_at is not null and old.completed_at is null then
    select * into v_ride from public.rides where id = new.ride_id;
    if new.kind = 'dropoff' then
      select ch.first_name, ch.parent_id into v_child from public.children ch where ch.id = new.child_id;
      perform public.notify(v_child.parent_id, new.ride_id, v_child.first_name || ' was dropped off');
    elsif new.kind = 'pickup' then
      select ch.first_name, ch.parent_id into v_child from public.children ch where ch.id = new.child_id;
      if v_child.parent_id <> coalesce(v_ride.driver_id, '00000000-0000-0000-0000-000000000000'::uuid) then
        perform public.notify(v_child.parent_id, new.ride_id, v_child.first_name || ' was picked up');
      end if;
    end if;
    select count(*) into v_remaining from public.ride_stops where ride_id = new.ride_id and completed_at is null;
    if v_remaining = 0 and v_ride.status = 'in_progress' then
      update public.rides set status = 'finished', finished_at = now() where id = new.ride_id;
    end if;
  end if;
  return new;
end $$;
create trigger ride_stops_after_update after update on public.ride_stops
  for each row execute function public.ride_stops_after_update();

-- driver_links: tokens are generated server-side and never chosen by clients.
create or replace function public.driver_links_before_insert()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.token := encode(gen_random_bytes(24), 'hex');
  new.revoked_at := null;
  if public.is_api_user() then new.created_by := auth.uid(); end if;
  return new;
end $$;
create trigger driver_links_before_insert before insert on public.driver_links
  for each row execute function public.driver_links_before_insert();

create or replace function public.driver_links_before_update()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if public.is_api_user() then
    if new.token <> old.token or new.ride_id <> old.ride_id or new.created_by <> old.created_by then
      raise exception 'Only revocation is allowed';
    end if;
    if old.revoked_at is not null then new.revoked_at := old.revoked_at; end if;
  end if;
  return new;
end $$;
create trigger driver_links_before_update before update on public.driver_links
  for each row execute function public.driver_links_before_update();

-- ---------------------------------------------------------------------------
-- RPCs used by the app
-- ---------------------------------------------------------------------------

-- Search other parents by name. Returns name + connection state only.
create or replace function public.search_parents(q text)
returns table (id uuid, name text, connection_id uuid, connection_status text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.name, c.id,
    case
      when c.id is null then 'none'
      when c.status = 'accepted' then 'accepted'
      when c.requester_id = auth.uid() then 'pending_out'
      else 'pending_in'
    end
  from public.profiles p
  left join public.connections c
    on (c.requester_id = p.id and c.addressee_id = auth.uid())
    or (c.addressee_id = p.id and c.requester_id = auth.uid())
  where auth.uid() is not null
    and p.id <> auth.uid()
    and char_length(btrim(q)) >= 2
    and p.name ilike '%' || replace(replace(btrim(q), '%', '\%'), '_', '\_') || '%'
  order by p.name
  limit 20;
$$;

-- Create a ride (optionally repeating weekly) with its riders and stops in one
-- transaction. Runs as the caller, so RLS and triggers apply.
-- stops: [{kind, child_id, planned_at}] in order.
create or replace function public.create_ride(
  p_destination_name text,
  p_destination_address text,
  p_starts_at timestamptz,
  p_stops jsonb,
  p_repeat_weeks integer default 1,
  p_volunteer boolean default false,
  p_driver_name text default null,
  p_driver_phone text default null,
  p_driver_car text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_series uuid := null;
  v_first uuid;
  v_ride uuid;
  v_week integer;
  v_stop jsonb;
  v_pos integer;
  v_shift interval;
  v_child uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) < 1 then
    raise exception 'A ride needs at least one stop';
  end if;
  if not exists (select 1 from jsonb_array_elements(p_stops) s where s->>'kind' = 'destination') then
    raise exception 'A ride needs a destination stop';
  end if;
  if (select count(*) from jsonb_array_elements(p_stops) s where s->>'kind' <> 'destination') < 1 then
    raise exception 'A ride needs at least one rider';
  end if;
  p_repeat_weeks := greatest(1, least(coalesce(p_repeat_weeks, 1), 26));
  if p_repeat_weeks > 1 then v_series := gen_random_uuid(); end if;

  for v_week in 0 .. p_repeat_weeks - 1 loop
    v_shift := make_interval(days => 7 * v_week);
    insert into public.rides (creator_id, series_id, destination_name, destination_address, starts_at,
                              driver_id, driver_name, driver_phone, driver_car)
    values (auth.uid(), v_series, p_destination_name, p_destination_address, p_starts_at + v_shift,
            case when p_volunteer then auth.uid() end,
            case when p_volunteer then p_driver_name end,
            case when p_volunteer then p_driver_phone end,
            case when p_volunteer then p_driver_car end)
    returning id into v_ride;
    if v_first is null then v_first := v_ride; end if;

    for v_child in select distinct (s->>'child_id')::uuid from jsonb_array_elements(p_stops) s
                   where s->>'kind' <> 'destination' loop
      insert into public.ride_riders (ride_id, child_id, parent_id, invited_by)
      values (v_ride, v_child, auth.uid(), auth.uid());
    end loop;

    v_pos := 0;
    for v_stop in select s from jsonb_array_elements(p_stops) s loop
      insert into public.ride_stops (ride_id, position, kind, child_id, planned_at)
      values (v_ride, v_pos, (v_stop->>'kind')::public.stop_kind,
              case when v_stop->>'kind' = 'destination' then null else (v_stop->>'child_id')::uuid end,
              (v_stop->>'planned_at')::timestamptz + v_shift);
      v_pos := v_pos + 1;
    end loop;
  end loop;
  return v_first;
end $$;

-- Stops for a ride, with addresses resolved under the privacy rule:
--   * destination address: every participant
--   * a family's home address: the driver only, and only until the ride ends.
create or replace function public.get_ride_stops(p_ride uuid)
returns table (
  id uuid, ride_id uuid, "position" integer, kind public.stop_kind, child_id uuid,
  child_name text, child_notes text, parent_id uuid, parent_name text,
  planned_at timestamptz, completed_at timestamptz, address text
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select s.id, s.ride_id, s.position, s.kind, s.child_id,
    ch.first_name, ch.notes, ch.parent_id, pp.name,
    s.planned_at, s.completed_at,
    case
      when s.kind = 'destination' then r.destination_address
      when r.driver_id is not null and r.driver_id = auth.uid() and r.status in ('scheduled', 'in_progress')
        then priv.home_address
      else null
    end
  from public.ride_stops s
  join public.rides r on r.id = s.ride_id
  left join public.children ch on ch.id = s.child_id
  left join public.profiles pp on pp.id = ch.parent_id
  left join public.profile_private priv on priv.user_id = ch.parent_id
  where s.ride_id = p_ride
    and public.is_ride_participant(p_ride, auth.uid())
  order by s.position;
$$;

create or replace function public.volunteer_to_drive(p_ride uuid, p_name text, p_phone text, p_car text default null)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.rides set driver_id = auth.uid(), driver_name = p_name, driver_phone = p_phone, driver_car = p_car
  where id = p_ride;
  if not found then raise exception 'Ride not found'; end if;
end $$;

create or replace function public.update_driver_details(p_ride uuid, p_name text, p_phone text, p_car text default null)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.rides set driver_name = p_name, driver_phone = p_phone, driver_car = p_car where id = p_ride;
  if not found then raise exception 'Ride not found'; end if;
end $$;

create or replace function public.step_down_as_driver(p_ride uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.rides set driver_id = null, driver_name = null, driver_phone = null, driver_car = null where id = p_ride;
  if not found then raise exception 'Ride not found'; end if;
end $$;

create or replace function public.start_ride(p_ride uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.rides set status = 'in_progress' where id = p_ride;
  if not found then raise exception 'Ride not found'; end if;
end $$;

create or replace function public.finish_ride(p_ride uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.rides set status = 'finished' where id = p_ride;
  if not found then raise exception 'Ride not found'; end if;
end $$;

create or replace function public.cancel_ride(p_ride uuid)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.rides set status = 'cancelled' where id = p_ride;
  if not found then raise exception 'Ride not found'; end if;
end $$;

create or replace function public.set_stop_completed(p_stop uuid, p_completed boolean)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.ride_stops set completed_at = case when p_completed then now() end where id = p_stop;
  if not found then raise exception 'Stop not found'; end if;
end $$;

create or replace function public.respond_to_ride_invite(p_ride uuid, p_child uuid, p_accept boolean)
returns void language plpgsql set search_path = public, pg_temp as $$
begin
  update public.ride_riders set status = case when p_accept then 'accepted'::public.rider_status else 'declined' end
  where ride_id = p_ride and child_id = p_child and parent_id = auth.uid();
  if not found then raise exception 'Invite not found'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Driver link (no account). All SECURITY DEFINER, validated by token.
-- ---------------------------------------------------------------------------

create or replace function public.driver_link_ride(p_token text)
returns uuid
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_ride uuid;
begin
  if p_token is null or char_length(p_token) <> 48 then
    raise exception 'This driver link is not valid' using errcode = 'P0002';
  end if;
  select l.ride_id into v_ride
  from public.driver_links l
  join public.rides r on r.id = l.ride_id
  where l.token = p_token and l.revoked_at is null and r.status in ('scheduled', 'in_progress');
  if v_ride is null then
    raise exception 'This driver link is no longer active' using errcode = 'P0002';
  end if;
  return v_ride;
end $$;

create or replace function public.driver_link_view(p_token text)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare v_ride uuid := public.driver_link_ride(p_token);
begin
  return jsonb_build_object(
    'ride', (select jsonb_build_object(
        'id', r.id, 'destination_name', r.destination_name, 'destination_address', r.destination_address,
        'starts_at', r.starts_at, 'status', r.status, 'started_at', r.started_at,
        'driver_name', r.driver_name)
      from public.rides r where r.id = v_ride),
    'stops', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'position', s.position, 'kind', s.kind,
        'child_name', ch.first_name, 'child_notes', ch.notes, 'parent_name', pp.name,
        'planned_at', s.planned_at, 'completed_at', s.completed_at,
        'address', case when s.kind = 'destination' then r.destination_address else priv.home_address end
      ) order by s.position), '[]'::jsonb)
      from public.ride_stops s
      join public.rides r on r.id = s.ride_id
      left join public.children ch on ch.id = s.child_id
      left join public.profiles pp on pp.id = ch.parent_id
      left join public.profile_private priv on priv.user_id = ch.parent_id
      where s.ride_id = v_ride)
  );
end $$;

create or replace function public.driver_link_start(p_token text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ride uuid := public.driver_link_ride(p_token);
begin
  update public.rides set status = 'in_progress', started_at = now() where id = v_ride and status = 'scheduled';
end $$;

create or replace function public.driver_link_set_stop(p_token text, p_stop uuid, p_completed boolean)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ride uuid := public.driver_link_ride(p_token);
begin
  if (select status from public.rides where id = v_ride) <> 'in_progress' then
    raise exception 'Start the ride before checking off stops';
  end if;
  update public.ride_stops set completed_at = case when p_completed then now() end
  where id = p_stop and ride_id = v_ride;
  if not found then raise exception 'Stop not found'; end if;
end $$;

create or replace function public.driver_link_finish(p_token text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_ride uuid := public.driver_link_ride(p_token);
begin
  update public.rides set status = 'finished', finished_at = now() where id = v_ride;
end $$;

-- Driver-link functions must be callable without a session; everything else
-- requires a signed-in parent and does nothing useful for anon anyway.
grant execute on function public.driver_link_view(text) to anon, authenticated;
grant execute on function public.driver_link_start(text) to anon, authenticated;
grant execute on function public.driver_link_set_stop(text, uuid, boolean) to anon, authenticated;
grant execute on function public.driver_link_finish(text) to anon, authenticated;
revoke execute on function public.driver_link_ride(text) from public, anon, authenticated;
revoke execute on function public.notify(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.ride_stops, public.rides, public.ride_riders, public.notifications;
