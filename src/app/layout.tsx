import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/SetupNotice";

// Env is read per request so a build without .env.local still works once configured.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Carpool",
  description: "Share the driving for your kids' activities.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2f8781",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const configured = Boolean(getSupabaseEnv());
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{configured ? children : <SetupNotice />}</body>
    </html>
  );
}
