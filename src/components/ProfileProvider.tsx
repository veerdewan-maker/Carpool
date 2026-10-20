"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import type { Profile, ProfilePrivate } from "@/lib/types";
import { errorMessage } from "@/lib/format";
import { ErrorMessage, LoadingBlock } from "./ui";

type ProfileState = {
  userId: string;
  email: string | null;
  profile: Profile;
  priv: ProfilePrivate;
  refresh: () => Promise<void>;
};

const ProfileContext = createContext<ProfileState | null>(null);

export function useProfile(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}

/**
 * Loads the signed-in parent's profile. Sends them to onboarding when they
 * have not finished setting up their account yet.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [account, setAccount] = useState<Omit<ProfileState, "refresh"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    const sb = supabase();
    (async () => {
      const { data: userData, error: userErr } = await sb.auth.getUser();
      if (userErr || !userData.user) return { redirect: "/login" as const };
      const uid = userData.user.id;
      const [{ data: profile, error: pErr }, { data: priv, error: vErr }] = await Promise.all([
        sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
        sb.from("profile_private").select("*").eq("user_id", uid).maybeSingle(),
      ]);
      if (pErr) throw pErr;
      if (vErr) throw vErr;
      if (!profile || !priv) return { redirect: "/onboarding" as const };
      return {
        account: {
          userId: uid,
          email: userData.user.email ?? null,
          profile: profile as Profile,
          priv: priv as ProfilePrivate,
        },
      };
    })().then(
      (result) => {
        if (!active) return;
        if ("redirect" in result && result.redirect) {
          if (pathname !== result.redirect) router.replace(result.redirect);
          return;
        }
        if (!("account" in result)) return;
        setError(null);
        setAccount(result.account);
      },
      (e: unknown) => {
        if (active) setError(errorMessage(e, "Could not load your profile."));
      }
    );
    return () => {
      active = false;
    };
  }, [router, pathname, tick]);

  const refresh = useCallback(async () => setTick((t) => t + 1), []);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-8">
        <ErrorMessage message={error} onRetry={refresh} />
      </div>
    );
  }
  if (!account) return <LoadingBlock label="Loading your account…" />;
  return <ProfileContext value={{ ...account, refresh }}>{children}</ProfileContext>;
}
