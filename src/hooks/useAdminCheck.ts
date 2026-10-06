import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useAdminCheck() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    supabase.functions
      .invoke("admin-api", { body: { action: "check_admin" } })
      .then(({ data, error }) => {
        setIsAdmin(!error && data?.isAdmin === true);
      })
      .catch(() => setIsAdmin(false))
      .finally(() => setLoading(false));
  }, [user]);

  return { isAdmin, loading };
}
