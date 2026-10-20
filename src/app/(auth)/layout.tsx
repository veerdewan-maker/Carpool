export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-white">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 17h14M6 17l1.5-5h9L18 17M6 17v2M18 17v2M8 12l1-3h6l1 3" />
            <circle cx="8" cy="17" r="1" />
            <circle cx="16" cy="17" r="1" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold">Carpool</h1>
        <p className="text-sm text-slate-500">Share the driving for your kids&apos; activities.</p>
      </div>
      {children}
    </main>
  );
}
