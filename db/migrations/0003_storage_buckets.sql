-- Create private storage buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('po-documents', 'po-documents', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png','image/webp']),
  ('support-attachments', 'support-attachments', false, 5242880, NULL)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: authenticated users can upload and read their own files
CREATE POLICY "authenticated_insert_po_documents" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'po-documents');

CREATE POLICY "authenticated_select_po_documents" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'po-documents');

CREATE POLICY "authenticated_insert_support_attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'support-attachments');

CREATE POLICY "authenticated_select_support_attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'support-attachments');
