-- Mwell Intra — expose the suite schemas through PostgREST (Supabase Data API)
--
-- Equivalent to Project Settings -> API -> Exposed schemas. The single M-Intra
-- project hosts core + the per-domain schemas (spec §3/§9, ADR-003). We expose
-- all of them now so each module's client can pin its own schema:
--   core, warehouse, procurement, legal
-- (warehouse/procurement/legal tables are created by their own Step 1e+ domain
-- migrations; listing them here is harmless and avoids a later config edit.)
--
-- Safe to run repeatedly.

alter role authenticator set pgrst.db_schemas =
  'public, core, warehouse, procurement, legal, graphql_public';

notify pgrst, 'reload config';
