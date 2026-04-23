-- Enable RLS on all 8 tables
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "support_attachments" ENABLE ROW LEVEL SECURITY;

-- Authenticated access policy on all 8 tables
-- Single-user app: any authenticated session has full access.
-- Unauthenticated queries return 0 rows (USING (true) filters silently).
CREATE POLICY "authenticated_access" ON "customers"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "customer_contacts"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "orders"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "invoices"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "leads"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "lead_notes"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "support_tickets"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_access" ON "support_attachments"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
