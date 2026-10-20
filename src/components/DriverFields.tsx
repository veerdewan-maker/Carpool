"use client";

import { Field, Input } from "./ui";

export function DriverFields({
  name,
  phone,
  car,
  onName,
  onPhone,
  onCar,
}: {
  name: string;
  phone: string;
  car: string;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onCar: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3">
      <Field label="Driver name" hint="Edit if someone else is behind the wheel, e.g. “Ana (our babysitter)”. Your account stays responsible.">
        <Input required value={name} onChange={(e) => onName(e.target.value)} />
      </Field>
      <Field label="Driver phone" hint="Parents in this ride can call or text this number.">
        <Input type="tel" required value={phone} onChange={(e) => onPhone(e.target.value)} />
      </Field>
      <Field label="Car">
        <Input placeholder="Blue Honda Odyssey" value={car} onChange={(e) => onCar(e.target.value)} />
      </Field>
    </div>
  );
}
