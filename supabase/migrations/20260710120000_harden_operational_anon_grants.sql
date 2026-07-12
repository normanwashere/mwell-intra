-- Harden Mwell Intra operational schemas for launch readiness.
--
-- Supabase Auth uses the public key to establish a session, but app data reads
-- should execute as `authenticated` with RLS policies, not as anonymous table
-- access. This migration removes anon access that was temporarily granted by
-- the live cutover verifier and makes future grants explicit.

revoke all privileges on all tables in schema core from anon;
revoke all privileges on all tables in schema legal from anon;
revoke all privileges on all tables in schema procurement from anon;
revoke all privileges on all tables in schema warehouse from anon;

revoke all privileges on all sequences in schema core from anon;
revoke all privileges on all sequences in schema legal from anon;
revoke all privileges on all sequences in schema procurement from anon;
revoke all privileges on all sequences in schema warehouse from anon;

revoke usage on schema core from anon;
revoke usage on schema legal from anon;
revoke usage on schema procurement from anon;
revoke usage on schema warehouse from anon;

alter default privileges in schema core revoke all on tables from anon;
alter default privileges in schema legal revoke all on tables from anon;
alter default privileges in schema procurement revoke all on tables from anon;
alter default privileges in schema warehouse revoke all on tables from anon;

alter default privileges in schema core revoke all on sequences from anon;
alter default privileges in schema legal revoke all on sequences from anon;
alter default privileges in schema procurement revoke all on sequences from anon;
alter default privileges in schema warehouse revoke all on sequences from anon;
