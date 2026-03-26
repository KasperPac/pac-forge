export interface Client {
  id: string;
  name: string;
  short_code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type ClientCreate = Pick<Client, "name"> &
  Partial<Pick<Client, "short_code" | "contact_name" | "contact_email" | "notes">>;

export type ClientUpdate = Partial<ClientCreate>;
