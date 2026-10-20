"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { DriverFields } from "@/components/DriverFields";
import { StopTimeline } from "@/components/StopTimeline";
import { statusBadge } from "@/components/RideCard";
import { errorMessage, formatDateTime, formatTime, smsHref, telHref } from "@/lib/format";
import type { DriverLink, Ride, RideRider, RideStop } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorMessage, LinkButton, LoadingBlock, PageHeader, SectionTitle, Sheet } from "@/components/ui";

type Loaded = { ride: Ride; riders: RideRider[]; stops: RideStop[]; links: DriverLink[] };

export default function RideDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userId, profile, priv } = useProfile();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"volunteer" | "edit-driver" | "links" | "cancel" | null>(null);

  const fetchRide = useCallback(async (): Promise<Loaded | "missing"> => {
    const sb = supabase();
    const { data: ride, error: rErr } = await sb.from("rides").select("*").eq("id", id).maybeSingle();
    if (rErr) throw rErr;
    if (!ride) return "missing";
    const r = ride as Ride;
    const [{ data: riders, error: rrErr }, { data: stops, error: sErr }, linksRes] = await Promise.all([
      sb.from("ride_riders").select("*, child:children(id,first_name,notes), parent:profiles!ride_riders_parent_id_fkey(id,name)").eq("ride_id", id).order("created_at"),
      sb.rpc("get_ride_stops", { p_ride: id }),
      r.driver_id === userId ? sb.from("driver_links").select("*").eq("ride_id", id).order("created_at") : Promise.resolve({ data: [], error: null }),
    ]);
    if (rrErr) throw rrErr;
    if (sErr) throw sErr;
    if (linksRes.error) throw linksRes.error;
    return { ride: r, riders: riders as RideRider[], stops: stops as RideStop[], links: (linksRes.data ?? []) as DriverLink[] };
  }, [id, userId]);
  const { data, error, reload: load } = useAsyncData(fetchRide);

  useEffect(() => {
    const sb = supabase();
    const channel = sb
      .channel(`ride-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_stops", filter: `ride_id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "rides", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "ride_riders", filter: `ride_id=eq.${id}` }, () => load())
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [id, load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }
  const rpc = (fn: string, args: Record<string, unknown>) => async () => {
    const { error } = await supabase().rpc(fn, args);
    if (error) throw error;
  };

  if (error && !data) {
    return (
      <>
        <PageHeader title="Ride" back="/" />
        <main className="mx-auto w-full max-w-md px-4 py-4">
          <ErrorMessage message={error} onRetry={load} />
        </main>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title="Ride" back="/" />
        <LoadingBlock label="Loading ride…" />
      </>
    );
  }
  if (data === "missing") {
    return (
      <>
        <PageHeader title="Ride" back="/" />
        <main className="mx-auto w-full max-w-md px-4 py-4">
          <EmptyState title="Ride not found" body="It may have been removed, or you are not part of it." action={<LinkButton href="/">Back to rides</LinkButton>} />
        </main>
      </>
    );
  }

  const { ride, riders, stops, links } = data;
  const isDriver = ride.driver_id === userId;
  const isCreator = ride.creator_id === userId;
  const myPending = riders.filter((r) => r.parent_id === userId && r.status === "pending");
  const amParticipant = isCreator || riders.some((r) => r.parent_id === userId && r.status === "accepted");
  const active = ride.status === "scheduled" || ride.status === "in_progress";
  const inProgress = ride.status === "in_progress";
  const activeLinks = links.filter((l) => !l.revoked_at);

  return (
    <>
      <PageHeader title={ride.destination_name} back="/" />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{formatDateTime(ride.starts_at)}</p>
            <p className="text-sm text-slate-600">{ride.destination_address}</p>
            {ride.series_id && <p className="mt-1 text-xs text-slate-500">Part of a weekly series</p>}
          </div>
          {statusBadge(ride)}
        </div>

        {actionError && (
          <div className="mt-4">
            <ErrorMessage message={actionError} />
          </div>
        )}
        {error && (
          <div className="mt-4">
            <ErrorMessage message={error} onRetry={load} />
          </div>
        )}

        {myPending.length > 0 && active && (
          <Card className="mt-4 border-brand-200 bg-brand-50">
            <p className="font-medium">
              {myPending.map((r) => r.child?.first_name).join(" and ")} {myPending.length > 1 ? "were" : "was"} invited to this ride.
            </p>
            <p className="mt-1 text-sm text-slate-600">Accept to add them. The driver will see your home address for this ride only.</p>
            <div className="mt-3 flex gap-2">
              {myPending.map((r) => (
                <div key={r.id} className="flex flex-1 gap-2">
                  <Button className="flex-1" loading={busy === `acc-${r.id}`} onClick={() => run(`acc-${r.id}`, rpc("respond_to_ride_invite", { p_ride: ride.id, p_child: r.child_id, p_accept: true }))}>
                    Accept{myPending.length > 1 ? ` ${r.child?.first_name}` : ""}
                  </Button>
                  <Button variant="secondary" className="flex-1" disabled={busy !== null} onClick={() => run(`dec-${r.id}`, rpc("respond_to_ride_invite", { p_ride: ride.id, p_child: r.child_id, p_accept: false }))}>
                    Decline
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        )}

        <SectionTitle>Driver</SectionTitle>
        {ride.driver_id ? (
          <Card>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{ride.driver_name}</p>
                {ride.driver_car && <p className="text-sm text-slate-600">{ride.driver_car}</p>}
                <p className="text-sm text-slate-600">{ride.driver_phone}</p>
                {isDriver && <p className="mt-1 text-xs text-slate-500">You are responsible for this ride.</p>}
              </div>
              {isDriver && <Badge tone="info">You</Badge>}
            </div>
            {ride.driver_phone && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a href={telHref(ride.driver_phone)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-4 font-medium text-white">
                  Call
                </a>
                <a href={smsHref(ride.driver_phone)} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 font-medium text-slate-900">
                  Text
                </a>
              </div>
            )}
            {isDriver && active && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-10 flex-1 text-sm" onClick={() => setSheet("edit-driver")}>
                  Edit driver details
                </Button>
                <Button variant="secondary" className="min-h-10 flex-1 text-sm" onClick={() => setSheet("links")}>
                  Driver link{activeLinks.length ? ` (${activeLinks.length})` : ""}
                </Button>
                {ride.status === "scheduled" && (
                  <Button variant="ghost" className="min-h-10 w-full text-sm text-red-700" loading={busy === "stepdown"} onClick={() => run("stepdown", rpc("step_down_as_driver", { p_ride: ride.id }))}>
                    I can&apos;t drive after all
                  </Button>
                )}
              </div>
            )}
          </Card>
        ) : (
          <Card className="border-amber-200 bg-amber-50">
            <p className="font-medium text-amber-900">This ride needs a driver</p>
            <p className="mt-1 text-sm text-amber-800">Any parent in the ride can volunteer. Nobody can be assigned by someone else.</p>
            {active && amParticipant && (
              <Button className="mt-3 w-full" onClick={() => setSheet("volunteer")}>
                I&apos;ll drive
              </Button>
            )}
            {active && !amParticipant && myPending.length > 0 && <p className="mt-2 text-xs text-amber-800">Accept the invite first to volunteer.</p>}
          </Card>
        )}

        <SectionTitle>{inProgress ? "Live progress" : "Stops"}</SectionTitle>
        <Card>
          {isDriver && ride.status === "scheduled" && (
            <Button className="mb-4 w-full" loading={busy === "start"} onClick={() => run("start", rpc("start_ride", { p_ride: ride.id }))}>
              Start ride
            </Button>
          )}
          {stops.length === 0 ? (
            <p className="text-sm text-slate-500">No stops.</p>
          ) : (
            <StopTimeline
              stops={stops}
              destinationName={ride.destination_name}
              inProgress={inProgress}
              canCheck={isDriver}
              busyStopId={busy?.startsWith("stop-") ? busy.slice(5) : null}
              onCheck={(s, completed) => run(`stop-${s.id}`, rpc("set_stop_completed", { p_stop: s.id, p_completed: completed }))}
            />
          )}
          {isDriver && inProgress && (
            <Button variant="secondary" className="mt-4 w-full" loading={busy === "finish"} onClick={() => run("finish", rpc("finish_ride", { p_ride: ride.id }))}>
              Finish ride
            </Button>
          )}
          {!isDriver && active && <p className="mt-3 text-xs text-slate-500">Home addresses are shown only to the driver.</p>}
          {ride.status === "finished" && ride.finished_at && <p className="mt-3 text-xs text-slate-500">Finished at {formatTime(ride.finished_at)}.</p>}
        </Card>

        <SectionTitle count={riders.filter((r) => r.status !== "declined").length}>Riders</SectionTitle>
        <Card>
          {riders.length === 0 ? (
            <p className="text-sm text-slate-500">No riders.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {riders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium">{r.child?.first_name ?? "Kid"}</p>
                    <p className="text-xs text-slate-500">{r.parent?.name ?? "Parent"}</p>
                  </div>
                  {r.status === "accepted" && <Badge tone="good">Going</Badge>}
                  {r.status === "pending" && <Badge tone="warn">Invited</Badge>}
                  {r.status === "declined" && <Badge tone="neutral">Declined</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isCreator && active && (
          <div className="mt-6">
            <Button variant="ghost" className="w-full text-red-700" onClick={() => setSheet("cancel")}>
              Cancel this ride
            </Button>
          </div>
        )}
      </main>

      <Sheet open={sheet === "volunteer"} title="I'll drive this ride" onClose={() => setSheet(null)}>
        <DriverSheet
          initial={{ name: profile.name, phone: priv.phone, car: [priv.car_color, priv.car_make].filter(Boolean).join(" ") }}
          submitLabel="Confirm, I'm driving"
          onSubmit={(v) => run("volunteer", async () => {
            await rpc("volunteer_to_drive", { p_ride: ride.id, p_name: v.name, p_phone: v.phone, p_car: v.car || null })();
            setSheet(null);
          })}
          busy={busy === "volunteer"}
          error={actionError}
        />
      </Sheet>

      <Sheet open={sheet === "edit-driver"} title="Driver details" onClose={() => setSheet(null)}>
        <DriverSheet
          initial={{ name: ride.driver_name ?? profile.name, phone: ride.driver_phone ?? priv.phone, car: ride.driver_car ?? "" }}
          submitLabel="Save"
          onSubmit={(v) => run("edit-driver", async () => {
            await rpc("update_driver_details", { p_ride: ride.id, p_name: v.name, p_phone: v.phone, p_car: v.car || null })();
            setSheet(null);
          })}
          busy={busy === "edit-driver"}
          error={actionError}
        />
      </Sheet>

      <Sheet open={sheet === "links"} title="Driver link" onClose={() => setSheet(null)}>
        <DriverLinks
          rideId={ride.id}
          userId={userId}
          links={links}
          busy={busy}
          error={actionError}
          onCreate={() => run("link-create", async () => {
            const { error } = await supabase().from("driver_links").insert({ ride_id: ride.id, created_by: userId });
            if (error) throw error;
          })}
          onRevoke={(l) => run(`link-${l.id}`, async () => {
            const { error } = await supabase().from("driver_links").update({ revoked_at: new Date().toISOString() }).eq("id", l.id);
            if (error) throw error;
          })}
        />
      </Sheet>

      <Sheet open={sheet === "cancel"} title="Cancel this ride?" onClose={() => setSheet(null)}>
        <p className="text-sm text-slate-600">Everyone in the ride will be told it was cancelled. This cannot be undone.</p>
        {actionError && <div className="mt-3"><ErrorMessage message={actionError} /></div>}
        <div className="mt-4 flex gap-2">
          <Button variant="danger" className="flex-1" loading={busy === "cancel"} onClick={() => run("cancel", async () => { await rpc("cancel_ride", { p_ride: ride.id })(); setSheet(null); })}>
            Cancel ride
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => setSheet(null)}>
            Keep it
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function DriverSheet({
  initial,
  submitLabel,
  onSubmit,
  busy,
  error,
}: {
  initial: { name: string; phone: string; car: string };
  submitLabel: string;
  onSubmit: (v: { name: string; phone: string; car: string }) => void;
  busy: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(initial.name);
  const [phone, setPhone] = useState(initial.phone);
  const [car, setCar] = useState(initial.car);
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return setLocalError("Please enter the driver's name.");
        if (phone.replace(/\D/g, "").length < 7) return setLocalError("Please enter a phone number parents can reach.");
        setLocalError(null);
        onSubmit({ name: name.trim(), phone: phone.trim(), car: car.trim() });
      }}
    >
      <DriverFields name={name} phone={phone} car={car} onName={setName} onPhone={setPhone} onCar={setCar} />
      {(localError || error) && <ErrorMessage message={localError ?? error ?? ""} />}
      <Button type="submit" className="w-full" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

function DriverLinks({
  links,
  busy,
  error,
  onCreate,
  onRevoke,
}: {
  rideId: string;
  userId: string;
  links: DriverLink[];
  busy: string | null;
  error: string | null;
  onCreate: () => void;
  onRevoke: (l: DriverLink) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const active = links.filter((l) => !l.revoked_at);
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function share(l: DriverLink) {
    const url = `${origin}/drive/${l.token}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Carpool driver link", text: "Here are the stops for the ride:", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(l.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // user dismissed the share sheet
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Send this private link to whoever is actually driving (a babysitter, a grandparent). It opens the stops and check-off buttons for
        this ride only, with no login. It stops working when the ride is finished or you revoke it.
      </p>
      {error && <ErrorMessage message={error} />}
      {active.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">No active link.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((l) => (
            <li key={l.id} className="rounded-xl border border-slate-200 p-3">
              <p className="break-all font-mono text-xs text-slate-700">{origin}/drive/{l.token}</p>
              <div className="mt-2 flex gap-2">
                <Button className="min-h-10 flex-1 text-sm" onClick={() => share(l)}>
                  {copied === l.id ? "Copied!" : "Share / copy"}
                </Button>
                <Button variant="secondary" className="min-h-10 text-sm" loading={busy === `link-${l.id}`} onClick={() => onRevoke(l)}>
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button variant={active.length ? "secondary" : "primary"} className="w-full" loading={busy === "link-create"} onClick={onCreate}>
        {active.length ? "Create another link" : "Create driver link"}
      </Button>
    </div>
  );
}
