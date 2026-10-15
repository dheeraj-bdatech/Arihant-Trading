-- Sales orders generated from won tenders were inserted with status 'order_confirmed', which is not a
-- delivery status: those deliveries were missing from every status tab, count and dashboard metric.
-- A confirmed order is a scheduled delivery.
UPDATE deliveries SET status = 'scheduled', updated_at = now() WHERE status = 'order_confirmed';
