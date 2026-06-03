-- Phase 56: Care WEDO medical document library
-- Adds private original-file metadata and doctor-facing document summaries.

alter table public.care_documents
  add column if not exists storage_bucket text,
  add column if not exists storage_path text,
  add column if not exists original_file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size_bytes bigint,
  add column if not exists page_count integer,
  add column if not exists document_title text,
  add column if not exists source_hospital text,
  add column if not exists document_date date,
  add column if not exists summary_status text not null default 'pending',
  add column if not exists preserve_original_file boolean not null default true,
  add column if not exists deleted_at timestamptz;

create index if not exists care_documents_profile_date_idx
  on public.care_documents (profile_id, document_date desc, created_at desc);

create index if not exists care_documents_type_idx
  on public.care_documents (document_type, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'care-documents',
  'care-documents',
  false,
  26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
