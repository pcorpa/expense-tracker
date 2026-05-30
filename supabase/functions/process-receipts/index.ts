import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ALLOWED_CATEGORIES = [
  'Comida', 'Limpieza', 'Salud', 'Entretenimiento', 'Hogar',
  'Transporte', 'Vestimenta', 'Restaurante', 'Cuidado Personal',
  'Mascotas', 'Servicios', 'Educación', 'Tecnología', 'Otro',
];

const responseSchema = {
  type: 'OBJECT',
  properties: {
    filename: { type: 'STRING' },
    date: { type: 'STRING' },
    vendor: { type: 'STRING' },
    city: { type: 'STRING' },
    total_amount: { type: 'NUMBER' },
    currency: { type: 'STRING' },
    products: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING' },
          unit_price: { type: 'NUMBER' },
          quantity: { type: 'NUMBER' },
          item_total_from_ticket: { type: 'NUMBER' },
        },
        required: ['name', 'category', 'unit_price', 'quantity', 'item_total_from_ticket'],
      },
    },
  },
  required: ['filename', 'date', 'vendor', 'city', 'total_amount', 'currency', 'products'],
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!GEMINI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY secret is not set in Supabase dashboard' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const body = await req.json();
    const receiptId = body?.receipt_id;

    if (!receiptId) {
      return new Response(JSON.stringify({ error: 'receipt_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    console.log('[1/5] START update receipt status → processing. receipt_id:', receiptId);
    await supabase.from('receipts').update({ status: 'processing' }).eq('id', receiptId);
    console.log('[1/5] DONE update receipt status → processing');

    console.log('[2/5] START fetch receipt row from DB');
    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .select('id, user_id, group_id, image_url')
      .eq('id', receiptId)
      .single();
    if (receiptError || !receipt) {
      console.error('[2/5] FAILED fetch receipt row:', receiptError?.code, receiptError?.message);
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: receiptError?.message ?? 'Receipt not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    console.log('[2/5] DONE fetch receipt row');

    const base64Image: string = body.image_data;
    const mimeType: string = body.mime_type || 'image/jpeg';
    const fileName = receipt.image_url.split('/').pop() ?? 'unknown';

    const prompt = `Analiza este ticket. Nombre: ${fileName}.
Categorías permitidas: Comida, Limpieza, Salud, Entretenimiento, Hogar, Transporte, Vestimenta, Restaurante, Cuidado Personal, Mascotas, Servicios, Educación, Tecnología, Otro.
Reglas:
1. 'unit_price': Precio unitario.
2. 'quantity': Cantidad o peso.
3. 'item_total_from_ticket': El precio final de la línea.
4. Usa 'Unknown' si no es legible.`;

    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      generation_config: {
        response_mime_type: 'application/json',
        response_schema: responseSchema,
      },
    };

    console.log('[3/5] START call Gemini API');
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );
    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('[3/5] FAILED Gemini API. status:', geminiResponse.status, 'body:', errorText);
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: `Gemini API error: ${errorText}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    const geminiData = await geminiResponse.json();
    const extractedData = JSON.parse(geminiData.candidates[0].content.parts[0].text);
    console.log('[3/5] DONE Gemini API. vendor:', extractedData.vendor, 'products:', extractedData.products?.length);

    const itemSum = extractedData.products.reduce(
      (sum: number, item: any) => sum + (item.item_total_from_ticket ?? 0),
      0,
    );
    const totalAmount = extractedData.total_amount ?? 0;
    const mathWarning =
      Math.abs(itemSum - totalAmount) > Math.abs(totalAmount) * 0.01
        ? `Item sum (${itemSum.toFixed(2)}) differs from total (${totalAmount.toFixed(2)}) by more than 1%`
        : null;

    const city = extractedData.city && extractedData.city !== 'Unknown' ? extractedData.city : null;

    console.log('[4/5] START insert transaction + items');
    const { data: transactionData, error: transactionError } = await supabase
      .from('transactions')
      .insert([
        {
          receipt_id: receiptId,
          user_id: receipt.user_id,
          group_id: receipt.group_id,
          type: 'expense',
          is_reviewed: false,
          vendor_or_source: extractedData.vendor !== 'Unknown' ? extractedData.vendor : null,
          date: extractedData.date !== 'Unknown' ? extractedData.date : null,
          total_amount: totalAmount,
          currency: extractedData.currency ?? 'UY$',
        },
      ])
      .select('id')
      .single();

    if (transactionError || !transactionData) {
      console.error('[4/5] FAILED insert transaction:', transactionError?.message);
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: transactionError?.message ?? 'Failed to create transaction' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

    // product_id is intentionally NULL — the client-side normalization pipeline
    // (fuzzy matching + ProductAudit human review) will assign canonical products.
    const itemsToInsert = extractedData.products.map((product: any) => {
      const name = product.name && product.name !== 'Unknown' ? product.name : null;
      const category = ALLOWED_CATEGORIES.includes(product.category) ? product.category : 'Otro';
      return {
        transaction_id: transactionData.id,
        product_id: null,
        name: name ?? 'Unknown',
        category,
        quantity: product.quantity ?? 1,
        unit_price: product.unit_price ?? 0,
        item_total: product.item_total_from_ticket ?? 0,
      };
    });

    const { error: itemsError } = await supabase.from('transaction_items').insert(itemsToInsert);
    if (itemsError) {
      console.error('[4/5] FAILED insert items:', itemsError.message);
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: itemsError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    console.log('[4/5] DONE insert transaction + items. transaction_id:', transactionData.id);

    console.log('[5/5] START update receipt status → needs_review');
    const { error: receiptUpdateError } = await supabase
      .from('receipts')
      .update({ status: 'needs_review', raw_ocr_json: extractedData, city })
      .eq('id', receiptId);
    if (receiptUpdateError) {
      console.error('[5/5] FAILED update receipt status:', receiptUpdateError.message);
      return new Response(JSON.stringify({ error: receiptUpdateError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
    console.log('[5/5] DONE update receipt status → needs_review');

    return new Response(
      JSON.stringify({ status: 'success', transaction_id: transactionData.id, math_warning: mathWarning }),
      { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  } catch (error) {
    console.error('[process-receipts] Unhandled exception:', error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    );
  }
});
