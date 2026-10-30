-- Reverts 043_service_ticket_customer_reference.sql.

alter table service_tickets drop column if exists customer_reference;
