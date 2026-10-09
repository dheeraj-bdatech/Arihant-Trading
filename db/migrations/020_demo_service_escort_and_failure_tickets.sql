-- Migration 020: Demo Service Escort & Demo Technical Failure Tickets

-- 1. Add service escort and failure ticket tracking to demos
ALTER TABLE demos
  ADD COLUMN IF NOT EXISTS service_escort_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_engineer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_ticket_id uuid REFERENCES service_tickets(id) ON DELETE SET NULL;

-- 2. Add service escort to visits
ALTER TABLE visits
  ADD COLUMN IF NOT EXISTS service_escort_required boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS service_engineer_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- 3. Add service ticket reference to demo_outcomes
ALTER TABLE demo_outcomes
  ADD COLUMN IF NOT EXISTS service_ticket_id uuid REFERENCES service_tickets(id) ON DELETE SET NULL;

-- 4. Create indexes for quick lookups
CREATE INDEX IF NOT EXISTS idx_demos_service_engineer_id ON demos(service_engineer_id);
CREATE INDEX IF NOT EXISTS idx_demos_service_ticket_id ON demos(service_ticket_id);
CREATE INDEX IF NOT EXISTS idx_visits_service_engineer_id ON visits(service_engineer_id);
