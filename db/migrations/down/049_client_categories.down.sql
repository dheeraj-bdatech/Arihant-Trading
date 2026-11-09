-- Reverts 049_client_categories.sql: drops the client categories master. organisations.sector keeps its values.

drop table if exists client_categories;
