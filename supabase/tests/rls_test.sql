-- Row Level Security and business-rule tests. Run by supabase/tests/run-local.sh.
-- Each section switches to the `authenticated` role with a JWT claim, exactly
-- like PostgREST does for a signed-in parent, or to `anon` for the driver link.
\set ON_ERROR_STOP on
\set QUIET on
\pset format unaligned
\pset tuples_only on

\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'

insert into auth.users (id, email) values (:'A', 'a@example.com'), (:'B', 'b@example.com'), (:'C', 'c@example.com');

-- Helper: expect a statement to fail. Usage: select expect_error($$ sql $$, 'label');
create or replace function public.expect_error(p_sql text, p_label text) returns text
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'TEST FAIL (%): expected an error but statement succeeded', p_label;
exception
  when others then
    if sqlerrm like 'TEST FAIL%' then raise; end if;
    return 'ok   ' || p_label || '  -> ' || sqlerrm;
end $$;
grant execute on function public.expect_error(text, text) to anon, authenticated;

-- ---------------------------------------------------------------- profiles
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
insert into public.profiles (id, name) values (:'A', 'Alice Adams');
insert into public.profile_private (user_id, phone, home_address, car_make, car_color, car_open_seats)
  values (:'A', '+1 914 555 0101', '12 Maple Lane, Scarsdale NY', 'Honda Odyssey', 'blue', 4);
insert into public.children (id, parent_id, first_name, notes) values
  ('aaaa1111-0000-0000-0000-000000000001', :'A', 'Maya', 'Needs booster seat');
insert into public.places (owner_id, name, address) values (:'A', 'Scarsdale Pool', '311 Mamaroneck Rd, Scarsdale NY');
select expect_error($$ insert into public.profiles (id, name) values ('22222222-2222-2222-2222-222222222222', 'Spoof') $$,
  'cannot create a profile for someone else');
commit;

begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
insert into public.profiles (id, name) values (:'B', 'Ben Brown');
insert into public.profile_private (user_id, phone, home_address) values (:'B', '+1 914 555 0202', '8 Oak Street, Scarsdale NY');
insert into public.children (id, parent_id, first_name) values ('bbbb2222-0000-0000-0000-000000000001', :'B', 'Sam');
commit;

begin;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
set local role authenticated;
insert into public.profiles (id, name) values (:'C', 'Cara Cole');
insert into public.profile_private (user_id, phone, home_address) values (:'C', '+1 914 555 0303', '99 Elm Ave, Scarsdale NY');
insert into public.children (id, parent_id, first_name) values ('cccc3333-0000-0000-0000-000000000001', :'C', 'Leo');
commit;

-- ---------------------------------------------------------- search privacy
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
do $$ begin
  assert (select count(*) from public.search_parents('ben')) = 1, 'search finds Ben by name';
  assert (select connection_status from public.search_parents('ben')) = 'none', 'no connection yet';
  -- The only private rows visible to A are A's own.
  assert (select count(*) from public.profile_private) = 1, 'A sees only own private row';
  assert (select user_id from public.profile_private) = '11111111-1111-1111-1111-111111111111', 'and it is A';
  -- The profiles table carries no address/phone columns at all.
  assert not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'profiles'
                       and column_name in ('phone', 'home_address', 'address')), 'profiles has no contact columns';
  assert (select count(*) from public.children) = 1, 'A sees only own kids before connecting';
end $$;
select 'ok   search shows name only, no address/phone, no kids';
commit;

-- ------------------------------------------------------------- connections
begin;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
insert into public.connections (id, requester_id, addressee_id) values ('c0000000-0000-0000-0000-000000000001', :'A', :'B');
select expect_error($$ insert into public.connections (requester_id, addressee_id, status)
  values ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', 'accepted') $$,
  'cannot create a pre-accepted connection');
select expect_error($$ insert into public.connections (requester_id, addressee_id)
  values ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333') $$,
  'cannot send a request on behalf of someone else');
commit;

begin;  -- C is not a party and sees nothing
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
set local role authenticated;
do $$ begin assert (select count(*) from public.connections) = 0, 'C cannot see A-B request'; end $$;
update public.connections set status = 'accepted' where id = 'c0000000-0000-0000-0000-000000000001';
do $$ begin assert (select count(*) from public.connections where status = 'accepted') = 0, 'C could not accept for B'; end $$;
select 'ok   third party cannot see or accept a connection request';
commit;

begin;  -- A (requester) cannot accept their own request
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
update public.connections set status = 'accepted' where id = 'c0000000-0000-0000-0000-000000000001';
do $$ begin assert (select status from public.connections where id = 'c0000000-0000-0000-0000-000000000001') = 'pending',
  'requester cannot self-accept'; end $$;
select 'ok   requester cannot accept their own request';
commit;

begin;  -- B accepts
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
do $$ begin assert (select count(*) from public.notifications) = 1, 'B was notified of the request'; end $$;
update public.connections set status = 'accepted' where id = 'c0000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select status from public.connections where id = 'c0000000-0000-0000-0000-000000000001') = 'accepted', 'accepted';
  assert (select count(*) from public.children where parent_id = '11111111-1111-1111-1111-111111111111') = 1,
    'B now sees A''s kid first name';
  assert (select count(*) from public.profile_private where user_id <> '22222222-2222-2222-2222-222222222222') = 0,
    'B still cannot see A''s address/phone';
end $$;
select 'ok   connection accepted; kids visible, address/phone not';
commit;

-- ------------------------------------------------------------------ rides
begin;  -- A creates a ride with Maya (own) and Sam (B's kid), repeating 2 weeks
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
select expect_error($$ select public.create_ride('Pool', '311 Mamaroneck Rd', '2030-06-01 16:00+00',
  '[{"kind":"pickup","child_id":"cccc3333-0000-0000-0000-000000000001","planned_at":"2030-06-01 15:40+00"},
    {"kind":"destination","planned_at":"2030-06-01 16:00+00"}]'::jsonb) $$,
  'cannot add a kid of a parent you are not connected to');
create temp table t_ride as select public.create_ride(
  'Scarsdale Pool', '311 Mamaroneck Rd, Scarsdale NY', '2030-06-01 16:00+00',
  '[{"kind":"pickup","child_id":"aaaa1111-0000-0000-0000-000000000001","planned_at":"2030-06-01 15:30+00"},
    {"kind":"pickup","child_id":"bbbb2222-0000-0000-0000-000000000001","planned_at":"2030-06-01 15:40+00"},
    {"kind":"destination","planned_at":"2030-06-01 16:00+00"},
    {"kind":"dropoff","child_id":"bbbb2222-0000-0000-0000-000000000001","planned_at":"2030-06-01 17:40+00"},
    {"kind":"dropoff","child_id":"aaaa1111-0000-0000-0000-000000000001","planned_at":"2030-06-01 17:50+00"}]'::jsonb,
  p_repeat_weeks => 2) as id;
grant select on t_ride to anon, authenticated;
do $$ begin
  assert (select count(*) from public.rides) = 2, 'two weekly occurrences';
  assert (select count(distinct series_id) from public.rides) = 1, 'same series';
  assert (select count(*) from public.ride_stops) = 10, '5 stops each';
  assert (select count(*) from public.ride_riders where status = 'accepted') = 2, 'own kid auto-accepted';
  assert (select count(*) from public.ride_riders where status = 'pending') = 2, 'B''s kid pending';
  assert (select starts_at from public.rides order by starts_at desc limit 1) = '2030-06-08 16:00+00', 'shifted by 7 days';
  assert (select driver_id from public.rides limit 1) is null, 'starts with no driver';
end $$;
select 'ok   ride created with riders, stops, weekly repeat';
commit;

begin;  -- C (not in ride) sees nothing, cannot read addresses
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
set local role authenticated;
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select count(*) from public.rides) = 0, 'C sees no rides';
  assert (select count(*) from public.ride_stops) = 0, 'C sees no stops';
  assert (select count(*) from public.ride_riders) = 0, 'C sees no riders';
  assert (select count(*) from public.get_ride_stops(rid)) = 0, 'get_ride_stops returns nothing for outsiders';
  assert (select count(*) from public.profile_private) = 1, 'C sees only own private row';
  assert (select count(*) from public.driver_links) = 0, 'no driver links visible';
end $$;
-- C tries to assign A as driver: no rows match under RLS.
update public.rides set driver_id = '11111111-1111-1111-1111-111111111111', driver_name = 'Alice', driver_phone = '1';
select 'ok   outsider cannot read ride, stops, addresses, or driver details';
commit;

begin;  -- B sees the pending ride, cannot assign a driver, accepts invite
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select count(*) from public.rides) = 2, 'B sees both occurrences (invited)';
  assert (select driver_id from public.rides where id = rid) is null, 'C''s assignment did not land';
  assert (select count(*) from public.get_ride_stops(rid) where kind <> 'destination' and address is not null) = 0,
    'B (not driver) sees no home addresses';
  assert (select count(*) from public.get_ride_stops(rid) where kind = 'destination' and address is not null) = 1,
    'destination address visible to participants';
  assert exists (select 1 from public.notifications where ride_id = rid), 'B got the invite notification';
end $$;
select expect_error($$ update public.rides set driver_id = '11111111-1111-1111-1111-111111111111',
  driver_name = 'Alice', driver_phone = '+1 914 555 0101' where id = (select id from t_ride) $$,
  'B cannot assign A as driver');
select expect_error($$ update public.rides set driver_id = '22222222-2222-2222-2222-222222222222'
  where id = (select id from t_ride) $$, 'volunteering requires name and phone');
select expect_error($$ update public.rides set destination_name = 'Elsewhere' where id = (select id from t_ride) $$,
  'non-creator cannot edit ride details');
update public.ride_riders set status = 'accepted' where parent_id = '11111111-1111-1111-1111-111111111111';
select public.respond_to_ride_invite((select id from t_ride), 'bbbb2222-0000-0000-0000-000000000001', true);
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select status from public.ride_riders where ride_id = rid and parent_id = '22222222-2222-2222-2222-222222222222') = 'accepted',
    'B accepted Sam''s invite';
end $$;
select 'ok   B accepted the invite; cannot assign others as driver';
commit;

begin;  -- A cannot assign B as driver either; A volunteers with custom details
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
select expect_error($$ update public.rides set driver_id = '22222222-2222-2222-2222-222222222222',
  driver_name = 'Ben', driver_phone = '+1 914 555 0202' where id = (select id from t_ride) $$,
  'creator cannot assign another parent as driver');
select expect_error($$ select public.start_ride((select id from t_ride)) $$, 'cannot start a ride with no driver');
select expect_error($$ insert into public.driver_links (ride_id, created_by) values ((select id from t_ride), '11111111-1111-1111-1111-111111111111') $$,
  'non-driver cannot create a driver link');
do $$ begin
  assert exists (select 1 from public.notifications where body like 'Ben Brown accepted%'), 'A notified of acceptance';
end $$;
select public.volunteer_to_drive((select id from t_ride), 'Ana (our babysitter)', '+1 914 555 0909', 'Blue Honda Odyssey');
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select driver_id from public.rides where id = rid) = '11111111-1111-1111-1111-111111111111', 'A is the driver';
  assert (select driver_name from public.rides where id = rid) = 'Ana (our babysitter)', 'custom driver name';
  -- The driver sees the home addresses for this ride's stops.
  assert (select address from public.get_ride_stops(rid) where kind = 'pickup' and child_name = 'Sam') = '8 Oak Street, Scarsdale NY',
    'driver sees B''s home address on Sam''s pickup';
  -- But still cannot read B's private row directly.
  assert (select count(*) from public.profile_private where user_id = '22222222-2222-2222-2222-222222222222') = 0,
    'driver still cannot query B''s private row directly';
end $$;
select 'ok   A volunteered with custom name/phone; sees addresses only via ride stops';
commit;

begin;  -- B sees the new driver details and their changes
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select driver_phone from public.rides where id = rid) = '+1 914 555 0909', 'B sees driver phone for the ride';
  assert exists (select 1 from public.notifications where ride_id = rid and body like 'Ana (our babysitter) is driving%'),
    'B notified that a driver volunteered';
end $$;
select expect_error($$ select public.volunteer_to_drive((select id from t_ride), 'Ben Brown', '+1 914 555 0202', null) $$,
  'cannot volunteer when a driver exists');
select expect_error($$ select public.update_driver_details((select id from t_ride), 'Hacker', '000', null) $$,
  'non-driver cannot change driver details');
select expect_error($$ select public.step_down_as_driver((select id from t_ride)) $$, 'non-driver cannot remove the driver');
select expect_error($$ select public.start_ride((select id from t_ride)) $$, 'non-driver cannot start the ride');
select expect_error($$ select public.set_stop_completed((select id from public.ride_stops where ride_id = (select id from t_ride) and position = 0), true) $$,
  'non-driver cannot check off stops');
select 'ok   B sees driver contact but cannot change or drive';
commit;

begin;  -- A updates details; creates a driver link; starts the ride
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
select public.update_driver_details((select id from t_ride), 'Ana Lopez', '+1 914 555 0910', 'Blue Honda Odyssey');
select expect_error($$ select public.set_stop_completed((select id from public.ride_stops where ride_id = (select id from t_ride) and position = 0), true) $$,
  'cannot check off before starting');
insert into public.driver_links (ride_id, created_by) values ((select id from t_ride), '11111111-1111-1111-1111-111111111111');
insert into public.driver_links (ride_id, created_by) values ((select id from t_ride), '11111111-1111-1111-1111-111111111111');
create temp table t_links as select token, id from public.driver_links order by created_at;
grant select on t_links to anon;
do $$ begin
  assert (select count(*) from t_links) = 2, 'two links';
  assert (select char_length(token) from t_links limit 1) = 48, 'server-generated 48-char token';
end $$;
-- Revoke the second one.
update public.driver_links set revoked_at = now() where id = (select id from t_links offset 1 limit 1);
select 'ok   driver link created and one revoked';
commit;

begin;  -- B sees updated driver details
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select driver_name || ' ' || driver_phone from public.rides where id = rid) = 'Ana Lopez +1 914 555 0910', 'B sees updated details';
  assert (select count(*) from public.driver_links) = 0, 'B cannot see A''s link tokens';
end $$;
select 'ok   other parent sees the updated driver details';
commit;

-- ------------------------------------------------------------- driver link (anon)
begin;
select set_config('request.jwt.claims', '', true);
set local role anon;
do $$ begin
  assert (select count(*) from public.rides) = 0, 'anon sees no rides';
  assert (select count(*) from public.ride_stops) = 0, 'anon sees no stops';
  assert (select count(*) from public.profile_private) = 0, 'anon sees no private data';
end $$;
select expect_error($$ select public.driver_link_view('0000000000000000000000000000000000000000deadbeef') $$, 'bogus token rejected');
select expect_error($$ select public.driver_link_view((select token from t_links offset 1 limit 1)) $$, 'revoked token rejected');
do $$ declare v jsonb; tok text := (select token from t_links limit 1); begin
  v := public.driver_link_view(tok);
  assert v->'ride'->>'status' = 'scheduled', 'link shows scheduled ride';
  assert jsonb_array_length(v->'stops') = 5, 'link shows 5 stops';
  assert (v->'stops'->0->>'address') = '12 Maple Lane, Scarsdale NY', 'link shows pickup address for the driver';
  assert (v->'stops'->1->>'child_notes') is null and (v->'stops'->0->>'child_notes') = 'Needs booster seat', 'kid notes shown';
  perform public.driver_link_start(tok);
  v := public.driver_link_view(tok);
  assert v->'ride'->>'status' = 'in_progress', 'ride started via link';
  perform public.driver_link_set_stop(tok, (v->'stops'->0->>'id')::uuid, true);
  perform public.driver_link_set_stop(tok, (v->'stops'->1->>'id')::uuid, true);
  v := public.driver_link_view(tok);
  assert (v->'stops'->0->>'completed_at') is not null and (v->'stops'->1->>'completed_at') is not null, 'two pickups checked';
end $$;
select 'ok   anon driver link: view, start, check off';
commit;

begin;  -- B sees progress (what realtime would deliver) and the pickup notification
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select status from public.rides where id = rid) = 'in_progress', 'B sees ride in progress';
  assert (select count(*) from public.ride_stops where ride_id = rid and completed_at is not null) = 2, 'B sees 2 completed stops';
  assert exists (select 1 from public.notifications where ride_id = rid and body = 'Sam was picked up'), 'B notified of pickup';
end $$;
select 'ok   other parent sees check-offs';
commit;

begin;  -- A (driver account) checks the rest; ride auto-finishes; B notified of drop-off
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
set local role authenticated;
-- Backdating is ignored: completed_at is always now().
update public.ride_stops set completed_at = '2000-01-01' where ride_id = (select id from t_ride) and position = 2;
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select completed_at from public.ride_stops where ride_id = rid and position = 2) > now() - interval '1 minute', 'no backdating';
end $$;
select public.set_stop_completed((select id from public.ride_stops where ride_id = (select id from t_ride) and position = 3), true);
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select status from public.rides where id = rid) = 'in_progress', 'still in progress with one stop left';
end $$;
select public.set_stop_completed((select id from public.ride_stops where ride_id = (select id from t_ride) and position = 4), true);
do $$ declare rid uuid := (select id from t_ride); begin
  assert (select status from public.rides where id = rid) = 'finished', 'ride auto-finished after last stop';
  assert (select finished_at from public.rides where id = rid) is not null, 'finished_at set';
  -- Address privacy ends with the ride, even for the driver.
  assert (select count(*) from public.get_ride_stops(rid) where kind <> 'destination' and address is not null) = 0,
    'driver no longer sees home addresses after the ride';
end $$;
select expect_error($$ select public.set_stop_completed((select id from public.ride_stops where ride_id = (select id from t_ride) and position = 4), false) $$,
  'cannot change stops after finish');
select 'ok   ride finished; addresses hidden from driver afterwards';
commit;

begin;  -- B got the drop-off notification
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
do $$ declare rid uuid := (select id from t_ride); begin
  assert exists (select 1 from public.notifications where ride_id = rid and body = 'Sam was dropped off'), 'B notified of drop-off';
  assert not exists (select 1 from public.notifications where body = 'Maya was dropped off'), 'B not notified about A''s kid';
end $$;
select 'ok   drop-off notification delivered to the right parent only';
commit;

begin;  -- driver link stops working after the ride finished
select set_config('request.jwt.claims', '', true);
set local role anon;
select expect_error($$ select public.driver_link_view((select token from t_links limit 1)) $$, 'link dead after ride finished');
select expect_error($$ select public.driver_link_set_stop((select token from t_links limit 1),
  (select id from public.ride_stops limit 1), false) $$, 'link cannot modify after finish');
select 'ok   driver link stops working once the ride is finished';
commit;

-- ------------------------------------------------- step down / second occurrence
begin;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
create temp table t_ride2 as select id from public.rides where id <> (select id from t_ride);
grant select on t_ride2 to anon, authenticated;
select public.respond_to_ride_invite((select id from t_ride2), 'bbbb2222-0000-0000-0000-000000000001', true);
select public.volunteer_to_drive((select id from t_ride2), 'Ben Brown', '+1 914 555 0202', 'Grey Subaru');
do $$ declare rid uuid := (select id from t_ride2); begin
  assert (select address from public.get_ride_stops(rid) where kind = 'pickup' and child_name = 'Maya') = '12 Maple Lane, Scarsdale NY',
    'B as driver of week 2 sees A''s address for that ride';
  assert (select address from public.get_ride_stops((select id from t_ride)) where kind = 'pickup' and child_name = 'Maya') is null,
    'but not for week 1 where B is not the driver';
end $$;
select public.step_down_as_driver((select id from t_ride2));
do $$ declare rid uuid := (select id from t_ride2); begin
  assert (select driver_id from public.rides where id = rid) is null, 'B stepped down';
  assert (select address from public.get_ride_stops(rid) where kind = 'pickup' and child_name = 'Maya') is null,
    'address hidden again after stepping down';
end $$;
select 'ok   per-ride address scope and step down';
commit;

begin;  -- declined invite removes B from the ride
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
set local role authenticated;
select public.respond_to_ride_invite((select id from t_ride2), 'bbbb2222-0000-0000-0000-000000000001', false);
do $$ declare rid uuid := (select id from t_ride2); begin
  assert (select count(*) from public.rides where id = rid) = 0, 'declined: B no longer sees ride 2';
end $$;
select 'ok   declining an invite removes access';
commit;

select '';
select 'ALL RLS TESTS PASSED';
