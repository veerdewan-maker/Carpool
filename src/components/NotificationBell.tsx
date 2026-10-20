"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "./ProfileProvider";

/** Unread count badge, kept live with Supabase realtime. */
export function NotificationBell() {
  const { userId } = useProfile();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    const sb = supabase();
    let cancelled = false;
    const load = async () => {
      const { count } = await sb
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .is("read_at", null);
      if (!cancelled) setUnread(count ?? 0);
    };
    load();
    const channel = sb
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();
    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [userId]);

  return (
    <Link
      href="/notifications"
      aria-label={unread ? `${unread} unread notifications` : "Notifications"}
      className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15L6 16zM10 20a2 2 0 004 0" />
      </svg>
      {unread ? (
        <span className="absolute right-1 top-1 min-w-4.5 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
