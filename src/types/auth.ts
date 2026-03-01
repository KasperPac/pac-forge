export const USER_ROLES = {
  ENGINEER: "ENGINEER",
  ADMIN: "ADMIN",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export interface Profile {
  user_id: string;
  display_name: string;
  role: UserRole;
  avatar_url: string | null;
  created_at: string;
}

export interface ProfileUpdate {
  display_name?: string;
  avatar_url?: string | null;
}

export interface AuthState {
  user: Profile | null;
  loading: boolean;
  error: string | null;
}
