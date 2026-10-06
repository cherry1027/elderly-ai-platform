import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TIER_PRICES: Record<string, { pages: number; price: number; label: string }> = {
  p24: { pages: 24, price: 399, label: "24 sidor" },
  p36: { pages: 36, price: 549, label: "36 sidor" },
  p48: { pages: 48, price: 699, label: "48 sidor" },
  p72: { pages: 72, price: 899, label: "72 sidor" },
};
const CUSTOM_BASE = 24;
const CUSTOM_BASE_PRICE = 399;
const EXTRA_PAGE = 12;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const token = authHeader.replace("Bearer ", "");
    const { data } = await supabaseClient.auth.getUser(token);
    const user = data.user;
    if (!user?.email) throw new Error("User not authenticated");

    const body = await req.json();
    const { bookId, tier, customPages, quantity } = body;
    if (!bookId || !tier) throw new Error("Missing bookId or tier");

    let pages: number;
    let price: number;
    let label: string;

    if (tier === "custom") {
      pages = Math.max(CUSTOM_BASE, Number(customPages) || CUSTOM_BASE);
      price = CUSTOM_BASE_PRICE + Math.max(0, pages - CUSTOM_BASE) * EXTRA_PAGE;
      label = `Tryckt bok (${pages} sidor)`;
    } else {
      const t = TIER_PRICES[tier];
      if (!t) throw new Error("Invalid tier");
      pages = t.pages;
      price = t.price;
      label = `Tryckt bok (${t.label})`;
    }

    const qty = Math.max(1, Math.min(20, Number(quantity) || 1));

    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
      apiVersion: "2025-08-27.basil",
    });

    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    const customerId = customers.data[0]?.id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : user.email,
      line_items: [
        {
          price_data: {
            currency: "sek",
            product_data: { name: label },
            unit_amount: price * 100,
          },
          quantity: qty,
        },
      ],
      mode: "payment",
      shipping_address_collection: { allowed_countries: ["SE"] },
      success_url: `${req.headers.get("origin")}/betalning-klar?session_id={CHECKOUT_SESSION_ID}&book_id=${bookId}&print=1`,
      cancel_url: `${req.headers.get("origin")}/bok/${bookId}/tryck`,
      metadata: {
        user_id: user.id,
        book_id: bookId,
        tier,
        pages: String(pages),
        order_type: "print",
      },
    });

    // Record pending order using service role (bypass RLS not needed — user owns the row)
    await supabaseClient.from("print_orders").insert({
      user_id: user.id,
      book_id: bookId,
      order_type: tier,
      quantity: qty,
      price,
      status: "pending",
    });

    return new Response(JSON.stringify({ url: session.url, price, pages }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("create-print-payment error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
