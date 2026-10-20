"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { errorMessage } from "@/lib/format";
import type { Child, Connection, SearchResult } from "@/lib/types";
import { Badge, Button, Card, EmptyState, ErrorMessage, Input, LoadingBlock, PageHeader, SectionTitle, Spinner } from "@/components/ui";

type ConnRow = Connection & { requester: { id: string; name: string } | null; addressee: { id: string; name: string } | null };

export default function ConnectionsPage() {
  const { userId } = useProfile();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    const sb = supabase();
    const { data, error } = await sb
      .from("connections")
      .select("*, requester:profiles!connections_requester_id_fkey(id,name), addressee:profiles!connections_addressee_id_fkey(id,name)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    // Kids of connected parents are visible to us under RLS.
    const { data: kids, error: kErr } = await sb.from("children").select("*").neq("parent_id", userId).order("first_name");
    if (kErr) throw kErr;
    const grouped: Record<string, Child[]> = {};
    for (const k of (kids ?? []) as Child[]) (grouped[k.parent_id] ??= []).push(k);
    return { connections: data as ConnRow[], kidsByParent: grouped };
  }, [userId]);
  const { data, error, reload: load } = useAsyncData(fetchAll);
  const connections = data?.connections ?? null;
  const kidsByParent = data?.kidsByParent ?? {};

  async function act(key: string, fn: () => Promise<void>) {
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

  const accept = (c: ConnRow) =>
    act(c.id, async () => {
      const { error } = await supabase().from("connections").update({ status: "accepted" }).eq("id", c.id);
      if (error) throw error;
    });
  const remove = (c: ConnRow) =>
    act(c.id, async () => {
      const { error } = await supabase().from("connections").delete().eq("id", c.id);
      if (error) throw error;
    });

  const incoming = connections?.filter((c) => c.status === "pending" && c.addressee_id === userId) ?? [];
  const outgoing = connections?.filter((c) => c.status === "pending" && c.requester_id === userId) ?? [];
  const accepted = connections?.filter((c) => c.status === "accepted") ?? [];
  const otherOf = (c: ConnRow) => (c.requester_id === userId ? c.addressee : c.requester);

  return (
    <>
      <PageHeader title="Connections" />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        <Search onChanged={load} />
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
        {!error && connections === null && <LoadingBlock />}
        {connections && (
          <>
            {incoming.length > 0 && (
              <>
                <SectionTitle count={incoming.length}>Requests for you</SectionTitle>
                <ul className="space-y-2">
                  {incoming.map((c) => (
                    <li key={c.id}>
                      <Card className="flex items-center gap-3">
                        <p className="min-w-0 flex-1 truncate font-medium">{otherOf(c)?.name ?? "A parent"}</p>
                        <Button onClick={() => accept(c)} loading={busy === c.id} className="min-h-10 px-3 text-sm">
                          Accept
                        </Button>
                        <Button variant="secondary" onClick={() => remove(c)} disabled={busy === c.id} className="min-h-10 px-3 text-sm">
                          Decline
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {outgoing.length > 0 && (
              <>
                <SectionTitle count={outgoing.length}>Sent requests</SectionTitle>
                <ul className="space-y-2">
                  {outgoing.map((c) => (
                    <li key={c.id}>
                      <Card className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{otherOf(c)?.name ?? "A parent"}</p>
                          <p className="text-xs text-slate-500">Waiting for them to accept</p>
                        </div>
                        <Button variant="secondary" onClick={() => remove(c)} loading={busy === c.id} className="min-h-10 px-3 text-sm">
                          Cancel
                        </Button>
                      </Card>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <SectionTitle count={accepted.length}>Connected parents</SectionTitle>
            {accepted.length === 0 ? (
              <EmptyState
                title="No connections yet"
                body="Search for a parent by name above and send a request. Once they accept you can add each other's kids to rides."
              />
            ) : (
              <ul className="space-y-2">
                {accepted.map((c) => {
                  const other = otherOf(c);
                  const kids = other ? kidsByParent[other.id] ?? [] : [];
                  return (
                    <li key={c.id}>
                      <Card>
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium">{other?.name ?? "A parent"}</p>
                            <p className="text-sm text-slate-500">
                              {kids.length === 0 ? "No kids added yet" : `Kids: ${kids.map((k) => k.first_name).join(", ")}`}
                            </p>
                          </div>
                          <Button variant="ghost" onClick={() => remove(c)} loading={busy === c.id} className="min-h-10 px-2 text-sm text-slate-500">
                            Remove
                          </Button>
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </>
  );
}

function Search({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async (term: string) => {
    if (term.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    setError(null);
    const { data, error } = await supabase().rpc("search_parents", { q: term.trim() });
    setSearching(false);
    if (error) setError(errorMessage(error, "Search failed."));
    else setResults(data as SearchResult[]);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(q), 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, run]);

  async function send(r: SearchResult) {
    setBusy(r.id);
    setError(null);
    const sb = supabase();
    const { data: me } = await sb.auth.getUser();
    const { error } = await sb.from("connections").insert({ requester_id: me.user?.id, addressee_id: r.id });
    if (error) setError(errorMessage(error, "Could not send the request."));
    onChanged();
    await run(q);
    setBusy(null);
  }

  async function accept(r: SearchResult) {
    if (!r.connection_id) return;
    setBusy(r.id);
    const { error } = await supabase().from("connections").update({ status: "accepted" }).eq("id", r.connection_id);
    if (error) setError(errorMessage(error, "Could not accept."));
    onChanged();
    await run(q);
    setBusy(null);
  }

  return (
    <section>
      <label className="block">
        <span className="sr-only">Search parents by name</span>
        <div className="relative">
          <Input
            type="search"
            placeholder="Search parents by name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pr-10"
            autoComplete="off"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Spinner size="sm" />
            </span>
          )}
        </div>
      </label>
      <p className="mt-1 text-xs text-slate-500">Results show names only. Addresses, phones and kids stay private.</p>
      {error && (
        <div className="mt-3">
          <ErrorMessage message={error} />
        </div>
      )}
      {results && (
        <ul className="mt-3 space-y-2">
          {results.length === 0 && <li className="rounded-xl bg-white px-4 py-3 text-sm text-slate-500">No parents named “{q.trim()}” yet.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <Card className="flex items-center gap-3 py-3">
                <p className="min-w-0 flex-1 truncate font-medium">{r.name}</p>
                {r.connection_status === "none" && (
                  <Button onClick={() => send(r)} loading={busy === r.id} className="min-h-10 px-3 text-sm">
                    Connect
                  </Button>
                )}
                {r.connection_status === "pending_out" && <Badge tone="neutral">Request sent</Badge>}
                {r.connection_status === "pending_in" && (
                  <Button onClick={() => accept(r)} loading={busy === r.id} className="min-h-10 px-3 text-sm">
                    Accept
                  </Button>
                )}
                {r.connection_status === "accepted" && <Badge tone="good">Connected</Badge>}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
