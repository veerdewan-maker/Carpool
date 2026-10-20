"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { ProfileForm } from "@/components/ProfileForm";
import { LoadingBlock } from "@/components/ui";

export default function OnboardingPage() {
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const sb = supabase();
      const { data } = await sb.auth.getUser();
      if (!active) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      // Already set up? Go home.
      const { data: priv } = await sb.from("profile_private").select("user_id").eq("user_id", data.user.id).maybeSingle();
      if (priv) {
        router.replace("/");
        return;
      }
      setUserId(data.user.id);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  if (!userId) return <LoadingBlock />;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="text-2xl font-semibold">Set up your profile</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">
        Carpool shares your phone and address only with the people who need them for a ride.
      </p>
      <ProfileForm
        userId={userId}
        submitLabel="Continue"
        onSaved={() => {
          router.replace("/kids?welcome=1");
        }}
      />
    </main>
  );
}
