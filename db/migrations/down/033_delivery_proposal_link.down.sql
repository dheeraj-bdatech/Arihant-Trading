DROP INDEX IF EXISTS idx_deliveries_proposal_id;
ALTER TABLE deliveries DROP COLUMN IF EXISTS proposal_id;

DELETE FROM _schema_migrations WHERE name = '033_delivery_proposal_link.sql';
