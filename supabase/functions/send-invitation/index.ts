import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const brevoApiKey = Deno.env.get("BREVO_API_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InvitationRequest {
  group_id: string;
  invited_email: string;
  group_name: string;
  inviting_user_email: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    console.log("send-invitation: env check", {
      hasUrl: !!supabaseUrl,
      hasAnonKey: !!supabaseAnonKey,
      hasServiceRole: !!supabaseServiceRoleKey,
      hasBrevo: !!brevoApiKey,
    });

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "") ?? "";

    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(token);

    if (authError || !user) {
      console.error("Auth error:", authError?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("send-invitation: authenticated user", user.id);

    const { group_id, invited_email, group_name, inviting_user_email } =
      (await req.json()) as InvitationRequest;

    if (!group_id || !invited_email || !group_name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: membership, error: memberError } = await adminClient
      .from("group_members")
      .select("role")
      .eq("group_id", group_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError || !membership) {
      console.error("Membership check failed:", memberError?.message, "found:", membership);
      return new Response(
        JSON.stringify({ error: "You are not a member of this group" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

    console.log("send-invitation: membership ok, attempting upsert");

    const { error: dbError } = await adminClient.from("invitations").upsert(
      [{
        group_id,
        invited_email,
        invited_by: user.id,
        status: "pending",
        updated_at: new Date().toISOString(),
      }],
      { onConflict: "group_id,invited_email" },
    );

    if (dbError) {
      console.error("DB upsert error:", JSON.stringify({
        message: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint,
      }));
      return new Response(JSON.stringify({
        error: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint,
      }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    console.log("send-invitation: upsert ok, sending email");

    const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";
    const emailResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoApiKey ?? "",
      },
      body: JSON.stringify({
        sender: { name: "Expense Tracker", email: Deno.env.get("BREVO_SENDER_EMAIL") },
        to: [{ email: invited_email }],
        subject: `You're invited to join "${group_name}" on Expense Tracker`,
        htmlContent: `
          <h2>You're invited!</h2>
          <p><strong>${inviting_user_email}</strong> has invited you to join the "<strong>${group_name}</strong>" group on Expense Tracker.</p>
          <p>Open the app and look for the invitation to accept or decline.</p>
          <p>
            <a href="${appUrl}" style="
              display: inline-block;
              padding: 12px 24px;
              background-color: #007bff;
              color: white;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
            ">
              Open Expense Tracker
            </a>
          </p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const emailError = await emailResponse.json();
      // Email delivery failure is non-fatal: invitation is already in the DB.
      // To send to arbitrary addresses, verify a domain at resend.com/domains.
      console.error("Resend error (non-fatal):", JSON.stringify(emailError));
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  }
});
