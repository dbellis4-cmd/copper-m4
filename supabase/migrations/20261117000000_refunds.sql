-- Module 4: the refund flow (specs/module-4/spec.md, section 8).
-- Three tables: the demo customer's orders, every refund request, and the
-- auto-refund limit. Anyone can read them (the Refund Console has no login);
-- only the app's server can write, using the secret key, which skips these
-- policies. So nobody can mark a refund approved from the browser.

create table if not exists orders (
  id integer primary key,
  customer text not null,
  item text not null,
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  ordered_at date not null
);

create table if not exists refunds (
  id bigint generated always as identity primary key,
  -- One refund per order, ever: a second request for the same order fails
  -- here even if two arrive at the same moment.
  order_id integer not null unique references orders (id),
  amount_usd numeric(10, 2) not null check (amount_usd > 0),
  -- The limit when it was requested, so the console can say why it waited.
  limit_usd numeric(10, 2) not null check (limit_usd >= 0),
  status text not null
    check (status in ('refunded_auto', 'waiting', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists refund_settings (
  -- Always exactly one row.
  id integer primary key default 1 check (id = 1),
  auto_refund_limit_usd numeric(10, 2) not null
    check (auto_refund_limit_usd >= 0)
);

alter table orders enable row level security;
alter table refunds enable row level security;
alter table refund_settings enable row level security;

create policy "orders are readable by anyone" on orders for select using (true);
create policy "refunds are readable by anyone" on refunds for select using (true);
create policy "refund settings are readable by anyone" on refund_settings
  for select using (true);

-- The demo data: Maya Reyes's orders (prices from the catalog) and a $50 limit.
insert into orders (id, customer, item, amount_usd, ordered_at) values
  (1001, 'Maya Reyes', 'Copper Plus, monthly', 7.99, '2026-11-01'),
  (1002, 'Maya Reyes', 'Copper Plus, annual', 79.00, '2026-11-05'),
  (1003, 'Maya Reyes', 'Copper Notes', 129.00, '2026-11-08'),
  (1004, 'Maya Reyes', 'Copper Home', 149.00, '2026-11-10')
on conflict (id) do nothing;

insert into refund_settings (id, auto_refund_limit_usd) values (1, 50)
on conflict (id) do nothing;
