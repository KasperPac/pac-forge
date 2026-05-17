export interface Customer {
  id: string;
  name: string;
  display_code: string;
  dropbox_root_path: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export type CustomerCreate = Pick<Customer, "name" | "display_code"> & {
  dropbox_root_path?: string | null;
};

export type CustomerUpdate = Partial<
  Pick<Customer, "name" | "display_code" | "dropbox_root_path">
>;
