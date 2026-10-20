"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { errorMessage } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Child } from "@/lib/types";
import { Button, Card, EmptyState, ErrorMessage, Field, Input, LinkButton, LoadingBlock, PageHeader, Sheet, Textarea } from "@/components/ui";

export default function KidsPage() {
  return (
    <Suspense>
      <Kids />
    </Suspense>
  );
}

function Kids() {
  const { userId } = useProfile();
  const params = useSearchParams();
  const welcome = params.get("welcome") === "1";
  const [editing, setEditing] = useState<Child | "new" | null>(null);

  const fetchKids = useCallback(async () => {
    const { data, error } = await supabase().from("children").select("*").eq("parent_id", userId).order("created_at");
    if (error) throw error;
    return data as Child[];
  }, [userId]);
  const { data: kids, error, reload: load } = useAsyncData(fetchKids);

  return (
    <>
      <PageHeader
        title="My kids"
        action={
          <Button variant="ghost" onClick={() => setEditing("new")} className="-mr-2">
            + Add
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        {welcome && (
          <div className="mb-4 rounded-2xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            <p className="font-medium">Welcome to Carpool!</p>
            <p>Add your kids first. Then connect with other parents to start sharing rides.</p>
          </div>
        )}
        {error && <ErrorMessage message={error} onRetry={load} />}
        {!error && !kids && <LoadingBlock />}
        {kids && kids.length === 0 && (
          <EmptyState
            title="No kids yet"
            body="Add each child who rides with you. Only their first name is shared with connected parents."
            action={<Button onClick={() => setEditing("new")}>Add a kid</Button>}
          />
        )}
        {kids && kids.length > 0 && (
          <ul className="space-y-2">
            {kids.map((k) => (
              <li key={k.id}>
                <Card className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800">
                    {k.first_name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{k.first_name}</p>
                    {k.notes && <p className="truncate text-sm text-slate-500">{k.notes}</p>}
                  </div>
                  <Button variant="secondary" onClick={() => setEditing(k)} className="min-h-10 px-3 text-sm">
                    Edit
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {kids && kids.length > 0 && welcome && (
          <div className="mt-6">
            <LinkButton href="/connections" className="w-full">
              Next: connect with parents
            </LinkButton>
          </div>
        )}
      </main>
      <Sheet open={editing !== null} title={editing === "new" ? "Add a kid" : "Edit kid"} onClose={() => setEditing(null)}>
        {editing && (
          <KidForm
            userId={userId}
            kid={editing === "new" ? null : editing}
            onDone={() => {
              setEditing(null);
              load();
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function KidForm({ userId, kid, onDone }: { userId: string; kid: Child | null; onDone: () => void }) {
  const [firstName, setFirstName] = useState(kid?.first_name ?? "");
  const [notes, setNotes] = useState(kid?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = firstName.trim();
    if (!name) return setError("Please enter a first name.");
    setError(null);
    setLoading(true);
    try {
      const sb = supabase();
      const payload = { parent_id: userId, first_name: name, notes: notes.trim() || null };
      const { error } = kid
        ? await sb.from("children").update(payload).eq("id", kid.id)
        : await sb.from("children").insert(payload);
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Could not save."));
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!kid) return;
    setLoading(true);
    try {
      const { error } = await supabase().from("children").delete().eq("id", kid.id);
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Could not remove this kid."));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="First name">
        <Input autoFocus required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </Field>
      <Field label="Notes for drivers (optional)" hint="e.g. needs a booster seat, allergic to peanuts">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
      </Field>
      {error && <ErrorMessage message={error} />}
      <Button type="submit" className="w-full" loading={loading}>
        {kid ? "Save" : "Add kid"}
      </Button>
      {kid && !confirmDelete && (
        <Button type="button" variant="ghost" className="w-full text-red-700" onClick={() => setConfirmDelete(true)}>
          Remove {kid.first_name}
        </Button>
      )}
      {kid && confirmDelete && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900">
          <p>Remove {kid.first_name}? They will be taken off any rides they are on.</p>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="danger" onClick={remove} loading={loading} className="flex-1">
              Remove
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirmDelete(false)} className="flex-1">
              Keep
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
