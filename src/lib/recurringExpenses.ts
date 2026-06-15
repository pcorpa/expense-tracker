import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringExpense, RecurringFrequency } from "../types";

function addPeriod(date: Date, freq: RecurringFrequency): Date {
  const d = new Date(date);
  switch (freq) {
    case "weekly":       d.setDate(d.getDate() + 7); break;
    case "biweekly":     d.setDate(d.getDate() + 14); break;
    case "monthly":      d.setMonth(d.getMonth() + 1); break;
    case "bimonthly":    d.setMonth(d.getMonth() + 2); break;
    case "quarterly":    d.setMonth(d.getMonth() + 3); break;
    case "every4months": d.setMonth(d.getMonth() + 4); break;
    case "every6months": d.setMonth(d.getMonth() + 6); break;
    case "annual":       d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

/** Count how many periods fit between start_date and last_generated_date (inclusive). */
function countGeneratedPeriods(re: RecurringExpense): number {
  if (!re.last_generated_date) return 0;
  const start = new Date(re.start_date + "T00:00:00");
  const lastGen = new Date(re.last_generated_date + "T00:00:00");
  let cursor = new Date(start);
  let count = 0;
  const cap = re.total_installments ?? Infinity;
  while (cursor <= lastGen && count < cap) {
    count++;
    cursor = addPeriod(cursor, re.frequency);
  }
  return count;
}

/**
 * Generates transactions for all due dates not yet covered by last_generated_date.
 * Called client-side on page load — idempotent because we track last_generated_date.
 */
export async function generateDueTransactions(
  re: RecurringExpense,
  supabase: SupabaseClient,
  upToDate: Date
): Promise<void> {
  if (!re.is_active) return;

  const endBound = re.end_date
    ? new Date(Math.min(upToDate.getTime(), new Date(re.end_date + "T00:00:00").getTime()))
    : new Date(upToDate);
  endBound.setHours(23, 59, 59, 999);

  const startDate = new Date(re.start_date + "T00:00:00");

  // First cursor: one period after last_generated_date, or start_date itself
  let cursor: Date;
  if (re.last_generated_date) {
    cursor = addPeriod(new Date(re.last_generated_date + "T00:00:00"), re.frequency);
  } else {
    cursor = new Date(startDate);
  }
  cursor.setHours(0, 0, 0, 0);

  const alreadyPaid = countGeneratedPeriods(re);
  const cap = re.total_installments ?? Infinity;

  const dueDates: Date[] = [];
  while (cursor <= endBound) {
    if (alreadyPaid + dueDates.length >= cap) break;
    dueDates.push(new Date(cursor));
    cursor = addPeriod(cursor, re.frequency);
  }

  if (dueDates.length === 0) return;

  for (let i = 0; i < dueDates.length; i++) {
    const dateStr = dueDates[i].toISOString().split("T")[0];
    const installmentNumber =
      re.type === "installment" ? alreadyPaid + i + 1 : null;

    const { data: tx } = await supabase
      .from("transactions")
      .insert({
        group_id: re.group_id,
        user_id: re.user_id,
        type: "expense",
        is_reviewed: true,
        vendor_or_source: re.vendor_name ?? re.name,
        date: dateStr,
        total_amount: re.amount,
        currency: re.currency,
        recurring_expense_id: re.id,
        installment_number: installmentNumber,
      })
      .select()
      .single();

    if (tx) {
      await supabase.from("transaction_items").insert({
        transaction_id: tx.id,
        name: re.name,
        category: re.category,
        quantity: 1,
        unit_price: re.amount,
        item_total: re.amount,
      });
    }
  }

  const lastGenDate = dueDates[dueDates.length - 1].toISOString().split("T")[0];
  const totalPaid = alreadyPaid + dueDates.length;
  const isComplete =
    re.type === "installment" &&
    re.total_installments != null &&
    totalPaid >= re.total_installments;

  await supabase
    .from("recurring_expenses")
    .update({
      last_generated_date: lastGenDate,
      ...(isComplete ? { is_active: false, end_date: lastGenDate } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", re.id);
}

/** Count retroactive transactions that would be generated for a new template. */
export function countRetroactivePeriods(
  startDate: string,
  frequency: RecurringFrequency,
  totalInstallments?: number
): number {
  const start = new Date(startDate + "T00:00:00");
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  if (start > today) return 0;

  const cap = totalInstallments ?? Infinity;
  let cursor = new Date(start);
  let count = 0;
  while (cursor <= today && count < cap) {
    count++;
    cursor = addPeriod(cursor, frequency);
  }
  return count;
}

/** Count paid installments from last_generated_date. */
export function countPaidInstallments(re: RecurringExpense): number {
  return countGeneratedPeriods(re);
}

/**
 * Returns the last_generated_date string for a new template that starts with
 * N already-paid installments. Installment 1 lands on start_date, so
 * installment N lands on start_date + (N-1) periods.
 */
export function computeInitialLastGeneratedDate(
  startDate: string,
  frequency: RecurringFrequency,
  paidInstallments: number
): string {
  let d = new Date(startDate + "T00:00:00");
  for (let i = 1; i < paidInstallments; i++) {
    d = addPeriod(d, frequency);
  }
  return d.toISOString().split("T")[0];
}
