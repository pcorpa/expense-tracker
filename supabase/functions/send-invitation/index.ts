import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

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
      return new Response(
        JSON.stringify({ error: "You are not a member of this group" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        },
      );
    }

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
      console.error("DB upsert error:", JSON.stringify(dbError));
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

    // Try to send a Supabase auth invite email (only works for users without an account).
    // If the user already exists, this fails silently — they'll see the in-app notification instead.
    const appUrl = Deno.env.get("APP_URL") || "http://localhost:5173";
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
      invited_email,
      {
        redirectTo: `${appUrl}/invitations`,
        data: { invited_by: inviting_user_email, group_name },
      },
    );

    if (inviteError) {
      console.log("Auth invite skipped (user likely already exists):", inviteError.message);
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
