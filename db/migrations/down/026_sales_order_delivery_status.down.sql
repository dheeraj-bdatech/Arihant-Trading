-- Reverting migration 026 is a no-op: the 'order_confirmed' rows it normalised cannot be told apart from
-- deliveries scheduled normally (and 'order_confirmed' was never a valid delivery status).
SELECT 1;
