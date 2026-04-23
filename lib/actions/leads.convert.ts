'use server'

/**
 * Private helpers for convertLeadToCustomer. Extracted to keep leads.ts under
 * the 300-line CQ-02 service cap — same pattern as customers.sql.ts.
 * Not part of the public actions API; only imported by leads.ts.
 */

import { eq, ilike } from 'drizzle-orm'
import { db } from '@/db'
import { leads, customers, customerContacts } from '@/db/schema'

// Tx type mirrors customers.ts — inferred from db.transaction's callback signature.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface LeadForConversion {
  name: string
  company: string | null
  email: string | null
  phone: string | null
  title: string | null
  status: string
}

// Duplicated from leads.ts to avoid a circular import (leads.ts imports this
// file; this file must not import back from leads.ts).
function nullIfBlank(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export async function loadLeadForConversion(leadId: string): Promise<LeadForConversion | null> {
  const rows = await db
    .select({
      name: leads.name,
      company: leads.company,
      email: leads.email,
      phone: leads.phone,
      title: leads.title,
      status: leads.status,
    })
    .from(leads)
    .where(eq(leads.id, leadId))
  return rows[0] ?? null
}

export async function findDuplicateCustomer(
  companyName: string,
): Promise<{ company_name: string } | null> {
  const rows = await db
    .select({ company_name: customers.company_name })
    .from(customers)
    .where(ilike(customers.company_name, companyName))
  return rows[0] ?? null
}

export async function runConversionTransaction(
  tx: Tx,
  leadId: string,
  lead: LeadForConversion,
): Promise<{ customerId: string }> {
  const companyName = lead.company?.trim() || lead.name.trim()
  const [customer] = await tx
    .insert(customers)
    .values({ company_name: companyName, status: 'active' })
    .returning({ id: customers.id })
  await tx.insert(customerContacts).values({
    customer_id: customer.id,
    name: lead.name.trim(),
    email: nullIfBlank(lead.email),
    phone: nullIfBlank(lead.phone),
    role: nullIfBlank(lead.title),
    is_primary: true,
  })
  await tx
    .update(leads)
    .set({ status: 'converted', converted_customer_id: customer.id, updated_at: new Date() })
    .where(eq(leads.id, leadId))
  return { customerId: customer.id }
}
