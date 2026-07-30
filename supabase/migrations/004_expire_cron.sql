-- Schedule the pending-connection expiry sweep (SPEC §4). 002 shipped the
-- expire_stale_connections(p_days) RPC but nothing called it; this wires it
-- to pg_cron so pending edges auto-expire after CONNECTION_EXPIRY_DAYS (7)
-- without any app-side scheduler — the job runs inside Postgres, so it
-- works identically on dev / staging / live wherever this migration lands.
--
-- Defensive by design: if pg_cron can't be enabled on the target project
-- (e.g. the role lacks privilege, or it's a plain local Postgres), the
-- migration logs a NOTICE and continues rather than failing the deploy.
-- In that case enable it once in Supabase → Database → Extensions
-- (pg_cron) and re-run this migration. Re-running is idempotent.

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice
      'pg_cron unavailable (%): skipping scheduled expiry. Enable pg_cron in '
      'Supabase → Database → Extensions, then re-run 004_expire_cron.sql.',
      sqlerrm;
    return;
  end;

  -- Idempotent: drop any prior job of this name before (re)creating it.
  perform cron.unschedule('expire-stale-connections')
  from cron.job
  where jobname = 'expire-stale-connections';

  -- Hourly is ample for a 7-day expiry window and stays light.
  perform cron.schedule(
    'expire-stale-connections',
    '0 * * * *',
    $cron$ select expire_stale_connections(7); $cron$
  );

  raise notice 'scheduled hourly job: expire-stale-connections';
end
$$;
