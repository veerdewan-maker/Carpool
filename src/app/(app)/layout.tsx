import { ProfileProvider } from "@/components/ProfileProvider";
import { BottomNav } from "@/components/BottomNav";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProfileProvider>
      <div className="flex min-h-dvh flex-col pb-20">
        {children}
      </div>
      <BottomNav />
    </ProfileProvider>
  );
}
