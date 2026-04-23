// Sentinel returned by `createInvoice` when an invoice already exists for
// the requested billing month and `overwrite` is false. The client surfaces
// the Overwrite confirmation modal on this code instead of treating it as
// an error. Lives in a sibling .constants file because `'use server'`
// modules can only export async functions (Platform-Native Rule).
export const INVOICE_EXISTS_CODE = 'INVOICE_EXISTS'
