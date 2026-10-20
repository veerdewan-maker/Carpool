"use client";

import { useCallback, useEffect, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { NotificationBell } from "@/components/NotificationBell";
import { RideCard } from "@/components/RideCard";
import type { Ride, RideRider } from "@/lib/types";
import { EmptyState, ErrorMessage, LinkButton, LoadingBlock, SectionTitle } from "@/components/ui";

type Loaded = { rides: Ride[]; riders: Record<string, RideRider[]> };

export default function HomePage() {
  const { userId, profile } = useProfile();
  const [showPast, setShowPast] = useState(false);

  const fetchRides = useCallback(async (): Promise<Loaded> => {
    const sb = supabase();
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const q = sb.from("rides").select("*").order("starts_at", { ascending: true });
    const { data: rides, error } = showPast
      ? await q.in("status", ["finished", "cancelled"]).order("starts_at", { ascending: false }).limit(50)
      : await q.in("status", ["scheduled", "in_progress"]).gte("starts_at", since);
    if (error) throw error;
    const ids = (rides as Ride[]).map((r) => r.id);
    let riders: RideRider[] = [];
    if (ids.length) {
      const { data: rr, error: rErr } = await sb
        .from("ride_riders")
        .select("*, child:children(id,first_name,notes)")
        .in("ride_id", ids);
      if (rErr) throw rErr;
      riders = rr as RideRider[];
    }
    const byRide: Record<string, RideRider[]> = {};
    for (const r of riders) (byRide[r.ride_id] ??= []).push(r);
    return { rides: rides as Ride[], riders: byRide };
  }, [showPast]);
  const { data, error, reload: load } = useAsyncData(fetchRides);

  useEffect(() => {
    const sb = supabase();
    const channel = sb
      .channel(`home-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_riders" }, () => load())
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [load, userId]);

  const rides = data?.rides ?? [];
  const ridersOf = (r: Ride) => data?.riders[r.id] ?? [];
  const invites = rides.filter((r) => ridersOf(r).some((x) => x.status === "pending" && x.parent_id === userId));
  const driving = rides.filter((r) => r.driver_id === userId && !invites.includes(r));
  const needsDriver = rides.filter((r) => !r.driver_id && r.status === "scheduled" && !invites.includes(r));
  const kidsRiding = rides.filter((r) => r.driver_id && r.driver_id !== userId && !invites.includes(r));

  return (
    <>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-md items-center gap-2 px-4">
          <h1 className="flex-1 truncate text-lg font-semibold">Hi, {profile.name.split(" ")[0]}</h1>
          <NotificationBell />
        </div>
      </header>
      <main className="mx-auto w-full max-w-md px-4 py-4">
        <LinkButton href="/rides/new" className="w-full">
          + Create a ride
        </LinkButton>

        <div className="mt-4 flex gap-1 rounded-xl bg-slate-200 p-1 text-sm font-medium">
          <button
            className={`flex-1 rounded-lg py-2 ${!showPast ? "bg-white shadow-sm" : "text-slate-600"}`}
            onClick={() => setShowPast(false)}
            aria-pressed={!showPast}
          >
            Upcoming
          </button>
          <button
            className={`flex-1 rounded-lg py-2 ${showPast ? "bg-white shadow-sm" : "text-slate-600"}`}
            onClick={() => setShowPast(true)}
            aria-pressed={showPast}
          >
            Past
          </button>
        </div>

        {error && (
          <div className="mt-4">
            <ErrorMessage message={error} onRetry={load} />
          </div>
        )}
        {!error && !data && <LoadingBlock label="Loading rides…" />}

        {data && showPast && (
          <div className="mt-4">
            {rides.length === 0 ? (
              <EmptyState title="No past rides" />
            ) : (
              <ul className="space-y-2">
                {rides.map((r) => (
                  <li key={r.id}>
                    <RideCard ride={r} riders={ridersOf(r)} userId={userId} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {data && !showPast && rides.length === 0 && (
          <div className="mt-4">
            <EmptyState
              title="No upcoming rides"
              body="Create a ride to the pool, practice or a playdate and invite your connected parents' kids."
            />
          </div>
        )}

        {data && !showPast && rides.length > 0 && (
          <>
            {invites.length > 0 && (
              <Group title="Invitations" rides={invites} ridersOf={ridersOf} userId={userId} />
            )}
            <Group title="I'm driving" rides={driving} ridersOf={ridersOf} userId={userId} empty="You're not driving any upcoming rides." />
            <Group title="My kids are riding" rides={kidsRiding} ridersOf={ridersOf} userId={userId} empty="No rides with a driver yet." />
            <Group title="Needs a driver" rides={needsDriver} ridersOf={ridersOf} userId={userId} empty="Every ride has a driver. Nice." />
          </>
        )}
      </main>
    </>
  );
}

function Group({
  title,
  rides,
  ridersOf,
  userId,
  empty,
}: {
  title: string;
  rides: Ride[];
  ridersOf: (r: Ride) => RideRider[];
  userId: string;
  empty?: string;
}) {
  return (
    <section>
      <SectionTitle count={rides.length}>{title}</SectionTitle>
      {rides.length === 0 ? (
        <p className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rides.map((r) => (
            <li key={r.id}>
              <RideCard ride={r} riders={ridersOf(r)} userId={userId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
