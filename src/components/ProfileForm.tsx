"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/format";
import type { Profile, ProfilePrivate } from "@/lib/types";
import { Button, ErrorMessage, Field, Input, SuccessMessage } from "./ui";

export type ProfileFormValues = {
  name: string;
  phone: string;
  home_address: string;
  car_make: string;
  car_color: string;
  car_open_seats: string;
};

export function ProfileForm({
  userId,
  initial,
  submitLabel,
  onSaved,
}: {
  userId: string;
  initial?: { profile: Profile; priv: ProfilePrivate };
  submitLabel: string;
  onSaved: () => void | Promise<void>;
}) {
  const [values, setValues] = useState<ProfileFormValues>({
    name: initial?.profile.name ?? "",
    phone: initial?.priv.phone ?? "",
    home_address: initial?.priv.home_address ?? "",
    car_make: initial?.priv.car_make ?? "",
    car_color: initial?.priv.car_color ?? "",
    car_open_seats: initial?.priv.car_open_seats?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const set = (k: keyof ProfileFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false);
    setValues((v) => ({ ...v, [k]: e.target.value }));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = values.name.trim();
    const phone = values.phone.trim();
    const address = values.home_address.trim();
    if (!name) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 7) return setError("Please enter a phone number other parents can call.");
    if (!address) return setError("Please enter your home address so a driver can find you.");
    const seats = values.car_open_seats.trim() === "" ? null : Number(values.car_open_seats);
    if (seats !== null && (!Number.isInteger(seats) || seats < 0 || seats > 12)) {
      return setError("Open seats should be a whole number from 0 to 12.");
    }
    setLoading(true);
    try {
      const sb = supabase();
      const { error: pErr } = await sb.from("profiles").upsert({ id: userId, name });
      if (pErr) throw pErr;
      const { error: vErr } = await sb.from("profile_private").upsert({
        user_id: userId,
        phone,
        home_address: address,
        car_make: values.car_make.trim() || null,
        car_color: values.car_color.trim() || null,
        car_open_seats: seats,
      });
      if (vErr) throw vErr;
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err, "Could not save your profile."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Your name" hint="Other parents find you by this name.">
        <Input autoComplete="name" required value={values.name} onChange={set("name")} />
      </Field>
      <Field label="Phone number" hint="Shown to parents in a ride only when you are driving it.">
        <Input type="tel" autoComplete="tel" required value={values.phone} onChange={set("phone")} />
      </Field>
      <Field label="Home address" hint="Shown only to the driver of a ride your kid is on, during that ride.">
        <Input autoComplete="street-address" required value={values.home_address} onChange={set("home_address")} />
      </Field>
      <fieldset className="rounded-2xl border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Your car</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Make / model">
            <Input placeholder="Honda Odyssey" value={values.car_make} onChange={set("car_make")} />
          </Field>
          <Field label="Color">
            <Input placeholder="Blue" value={values.car_color} onChange={set("car_color")} />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Open seats for kids">
            <Input type="number" inputMode="numeric" min={0} max={12} value={values.car_open_seats} onChange={set("car_open_seats")} />
          </Field>
        </div>
      </fieldset>
      {error && <ErrorMessage message={error} />}
      {saved && !error && <SuccessMessage message="Saved." />}
      <Button type="submit" className="w-full" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}
