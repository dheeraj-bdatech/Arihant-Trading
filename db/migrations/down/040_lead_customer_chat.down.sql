-- Reverts 040_lead_customer_chat.sql.
DROP TABLE IF EXISTS lead_chat_links;
ALTER TABLE lead_messages DROP CONSTRAINT IF EXISTS lead_messages_customer_author_check;
ALTER TABLE lead_messages DROP CONSTRAINT IF EXISTS lead_messages_audience_check;
ALTER TABLE lead_messages DROP COLUMN IF EXISTS customer_name;
ALTER TABLE lead_messages DROP COLUMN IF EXISTS from_customer;
ALTER TABLE lead_messages DROP COLUMN IF EXISTS audience;
