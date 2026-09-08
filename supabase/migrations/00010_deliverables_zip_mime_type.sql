-- Ticket #73: the deliverables bucket now also holds one zip per Quiz
-- (only application/zip is ever uploaded going forward --
-- DELIVERABLE_CONTENT_TYPES, src/domain/orders.ts). Additive, not a
-- replacement: keeps application/pdf and audio/mpeg (harmless, unused by
-- any current uploader, but cheap to keep rather than assume nothing else
-- ever relied on them) and appends application/zip. Idempotent -- rerunning
-- this update is a no-op once the array already contains all three.

update storage.buckets
set allowed_mime_types = array['application/pdf', 'audio/mpeg', 'application/zip']
where id = 'deliverables'
  and not ( allowed_mime_types @> array['application/pdf', 'audio/mpeg', 'application/zip'] );
