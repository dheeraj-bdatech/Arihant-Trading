-- Migration 017: Module 5 Delivery & Installation Management
CREATE TABLE IF NOT EXISTS deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_no text UNIQUE NOT NULL,
  organisation_id uuid NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  model text,
  equipment_serial text,
  delivery_date date NOT NULL,
  delivery_location text NOT NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  tender_id uuid REFERENCES tenders(id) ON DELETE SET NULL,
  order_reference text,
  status text NOT NULL DEFAULT 'scheduled', -- scheduled, dispatched, in_transit, delivered, installed, handover_completed, cancelled
  installation_required boolean DEFAULT false,
  installation_date date,
  installed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  installation_notes text,
  remarks text,
  document_url text,
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_organisation_id ON deliveries(organisation_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_assigned_to ON deliveries(assigned_to);
CREATE INDEX IF NOT EXISTS idx_deliveries_tender_id ON deliveries(tender_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_delivery_date ON deliveries(delivery_date);
