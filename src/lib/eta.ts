import type { RideStop } from "./types";

export type StopEta = {
  /** Planned time entered by the ride creator. */
  planned: Date;
  /** Planned time shifted by how early/late the last check-off was. */
  estimate: Date;
  /** Positive = running late, negative = running early (minutes). */
  deltaMinutes: number;
};

type StopLike = Pick<RideStop, "planned_at" | "completed_at" | "position">;

/**
 * Rough ETA without any map/drive-time API: compare the most recent check-off
 * with its planned time and shift every remaining planned time by that
 * difference. Before any stop is checked off there is no shift.
 */
export function computeDelta(stops: StopLike[]): number {
  const done = stops
    .filter((s) => s.completed_at)
    .sort((a, b) => new Date(a.completed_at!).getTime() - new Date(b.completed_at!).getTime());
  const last = done[done.length - 1];
  if (!last) return 0;
  const diffMs = new Date(last.completed_at!).getTime() - new Date(last.planned_at).getTime();
  return Math.round(diffMs / 60000);
}

export function etaFor(stop: StopLike, deltaMinutes: number): StopEta {
  const planned = new Date(stop.planned_at);
  return {
    planned,
    estimate: new Date(planned.getTime() + deltaMinutes * 60000),
    deltaMinutes,
  };
}

/** "running 5 min late" / "running 3 min early" / "on time" */
export function describeDelta(deltaMinutes: number): string {
  if (Math.abs(deltaMinutes) < 1) return "on time";
  const n = Math.abs(deltaMinutes);
  return `running ${n} min ${deltaMinutes > 0 ? "late" : "early"}`;
}
