"use client";

import { computeDelta, describeDelta, etaFor } from "@/lib/eta";
import { formatTime } from "@/lib/format";
import type { StopKind } from "@/lib/types";

export type TimelineStop = {
  id: string;
  position: number;
  kind: StopKind;
  child_name: string | null;
  child_notes: string | null;
  parent_name: string | null;
  planned_at: string;
  completed_at: string | null;
  address: string | null;
};

export function stopTitle(s: TimelineStop, destinationName: string) {
  if (s.kind === "destination") return destinationName;
  return s.kind === "pickup" ? `Pick up ${s.child_name ?? ""}` : `Drop off ${s.child_name ?? ""}`;
}

export function checkLabel(s: TimelineStop, destinationName: string) {
  if (s.kind === "destination") return `Arrived at ${destinationName}`;
  return s.kind === "pickup" ? `Picked up ${s.child_name ?? ""}` : `Dropped off ${s.child_name ?? ""}`;
}

/**
 * Shared by the ride detail page (parents + driver account) and the driver
 * link page. Shows planned vs. estimated times and lets the driver check off.
 */
export function StopTimeline({
  stops,
  destinationName,
  inProgress,
  canCheck,
  busyStopId,
  onCheck,
}: {
  stops: TimelineStop[];
  destinationName: string;
  inProgress: boolean;
  canCheck: boolean;
  busyStopId?: string | null;
  onCheck?: (stop: TimelineStop, completed: boolean) => void;
}) {
  const delta = computeDelta(stops);
  const nextIdx = stops.findIndex((s) => !s.completed_at);
  const lastDoneIdx = stops.reduce((acc, s, i) => (s.completed_at ? i : acc), -1);
  const anyDone = lastDoneIdx >= 0;

  return (
    <div>
      {inProgress && (
        <p className={`mb-3 rounded-xl px-3 py-2 text-sm font-medium ${delta > 2 ? "bg-amber-50 text-amber-800" : "bg-green-50 text-green-800"}`}>
          {anyDone ? `Ride is ${describeDelta(delta)}` : "Ride started"}
        </p>
      )}
      <ol className="relative space-y-3">
        {stops.map((s, i) => {
          const eta = etaFor(s, delta);
          const done = Boolean(s.completed_at);
          const isNext = inProgress && i === nextIdx;
          const showEta = inProgress && !done && anyDone && Math.abs(delta) >= 1;
          return (
            <li key={s.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                    done
                      ? "border-green-600 bg-green-600 text-white"
                      : isNext
                        ? "border-brand-600 bg-white text-brand-700"
                        : "border-slate-300 bg-white text-slate-500"
                  }`}
                  aria-label={done ? "Completed" : undefined}
                >
                  {done ? "✓" : i + 1}
                </span>
                {i < stops.length - 1 && <span className={`mt-1 w-0.5 flex-1 ${done ? "bg-green-500" : "bg-slate-200"}`} />}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`font-medium ${done ? "text-slate-500 line-through decoration-slate-300" : ""}`}>{stopTitle(s, destinationName)}</p>
                    {s.kind !== "destination" && s.parent_name && <p className="text-xs text-slate-500">{s.parent_name}&apos;s kid</p>}
                    {s.address && <p className="mt-0.5 text-sm text-slate-700">{s.address}</p>}
                    {s.child_notes && <p className="mt-0.5 text-xs text-amber-700">Note: {s.child_notes}</p>}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {done ? (
                      <>
                        <p className="font-medium text-green-700">{formatTime(s.completed_at!)}</p>
                        <p className="text-xs text-slate-400">planned {formatTime(s.planned_at)}</p>
                      </>
                    ) : showEta ? (
                      <>
                        <p className="font-medium">about {formatTime(eta.estimate)}</p>
                        <p className="text-xs text-slate-500">({describeDelta(delta)})</p>
                      </>
                    ) : (
                      <p className="text-slate-700">{formatTime(s.planned_at)}</p>
                    )}
                  </div>
                </div>
                {canCheck && inProgress && onCheck && !done && (
                  <button
                    type="button"
                    onClick={() => onCheck(s, true)}
                    disabled={busyStopId === s.id}
                    className={`mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold ${
                      isNext ? "bg-brand-600 text-white" : "border border-slate-300 bg-white text-slate-800"
                    } disabled:opacity-60`}
                  >
                    {busyStopId === s.id ? "Saving…" : checkLabel(s, destinationName)}
                  </button>
                )}
                {canCheck && inProgress && onCheck && done && i === lastDoneIdx && nextIdx !== -1 && (
                  <button
                    type="button"
                    onClick={() => onCheck(s, false)}
                    disabled={busyStopId === s.id}
                    className="mt-1 text-xs font-medium text-slate-500 underline underline-offset-2"
                  >
                    Undo
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
