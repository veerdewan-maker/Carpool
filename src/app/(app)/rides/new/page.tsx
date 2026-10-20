"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { errorMessage, localDateTime, toDateInput, toTimeInput } from "@/lib/format";
import type { Child, Place, Profile, StopKind } from "@/lib/types";
import { Button, Card, EmptyState, ErrorMessage, Field, Input, LinkButton, LoadingBlock, PageHeader, Select } from "@/components/ui";
import { DriverFields } from "@/components/DriverFields";

type DraftStop = {
  key: string;
  kind: StopKind;
  child_id: string | null;
  time: string; // HH:MM, same day as the ride
};

const STEP_MINUTES = 10;

export default function NewRidePage() {
  const router = useRouter();
  const { userId, profile, priv } = useProfile();

  const [places, setPlaces] = useState<Place[] | null>(null);
  const [kids, setKids] = useState<Child[] | null>(null);
  const [parents, setParents] = useState<Record<string, Profile>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  // Destination
  const [placeId, setPlaceId] = useState<string>("");
  const [destName, setDestName] = useState("");
  const [destAddress, setDestAddress] = useState("");
  const [savePlace, setSavePlace] = useState(true);

  // When
  const defaultStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(16, 0, 0, 0);
    return d;
  }, []);
  const [date, setDate] = useState(toDateInput(defaultStart));
  const [time, setTime] = useState(toTimeInput(defaultStart));
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState("8");

  // Riders & stops
  const [selected, setSelected] = useState<string[]>([]);
  const [stops, setStops] = useState<DraftStop[]>([{ key: "dest", kind: "destination", child_id: null, time: toTimeInput(defaultStart) }]);

  // Driver
  const [volunteer, setVolunteer] = useState(false);
  const [driverName, setDriverName] = useState(profile.name);
  const [driverPhone, setDriverPhone] = useState(priv.phone);
  const [driverCar, setDriverCar] = useState([priv.car_color, priv.car_make].filter(Boolean).join(" "));

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const [{ data: pl, error: pErr }, { data: ch, error: cErr }] = await Promise.all([
        sb.from("places").select("*").order("name"),
        sb.from("children").select("*").order("first_name"),
      ]);
      if (pErr || cErr) {
        setLoadError(errorMessage(pErr ?? cErr, "Could not load your kids and places."));
        return;
      }
      setPlaces(pl as Place[]);
      const children = ch as Child[];
      setKids(children);
      const parentIds = Array.from(new Set(children.map((c) => c.parent_id).filter((id) => id !== userId)));
      if (parentIds.length) {
        const { data: profs } = await sb.from("profiles").select("*").in("id", parentIds);
        const map: Record<string, Profile> = {};
        for (const p of (profs ?? []) as Profile[]) map[p.id] = p;
        setParents(map);
      }
    })();
  }, [userId]);

  const kidById = useMemo(() => Object.fromEntries((kids ?? []).map((k) => [k.id, k])), [kids]);

  function addMinutes(hhmm: string, mins: number) {
    const [h, m] = hhmm.split(":").map(Number);
    const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  /** Default every planned time: first stop at the ride time, each next stop 10 minutes later. */
  function withDefaultTimes(list: DraftStop[], start: string): DraftStop[] {
    return list.map((s, i) => ({ ...s, time: addMinutes(start, i * STEP_MINUTES) }));
  }

  function toggleKid(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    setStops((prev) => {
      const destIdx = prev.findIndex((s) => s.kind === "destination");
      let list = prev.filter((s) => s.child_id === null || next.includes(s.child_id));
      if (!selected.includes(id)) {
        // Newly added kid: pickup before the destination, drop-off at the end.
        const before = list.slice(0, destIdx === -1 ? list.length : list.findIndex((s) => s.kind === "destination"));
        const rest = list.slice(before.length);
        list = [...before, { key: `pu-${id}`, kind: "pickup", child_id: id, time: "" }, ...rest, { key: `do-${id}`, kind: "dropoff", child_id: id, time: "" }];
      }
      return withDefaultTimes(list, time);
    });
  }

  function onTimeChange(t: string) {
    setTime(t);
    if (t) setStops((prev) => withDefaultTimes(prev, t));
  }

  function move(idx: number, dir: -1 | 1) {
    setStops((prev) => {
      const j = idx + dir;
      if (j < 0 || j >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });
  }

  function removeStop(key: string) {
    setStops((prev) => prev.filter((s) => s.key !== key));
  }

  function setStopTime(key: string, t: string) {
    setStops((prev) => prev.map((s) => (s.key === key ? { ...s, time: t } : s)));
  }

  function stopLabel(s: DraftStop) {
    if (s.kind === "destination") return destLabel() || "Destination";
    const name = s.child_id ? kidById[s.child_id]?.first_name ?? "kid" : "";
    return s.kind === "pickup" ? `Pick up ${name}` : `Drop off ${name}`;
  }

  function destLabel() {
    if (placeId && placeId !== "custom") return places?.find((p) => p.id === placeId)?.name ?? "";
    return destName.trim();
  }

  const kidsWithoutStops = selected.filter((id) => !stops.some((s) => s.child_id === id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = destLabel();
    const address = placeId && placeId !== "custom" ? places?.find((p) => p.id === placeId)?.address ?? "" : destAddress.trim();
    if (!name) return setError("Where is the ride going? Pick a saved place or enter a destination.");
    if (!address) return setError("Please enter the destination address.");
    const start = localDateTime(date, time);
    if (!start) return setError("Please choose a date and time.");
    if (selected.length === 0) return setError("Pick at least one kid to ride.");
    if (kidsWithoutStops.length) return setError("Every selected kid needs at least a pickup or a drop-off stop.");
    if (stops.some((s) => !s.time)) return setError("Every stop needs a planned time.");
    if (volunteer && (!driverName.trim() || driverPhone.replace(/\D/g, "").length < 7)) {
      return setError("Driver name and phone are required when you volunteer.");
    }
    const repeatWeeks = repeat ? Math.min(26, Math.max(2, Number(weeks) || 2)) : 1;

    setSaving(true);
    try {
      const sb = supabase();
      if (placeId === "custom" && savePlace) {
        const { error } = await sb.from("places").insert({ owner_id: userId, name, address });
        if (error) throw error;
      }
      const payload = stops.map((s) => {
        const at = localDateTime(date, s.time)!;
        return { kind: s.kind, child_id: s.child_id, planned_at: at.toISOString() };
      });
      const { data, error } = await sb.rpc("create_ride", {
        p_destination_name: name,
        p_destination_address: address,
        p_starts_at: start.toISOString(),
        p_stops: payload,
        p_repeat_weeks: repeatWeeks,
        p_volunteer: volunteer,
        p_driver_name: volunteer ? driverName.trim() : null,
        p_driver_phone: volunteer ? driverPhone.trim() : null,
        p_driver_car: volunteer ? driverCar.trim() || null : null,
      });
      if (error) throw error;
      router.replace(`/rides/${data as string}`);
    } catch (err) {
      setError(errorMessage(err, "Could not create the ride."));
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Create a ride" back="/" />
        <main className="mx-auto w-full max-w-md px-4 py-4">
          <ErrorMessage message={loadError} onRetry={() => location.reload()} />
        </main>
      </>
    );
  }
  if (!kids || !places) {
    return (
      <>
        <PageHeader title="Create a ride" back="/" />
        <LoadingBlock />
      </>
    );
  }

  const myKids = kids.filter((k) => k.parent_id === userId);
  const otherKids = kids.filter((k) => k.parent_id !== userId);
  const otherByParent = otherKids.reduce<Record<string, Child[]>>((acc, k) => ((acc[k.parent_id] ??= []).push(k), acc), {});

  if (myKids.length === 0 && otherKids.length === 0) {
    return (
      <>
        <PageHeader title="Create a ride" back="/" />
        <main className="mx-auto w-full max-w-md px-4 py-4">
          <EmptyState
            title="Add a kid first"
            body="A ride needs at least one rider. Add your kids, or connect with a parent whose kids you drive."
            action={<LinkButton href="/kids">Go to My kids</LinkButton>}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Create a ride" back="/" />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        <form onSubmit={submit} className="space-y-6">
          <section className="space-y-3">
            <h2 className="font-semibold">Destination</h2>
            <Field label="Saved place">
              <Select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
                <option value="">{places.length ? "Choose a saved place…" : "No saved places yet"}</option>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="custom">Somewhere else…</option>
              </Select>
            </Field>
            {(placeId === "custom" || (placeId === "" && places.length === 0)) && (
              <>
                <Field label="Place name">
                  <Input placeholder="Soccer field" value={destName} onChange={(e) => setDestName(e.target.value)} />
                </Field>
                <Field label="Address">
                  <Input placeholder="1 Field Rd, Scarsdale NY" value={destAddress} onChange={(e) => setDestAddress(e.target.value)} />
                </Field>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-5 w-5" checked={savePlace} onChange={(e) => setSavePlace(e.target.checked)} />
                  Save to my places
                </label>
              </>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">When</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="First pickup at">
                <Input type="time" required value={time} onChange={(e) => onTimeChange(e.target.value)} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
              Repeat weekly
            </label>
            {repeat && (
              <Field label="For how many weeks?" hint="Each week becomes its own ride that anyone can volunteer to drive.">
                <Input type="number" inputMode="numeric" min={2} max={26} value={weeks} onChange={(e) => setWeeks(e.target.value)} />
              </Field>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Who&apos;s riding</h2>
            <KidPicker title="My kids" kids={myKids} selected={selected} onToggle={toggleKid} />
            {Object.entries(otherByParent).map(([pid, list]) => (
              <KidPicker key={pid} title={`${parents[pid]?.name ?? "Connected parent"}'s kids`} kids={list} selected={selected} onToggle={toggleKid} hint="Their parent must accept the invite." />
            ))}
            {otherKids.length === 0 && (
              <p className="text-sm text-slate-500">
                Connect with other parents to add their kids.{" "}
                <a href="/connections" className="font-medium text-brand-700 underline underline-offset-2">
                  Find parents
                </a>
              </p>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="font-semibold">Stops</h2>
                <p className="text-xs text-slate-500">Default: each stop {STEP_MINUTES} min after the previous one.</p>
              </div>
              <Button type="button" variant="ghost" className="min-h-9 px-2 text-sm" onClick={() => setStops((p) => withDefaultTimes(p, time))}>
                Reset times
              </Button>
            </div>
            <ol className="space-y-2">
              {stops.map((s, i) => (
                <li key={s.key}>
                  <Card className="flex items-center gap-2 p-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{stopLabel(s)}</p>
                      <input
                        type="time"
                        aria-label={`Planned time for ${stopLabel(s)}`}
                        value={s.time}
                        onChange={(e) => setStopTime(s.key, e.target.value)}
                        className="mt-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="flex shrink-0 flex-col">
                      <button type="button" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0} className="h-7 w-8 rounded text-slate-500 disabled:opacity-30">
                        ▲
                      </button>
                      <button type="button" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === stops.length - 1} className="h-7 w-8 rounded text-slate-500 disabled:opacity-30">
                        ▼
                      </button>
                    </div>
                    {s.kind !== "destination" && (
                      <button type="button" aria-label="Remove stop" onClick={() => removeStop(s.key)} className="h-9 w-9 shrink-0 rounded-full text-slate-400 hover:bg-slate-100">
                        ✕
                      </button>
                    )}
                  </Card>
                </li>
              ))}
            </ol>
            {kidsWithoutStops.length > 0 && (
              <p className="text-sm text-amber-700">
                {kidsWithoutStops.map((id) => kidById[id]?.first_name).join(", ")} has no stops and won&apos;t be on the ride.
              </p>
            )}
            {selected.length === 0 && <p className="text-sm text-slate-500">Pick riders above to add their pickups and drop-offs.</p>}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">Driver</h2>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={volunteer} onChange={(e) => setVolunteer(e.target.checked)} />
              I&apos;ll drive this ride
            </label>
            {!volunteer && <p className="text-sm text-slate-500">The ride will be marked “Needs a driver” until someone in it volunteers.</p>}
            {volunteer && (
              <DriverFields name={driverName} phone={driverPhone} car={driverCar} onName={setDriverName} onPhone={setDriverPhone} onCar={setDriverCar} />
            )}
          </section>

          {error && <ErrorMessage message={error} />}
          <Button type="submit" className="w-full" loading={saving}>
            {repeat ? "Create rides" : "Create ride"}
          </Button>
        </form>
      </main>
    </>
  );
}

function KidPicker({
  title,
  kids,
  selected,
  onToggle,
  hint,
}: {
  title: string;
  kids: Child[];
  selected: string[];
  onToggle: (id: string) => void;
  hint?: string;
}) {
  if (kids.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mb-1 text-xs text-slate-500">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {kids.map((k) => {
          const on = selected.includes(k.id);
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(k.id)}
              className={`min-h-10 rounded-full border px-4 text-sm font-medium ${
                on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-800"
              }`}
            >
              {k.first_name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
