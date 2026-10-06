import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify user identity
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;

    // Check admin role using service client
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleData } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case "check_admin": {
        return new Response(JSON.stringify({ isAdmin: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "list_users": {
        // Get all profiles
        const { data: profiles } = await adminClient
          .from("profiles")
          .select("*")
          .order("created_at", { ascending: false });

        // Get auth users for email info
        const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });

        // Get book counts per user
        const { data: books } = await adminClient
          .from("books")
          .select("user_id");

        const bookCounts: Record<string, number> = {};
        books?.forEach((b: any) => {
          bookCounts[b.user_id] = (bookCounts[b.user_id] || 0) + 1;
        });

        // Get user roles
        const { data: roles } = await adminClient
          .from("user_roles")
          .select("user_id, role");

        const roleMap: Record<string, string[]> = {};
        roles?.forEach((r: any) => {
          if (!roleMap[r.user_id]) roleMap[r.user_id] = [];
          roleMap[r.user_id].push(r.role);
        });

        const authUserMap: Record<string, any> = {};
        authData?.users?.forEach((u: any) => {
          authUserMap[u.id] = u;
        });

        const users = profiles?.map((p: any) => ({
          ...p,
          email: authUserMap[p.user_id]?.email || "Unknown",
          last_sign_in: authUserMap[p.user_id]?.last_sign_in_at,
          book_count: bookCounts[p.user_id] || 0,
          roles: roleMap[p.user_id] || [],
        }));

        return new Response(JSON.stringify({ users }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "update_user": {
        const { target_user_id, display_name, birth_year, relationship } = params;
        const { error } = await adminClient
          .from("profiles")
          .update({ display_name, birth_year, relationship })
          .eq("user_id", target_user_id);

        if (error) throw error;
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "usage_stats": {
        // Get usage logs grouped by function and model
        const { data: logs } = await adminClient
          .from("api_usage_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000);

        // Aggregate by function
        const byFunction: Record<string, number> = {};
        const byModel: Record<string, number> = {};
        const byDay: Record<string, number> = {};
        let totalTokens = 0;

        logs?.forEach((l: any) => {
          byFunction[l.function_name] = (byFunction[l.function_name] || 0) + 1;
          if (l.model) byModel[l.model] = (byModel[l.model] || 0) + 1;
          const day = l.created_at.slice(0, 10);
          byDay[day] = (byDay[day] || 0) + 1;
          totalTokens += l.tokens_used || 0;
        });

        return new Response(JSON.stringify({
          totalCalls: logs?.length || 0,
          totalTokens,
          byFunction,
          byModel,
          byDay,
          recentLogs: logs?.slice(0, 50),
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "overview": {
        const { count: userCount } = await adminClient
          .from("profiles")
          .select("*", { count: "exact", head: true });

        const { count: bookCount } = await adminClient
          .from("books")
          .select("*", { count: "exact", head: true });

        const { count: orderCount } = await adminClient
          .from("print_orders")
          .select("*", { count: "exact", head: true });

        const { count: apiCallCount } = await adminClient
          .from("api_usage_logs")
          .select("*", { count: "exact", head: true });

        return new Response(JSON.stringify({
          totalUsers: userCount || 0,
          totalBooks: bookCount || 0,
          totalOrders: orderCount || 0,
          totalApiCalls: apiCallCount || 0,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (e) {
    console.error("admin-api error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
