import { serve } from 'npm:std/server';
import { createClient } from 'npm:@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GEMINI_API_KEY) {
  throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GEMINI_API_KEY');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

serve(async (req) => {
  try {
    const body = await req.json();
    const receiptId = body?.receipt_id;

    if (!receiptId) {
      return new Response(JSON.stringify({ error: 'receipt_id is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await supabase.from('receipts').update({ status: 'processing' }).eq('id', receiptId);

    const { data: receipt, error: receiptError } = await supabase
      .from('receipts')
      .select('*')
      .eq('id', receiptId)
      .single();

    if (receiptError || !receipt) {
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: receiptError?.message ?? 'Receipt not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: imageData, error: imageError } = await supabase.storage
      .from('receipts')
      .download(receipt.image_url);

    if (imageError || !imageData) {
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: imageError?.message ?? 'Failed to fetch image' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const imageBytes = await imageData.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(imageBytes)));

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
                mime_type: 'image/jpeg',
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
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: `Gemini API error: ${errorText}` }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const geminiData = await geminiResponse.json();
    const extractedData = JSON.parse(geminiData.candidates[0].content.parts[0].text);

    // Validate 1% tolerance: |sum(item_total) - total_amount| ≤ total_amount × 0.01
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
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: transactionError?.message ?? 'Failed to create transaction' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Upsert each product into the catalog and collect product IDs
    const itemsToInsert = await Promise.all(
      extractedData.products.map(async (product: any) => {
        const name = product.name && product.name !== 'Unknown' ? product.name : null;
        const category = ALLOWED_CATEGORIES.includes(product.category) ? product.category : 'Otro';
        const unitPrice = product.unit_price ?? null;
        const quantity = product.quantity ?? 1;
        const itemTotal = product.item_total_from_ticket ?? null;

        let productId: string | null = null;
        if (name) {
          const { data: existingProduct } = await supabase
            .from('products')
            .select('id')
            .eq('group_id', receipt.group_id)
            .eq('name', name)
            .maybeSingle();

          if (existingProduct) {
            productId = existingProduct.id;
          } else {
            const { data: newProduct } = await supabase
              .from('products')
              .insert({ group_id: receipt.group_id, name, category })
              .select('id')
              .single();
            if (newProduct) productId = newProduct.id;
          }
        }

        return {
          transaction_id: transactionData.id,
          product_id: productId,
          name: name ?? 'Unknown',
          category,
          quantity,
          unit_price: unitPrice ?? 0,
          item_total: itemTotal ?? 0,
        };
      }),
    );

    const { error: itemsError } = await supabase.from('transaction_items').insert(itemsToInsert);

    if (itemsError) {
      await supabase.from('receipts').update({ status: 'error' }).eq('id', receiptId);
      return new Response(JSON.stringify({ error: itemsError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await supabase
      .from('receipts')
      .update({ status: 'needs_review', raw_ocr_json: extractedData, city })
      .eq('id', receiptId);

    return new Response(
      JSON.stringify({ status: 'success', transaction_id: transactionData.id, math_warning: mathWarning }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
