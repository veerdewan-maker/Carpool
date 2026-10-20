"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { StopTimeline } from "@/components/StopTimeline";
import { useAsyncData } from "@/lib/useAsyncData";
import { errorMessage, formatDateTime } from "@/lib/format";
import type { DriverLinkView } from "@/lib/types";
import { Button, Card, ErrorMessage, LoadingBlock } from "@/components/ui";

const POLL_MS = 15000;

/** Public page for the driver link. No login; everything goes through token-checked RPCs. */
export default function DriverLinkPage() {
  const { token } = useParams<{ token: string }>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchView = useCallback(async (): Promise<DriverLinkView | "inactive"> => {
    const { data, error } = await supabase().rpc("driver_link_view", { p_token: token });
    if (error) {
      if (error.code === "P0002" || /no longer active|not valid/i.test(error.message)) return "inactive";
      throw error;
    }
    return data as DriverLinkView;
  }, [token]);
  const { data, error, loading, reload: load } = useAsyncData(fetchView);
  const inactive = data === "inactive";
  const view = data && data !== "inactive" ? data : null;

  // The driver is the one making changes here, so a light poll is enough.
  useEffect(() => {
    if (inactive) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load, inactive]);

  async function run(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setActionError(null);
    const { error } = await supabase().rpc(fn, args);
    if (error) setActionError(errorMessage(error));
    load();
    setBusy(null);
  }

  if (loading && !data) return <Shell><LoadingBlock label="Loading ride…" /></Shell>;

  if (inactive) {
    return (
      <Shell>
        <Card className="text-center">
          <p className="text-lg font-semibold">This link is no longer active</p>
          <p className="mt-1 text-sm text-slate-600">The ride is finished, or the parent who sent it has revoked it.</p>
        </Card>
      </Shell>
    );
  }
  if (error || !view) {
    return (
      <Shell>
        <ErrorMessage message={error ?? "Something went wrong."} onRetry={load} />
      </Shell>
    );
  }

  const { ride, stops } = view;
  const inProgress = ride.status === "in_progress";
  const allDone = stops.length > 0 && stops.every((s) => s.completed_at);

  return (
    <Shell>
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Driver link</p>
        <h1 className="text-xl font-semibold">{ride.destination_name}</h1>
        <p className="text-sm text-slate-600">{formatDateTime(ride.starts_at)}</p>
        {ride.driver_name && <p className="text-sm text-slate-600">Driver: {ride.driver_name}</p>}
      </div>
      {actionError && <div className="mb-3"><ErrorMessage message={actionError} /></div>}
      <Card>
        {ride.status === "scheduled" && (
          <Button className="mb-4 w-full" loading={busy === "start"} onClick={() => run("start", "driver_link_start", { p_token: token })}>
            Start ride
          </Button>
        )}
        <StopTimeline
          stops={stops}
          destinationName={ride.destination_name}
          inProgress={inProgress}
          canCheck
          busyStopId={busy?.startsWith("stop-") ? busy.slice(5) : null}
          onCheck={(s, completed) => run(`stop-${s.id}`, "driver_link_set_stop", { p_token: token, p_stop: s.id, p_completed: completed })}
        />
        {inProgress && !allDone && (
          <Button variant="secondary" className="mt-4 w-full" loading={busy === "finish"} onClick={() => run("finish", "driver_link_finish", { p_token: token })}>
            Finish ride early
          </Button>
        )}
      </Card>
      <p className="mt-4 text-center text-xs text-slate-500">
        Parents in this ride see each check-off instantly. Addresses on this page are private to this ride.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-md px-4 py-6">{children}</main>;
}
