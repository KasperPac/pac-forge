import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { signIn as authSignIn, signUp as authSignUp, signOut as authSignOut } from "@/lib/auth";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    const data = await authSignIn(email, password);
    return data;
  }

  async function signUp(email: string, password: string) {
    const data = await authSignUp(email, password);
    return data;
  }

  async function signOut() {
    await authSignOut();
  }

  return { user, loading, signIn, signUp, signOut };
}
