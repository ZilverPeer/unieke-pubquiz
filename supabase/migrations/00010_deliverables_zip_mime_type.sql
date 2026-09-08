-- Ticket #73: the deliverables bucket now holds one zip per Quiz instead of
-- four loose files. Only application/zip is ever uploaded now
-- (DELIVERABLE_CONTENT_TYPES, src/domain/orders.ts) -- the four loose files
-- src/scripts/generate.ts still writes locally for Erik's inspection never
-- go through this bucket.

update storage.buckets
set allowed_mime_types = array['application/zip']
where id = 'deliverables';
