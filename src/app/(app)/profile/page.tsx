"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useProfile } from "@/components/ProfileProvider";
import { ProfileForm } from "@/components/ProfileForm";
import { Button, PageHeader } from "@/components/ui";

export default function ProfilePage() {
  const { userId, email, profile, priv, refresh } = useProfile();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    await supabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      <PageHeader title="My profile" />
      <main className="mx-auto w-full max-w-md px-4 py-4">
        {email && <p className="mb-4 text-sm text-slate-500">Signed in as {email}</p>}
        <ProfileForm userId={userId} initial={{ profile, priv }} submitLabel="Save changes" onSaved={refresh} />
        <div className="mt-8 border-t border-slate-200 pt-6">
          <Button variant="secondary" className="w-full" onClick={signOut} loading={signingOut}>
            Log out
          </Button>
        </div>
      </main>
    </>
  );
}
