/**
 * Dev-only CSV import script — loads Google Sheets receipt data into Supabase.
 *
 * USAGE:
 *   pnpm tsx scripts/import-csv.ts <path-to-csv>
 *
 * REQUIREMENTS:
 *   Set SUPABASE_SERVICE_ROLE_KEY in your environment (or .env.local).
 *   Find it in: Supabase Dashboard → Project Settings → API → service_role (secret).
 *
 *   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *   pnpm tsx scripts/import-csv.ts "Registro_Gastos_2026 - data_entry_GAi-2.csv"
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'https://hppnikjyivfyueaarlzq.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const USER_EMAIL = 'p.correia.pastorini@gmail.com';
const CURRENCY = 'UY$';
const DATE_FORMAT: 'DD/MM/YYYY' | 'MM/DD/YYYY' = 'DD/MM/YYYY';

// ── Date normalizer (mirrors src/lib/dateUtils.ts) ───────────────────────────

function isValidDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function normalizeDate(raw: string, format: 'DD/MM/YYYY' | 'MM/DD/YYYY'): string | null {
  if (!raw || raw.trim() === '' || raw.toLowerCase() === 'unknown') return null;
  raw = raw.trim();

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso.map(Number);
    return isValidDate(y, m, d) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  }

  const parts = raw.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/);
  if (parts) {
    const a = +parts[1], b = +parts[2];
    const rawYear = parts[3];
    const year = rawYear.length === 2 ? 2000 + +rawYear : +rawYear;
    let day: number, month: number;
    if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else if (format === 'DD/MM/YYYY') { day = a; month = b; }
    else { month = a; day = b; }
    if (isValidDate(year, month, day)) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  return null;
}

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return [];

  function splitLine(line: string): string[] {
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  }

  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (vals[i] ?? '').trim(); });
    return row;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: pnpm tsx scripts/import-csv.ts <path-to-csv>');
    process.exit(1);
  }
  if (!SERVICE_ROLE_KEY) {
    console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable is not set.');
    console.error('Find it in: Supabase Dashboard → Project Settings → API → service_role');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Resolve user + group ────────────────────────────────────────────────

  const { data: profileRow, error: profileErr } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', USER_EMAIL)
    .single();
  if (profileErr || !profileRow) {
    console.error('Could not find user with email', USER_EMAIL, profileErr?.message);
    process.exit(1);
  }
  const userId: string = profileRow.id;

  const { data: memberRow, error: memberErr } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId)
    .limit(1)
    .single();
  if (memberErr || !memberRow) {
    console.error('User has no group membership', memberErr?.message);
    process.exit(1);
  }
  const groupId: string = memberRow.group_id;
  console.log(`User: ${userId}  Group: ${groupId}`);

  // ── 2. Parse CSV ───────────────────────────────────────────────────────────

  const raw = fs.readFileSync(path.resolve(csvPath), 'utf8');
  const rows = parseCSV(raw);
  console.log(`Parsed ${rows.length} rows from CSV`);

  // Column name aliases (the CSV header has special characters and length variations)
  const get = (row: Record<string, string>, ...keys: string[]): string => {
    for (const k of keys) {
      const found = Object.keys(row).find((h) => h.toLowerCase().includes(k.toLowerCase()));
      if (found) return row[found] ?? '';
    }
    return '';
  };

  // ── 3. Group rows into transactions by (Fecha, Vendedor, Ciudad) ──────────

  type ItemRow = {
    name: string;
    category: string;
    quantity: number;
    unit_price: number;
    item_total: number;
  };

  type TxGroup = {
    date: string | null;
    vendor: string | null;
    city: string | null;
    items: ItemRow[];
  };

  const grouped = new Map<string, TxGroup>();

  for (const row of rows) {
    const fecha = get(row, 'Fecha');
    const vendedor = get(row, 'Vendedor').replace(/\n/g, ' ').trim();
    const ciudad = get(row, 'Ciudad');
    const product = get(row, 'Producto');
    const categoria = get(row, 'Categoria', 'Categoría');
    const qty = parseFloat(get(row, 'Unidades')) || 1;
    const unitPrice = parseFloat(get(row, 'Precio unitario', 'Precio')) || 0;
    const itemTotal = parseFloat(get(row, 'Valor total')) || 0;


    const normalizedVendor = vendedor || null;
    const normalizedDate = normalizeDate(fecha, DATE_FORMAT);
    const normalizedCity = ciudad && ciudad.toLowerCase() !== 'unknown' ? ciudad : null;

    const key = `${normalizedDate ?? 'null'}__${normalizedVendor ?? 'null'}__${normalizedCity ?? 'null'}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        date: normalizedDate,
        vendor: normalizedVendor,
        city: normalizedCity,
        items: [],
      });
    }

    const ALLOWED_CATEGORIES = [
      'Comida', 'Limpieza', 'Salud', 'Entretenimiento', 'Hogar',
      'Transporte', 'Vestimenta', 'Restaurante', 'Cuidado Personal',
      'Mascotas', 'Servicios', 'Educación', 'Tecnología', 'Otro',
    ];

    grouped.get(key)!.items.push({
      name: product || 'Unknown',
      category: ALLOWED_CATEGORIES.includes(categoria) ? categoria : 'Otro',
      quantity: qty,
      unit_price: unitPrice,
      item_total: itemTotal,
    });
  }

  console.log(`Grouped into ${grouped.size} transactions`);

  // ── 4. Insert ──────────────────────────────────────────────────────────────

  let txInserted = 0;
  let itemsInserted = 0;
  let errors = 0;

  for (const [key, tx] of grouped) {
    const totalAmount = tx.items.reduce((s, i) => s + i.item_total, 0);

    const { data: txData, error: txErr } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        group_id: groupId,
        type: 'expense',
        is_reviewed: true,
        vendor_or_source: tx.vendor,
        date: tx.date,
        total_amount: Math.round(totalAmount * 100) / 100,
        currency: CURRENCY,
      })
      .select('id')
      .single();

    if (txErr || !txData) {
      console.error(`  FAILED transaction [${key}]:`, txErr?.message);
      errors++;
      continue;
    }

    const itemRows = tx.items.map((item) => ({
      transaction_id: txData.id,
      product_id: null,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit_price: item.unit_price,
      item_total: item.item_total,
    }));

    const { error: itemsErr } = await supabase.from('transaction_items').insert(itemRows);
    if (itemsErr) {
      console.error(`  FAILED items for transaction ${txData.id}:`, itemsErr.message);
      errors++;
      continue;
    }

    txInserted++;
    itemsInserted += itemRows.length;
    console.log(`  ✓ ${tx.date ?? 'no-date'} | ${tx.vendor ?? 'no-vendor'} | ${itemRows.length} items | total ${totalAmount.toFixed(2)}`);
  }

  console.log(`\nDone. ${txInserted} transactions, ${itemsInserted} items inserted. ${errors} errors.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
