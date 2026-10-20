"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { errorMessage, formatDateTime } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { Button, EmptyState, ErrorMessage, LoadingBlock, PageHeader } from "@/components/ui";

export default function NotificationsPage() {
  const { userId } = useProfile();
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase().from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return data as Notification[];
  }, []);
  const { data: items, error: loadError, reload: load } = useAsyncData(fetchItems);
  const error = actionError ?? loadError;

  useEffect(() => {
    const sb = supabase();
    const channel = sb
      .channel(`notifications-page-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => load())
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [load, userId]);

  async function markAllRead() {
    const { error } = await supabase().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    if (error) setActionError(errorMessage(error));
    else {
      setActionError(null);
      load();
    }
  }

  const unread = items?.some((n) => !n.read_at);

  return (
    <>
      <PageHeader
        title="Notifications"
        back="/"
        action={
          unread ? (
            <Button variant="ghost" onClick={markAllRead} className="-mr-2 text-sm">
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        {error && <ErrorMessage message={error} onRetry={load} />}
        {!error && !items && <LoadingBlock />}
        {items && items.length === 0 && (
          <EmptyState title="Nothing yet" body="You'll hear here when a kid is dropped off, a ride needs a driver, or someone wants to connect." />
        )}
        {items && items.length > 0 && (
          <ul className="space-y-2">
            {items.map((n) => {
              const inner = (
                <div className={`rounded-2xl border px-4 py-3 ${n.read_at ? "border-slate-200 bg-white" : "border-brand-200 bg-brand-50"}`}>
                  <p className={n.read_at ? "text-slate-700" : "font-medium text-slate-900"}>{n.body}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{formatDateTime(n.created_at)}</p>
                </div>
              );
              return (
                <li key={n.id}>
                  {n.ride_id ? (
                    <Link href={`/rides/${n.ride_id}`} className="block">
                      {inner}
                    </Link>
                  ) : (
                    <Link href="/connections" className="block">
                      {inner}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
