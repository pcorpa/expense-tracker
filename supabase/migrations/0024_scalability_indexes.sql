-- Scalability indexes identified in Phase 9 architectural review (June 2026)

-- ── transactions ──────────────────────────────────────────────────────────────

-- Composite index for date-range filtering scoped to a group.
-- All list views (ExpenseList, ReviewQueue) filter by group_id + order by date.
-- Without this, Postgres scans the full transactions table and filters post-hoc.
create index if not exists transactions_group_id_date_idx
  on transactions(group_id, date desc);

-- ── group_members ─────────────────────────────────────────────────────────────

-- Composite index for RLS subquery evaluation.
-- Every RLS policy on group-scoped tables runs:
--   exists (select 1 from group_members where user_id = auth.uid() and group_id = ...)
-- The existing single-column user_id index narrows to the right user but Postgres
-- must still filter on group_id from the heap. This composite index satisfies
-- both predicates in a single index seek with no heap fetch.
create index if not exists group_members_user_id_group_id_idx
  on group_members(user_id, group_id);
