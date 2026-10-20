#!/usr/bin/env bash
# Spins up a throwaway local Postgres, applies the migration, and runs the RLS
# tests. Requires Postgres 15+ binaries (initdb, pg_ctl, psql) on PATH or in
# /usr/lib/postgresql/*/bin. Nothing touches a real Supabase project.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")"
WORK="${CARPOOL_PGDATA:-$(mktemp -d)}"
PORT="${CARPOOL_PGPORT:-54329}"
export PGHOST="$WORK" PGPORT="$PORT" PGUSER=postgres PGDATABASE=carpool_test

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/pg.log" start >/dev/null
"$PGBIN/createdb" carpool_test

"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/tests/local_supabase_shim.sql"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -f "$ROOT/supabase/migrations/0001_init.sql"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/rls_test.sql"
