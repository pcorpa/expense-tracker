import { serve } from 'std/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in function environment');
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

serve(async (req) => {
  try {
    const body = await req.json();
    const ticketId = body?.ticket_id;

    if (!ticketId) {
      return new Response(JSON.stringify({ error: 'ticket_id is required' }), { status: 400 });
    }

    const { data: ticket, error: fetchError } = await supabase
      .from('tickets')
      .select('*')
      .eq('id', ticketId)
      .single();

    if (fetchError || !ticket) {
      return new Response(JSON.stringify({ error: fetchError?.message ?? 'Ticket not found' }), { status: 404 });
    }

    // TODO: Call Google Gemini API with the image stored in Supabase Storage.
    // Then map the Gemini response to the ticket record and products table.

    return new Response(JSON.stringify({ status: 'ok', ticket_id: ticketId }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
