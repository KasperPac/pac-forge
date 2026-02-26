export interface ReferenceLibraryDoc {
  id: string;
  title: string;
  source_filename: string;
  file_type: string;
  total_chars: number;
  section_count: number;
  plc_brand: string;
  compatible_cpus: string[];
  created_by: string | null;
  created_at: string;
}

export interface ReferenceLibrarySection {
  id: string;
  doc_id: string;
  section_index: number;
  heading: string;
  content: string;
  char_count: number;
  topic_tags: string[];
  created_at: string;
}
