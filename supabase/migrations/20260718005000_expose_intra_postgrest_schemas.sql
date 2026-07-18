-- Expose only the app schemas required by the Intra Data API.
-- The quoted custom setting is required by PostgreSQL ALTER ROLE syntax.

alter role authenticator set "pgrst.db_schemas" =
  'public, core, warehouse, procurement, legal, graphql_public';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
