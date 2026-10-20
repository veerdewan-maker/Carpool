export function SetupNotice() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">Carpool needs a Supabase project</h1>
      <p className="mt-3 text-slate-600">
        The app is not configured yet. Create a <code>.env.local</code> file with your project URL and
        publishable key (see <code>.env.example</code>), apply the migration in{" "}
        <code>supabase/migrations</code>, then restart the dev server.
      </p>
    </main>
  );
}
