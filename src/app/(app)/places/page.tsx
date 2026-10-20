"use client";

import { useCallback, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { errorMessage } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import type { Place } from "@/lib/types";
import { Button, Card, EmptyState, ErrorMessage, Field, Input, LoadingBlock, PageHeader, Sheet } from "@/components/ui";

export default function PlacesPage() {
  const { userId } = useProfile();
  const [editing, setEditing] = useState<Place | "new" | null>(null);

  const fetchPlaces = useCallback(async () => {
    const { data, error } = await supabase().from("places").select("*").eq("owner_id", userId).order("name");
    if (error) throw error;
    return data as Place[];
  }, [userId]);
  const { data: places, error, reload: load } = useAsyncData(fetchPlaces);

  return (
    <>
      <PageHeader
        title="Saved places"
        action={
          <Button variant="ghost" onClick={() => setEditing("new")} className="-mr-2">
            + Add
          </Button>
        }
      />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        {error && <ErrorMessage message={error} onRetry={load} />}
        {!error && !places && <LoadingBlock />}
        {places && places.length === 0 && (
          <EmptyState
            title="No saved places"
            body="Save the pool, the field, the dance studio… and reuse them when you create a ride."
            action={<Button onClick={() => setEditing("new")}>Add a place</Button>}
          />
        )}
        {places && places.length > 0 && (
          <ul className="space-y-2">
            {places.map((p) => (
              <li key={p.id}>
                <Card className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="truncate text-sm text-slate-500">{p.address}</p>
                  </div>
                  <Button variant="secondary" onClick={() => setEditing(p)} className="min-h-10 px-3 text-sm">
                    Edit
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Sheet open={editing !== null} title={editing === "new" ? "Add a place" : "Edit place"} onClose={() => setEditing(null)}>
        {editing && (
          <PlaceForm
            userId={userId}
            place={editing === "new" ? null : editing}
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

function PlaceForm({ userId, place, onDone }: { userId: string; place: Place | null; onDone: () => void }) {
  const [name, setName] = useState(place?.name ?? "");
  const [address, setAddress] = useState(place?.address ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Please give the place a name.");
    if (!address.trim()) return setError("Please enter the address.");
    setError(null);
    setLoading(true);
    try {
      const sb = supabase();
      const payload = { owner_id: userId, name: name.trim(), address: address.trim() };
      const { error } = place
        ? await sb.from("places").update(payload).eq("id", place.id)
        : await sb.from("places").insert(payload);
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Could not save."));
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    if (!place) return;
    setLoading(true);
    try {
      const { error } = await supabase().from("places").delete().eq("id", place.id);
      if (error) throw error;
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Could not delete this place."));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name">
        <Input autoFocus required placeholder="Scarsdale Pool" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Address">
        <Input required placeholder="311 Mamaroneck Rd, Scarsdale, NY" value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      {error && <ErrorMessage message={error} />}
      <Button type="submit" className="w-full" loading={loading}>
        {place ? "Save" : "Add place"}
      </Button>
      {place && (
        <Button type="button" variant="ghost" className="w-full text-red-700" onClick={remove} disabled={loading}>
          Delete place
        </Button>
      )}
    </form>
  );
}
