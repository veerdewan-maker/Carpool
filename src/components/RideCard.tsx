"use client";

import Link from "next/link";
import type { Ride, RideRider } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { Badge } from "./ui";

export function statusBadge(ride: Ride) {
  if (ride.status === "in_progress") return <Badge tone="info">In progress</Badge>;
  if (ride.status === "finished") return <Badge tone="good">Finished</Badge>;
  if (ride.status === "cancelled") return <Badge tone="bad">Cancelled</Badge>;
  if (!ride.driver_id) return <Badge tone="warn">Needs a driver</Badge>;
  return <Badge tone="neutral">Scheduled</Badge>;
}

export function RideCard({ ride, riders, userId }: { ride: Ride; riders: RideRider[]; userId: string }) {
  const accepted = riders.filter((r) => r.status === "accepted");
  const pendingMine = riders.filter((r) => r.status === "pending" && r.parent_id === userId);
  const kidNames = accepted.map((r) => r.child?.first_name).filter(Boolean).join(", ");
  return (
    <Link href={`/rides/${ride.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{ride.destination_name}</p>
          <p className="text-sm text-slate-600">{formatDateTime(ride.starts_at)}</p>
        </div>
        {statusBadge(ride)}
      </div>
      <p className="mt-2 truncate text-sm text-slate-500">
        {kidNames ? `Riding: ${kidNames}` : "No riders confirmed yet"}
        {ride.driver_name ? ` · Driver: ${ride.driver_name}` : ""}
      </p>
      {pendingMine.length > 0 && (
        <p className="mt-2 text-sm font-medium text-brand-700">
          Invite for {pendingMine.map((r) => r.child?.first_name).join(", ")} — tap to respond
        </p>
      )}
    </Link>
  );
}
