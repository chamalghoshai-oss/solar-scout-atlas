
CREATE POLICY "anon read lead-photos" ON storage.objects FOR SELECT
  USING (bucket_id = 'lead-photos');
CREATE POLICY "anon write lead-photos" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'lead-photos');
CREATE POLICY "anon update lead-photos" ON storage.objects FOR UPDATE
  USING (bucket_id = 'lead-photos');
CREATE POLICY "anon delete lead-photos" ON storage.objects FOR DELETE
  USING (bucket_id = 'lead-photos');
