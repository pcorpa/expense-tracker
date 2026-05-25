import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import type { Transaction } from "../types";

export function ExpenseList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    setLoading(true);

    // First get user's groups
    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id)
      .then(({ data: memberships, error: membershipError }) => {
        if (membershipError || !memberships || memberships.length === 0) {
          setLoading(false);
          setTransactions([]);
          return;
        }

        const groupIds = memberships.map((m) => m.group_id);

        supabase
          .from("transactions")
          .select("*, transaction_items(*)")
          .in("group_id", groupIds)
          .order("date", { ascending: false })
          .then(({ data, error }) => {
            setLoading(false);
            if (error) {
              setError(error.message);
              return;
            }
            setTransactions(data ?? []);
          });
      });
  }, [user]);

  return (
    <main className="page">
      <div className="page__header">
        <div>
          <p className="eyebrow">Transactions</p>
          <h1>All tracked transactions</h1>
          <p>Browse the expenses and income entries created in your groups.</p>
        </div>
      </div>

      <div className="content-block">
        {loading && <p>Loading transactions…</p>}
        {error && <div className="alert">{error}</div>}
        {!loading && !transactions.length && (
          <p>No transactions were found yet.</p>
        )}

        <div className="table-wrapper">
          {transactions.map((transaction) => (
            <article key={transaction.id} className="ticket-card">
              <div className="ticket-card__header">
                <div>
                  <strong>
                    {transaction.vendor_or_source ?? "Unknown source"}
                  </strong>
                  <span>{transaction.date ?? "No date"}</span>
                </div>
                <div>
                  <span>{transaction.type.toUpperCase()}</span>
                  <strong>
                    ${transaction.total_amount?.toFixed(2) ?? "0.00"}
                  </strong>
                </div>
              </div>
              <p className="small-text">
                {transaction.is_reviewed ? "Reviewed" : "Pending review"}
              </p>
              {transaction.transaction_items?.length ? (
                <div className="ticket-card__products">
                  {transaction.transaction_items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="item-row-btn"
                      onClick={() =>
                        navigate(`/review/${transaction.id}/items/${item.id}`)
                      }
                    >
                      <div className="item-row-btn__left">
                        <span className="item-row-btn__name">
                          {item.name || "Unnamed item"}
                        </span>
                        {item.category && (
                          <span className="item-row-btn__category">
                            {item.category}
                          </span>
                        )}
                      </div>
                      <div className="item-row-btn__right">
                        <span className="item-row-btn__math">
                          {item.quantity ?? 1} × $
                          {(item.unit_price ?? 0).toFixed(2)}
                        </span>
                        <strong className="item-row-btn__total">
                          ${(item.item_total ?? 0).toFixed(2)}
                        </strong>
                        <span className="item-row-btn__chevron">›</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}
