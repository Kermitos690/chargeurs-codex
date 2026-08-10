-- eject-after-payment records exactly one supplier order for each local rental.
-- PostgREST can only infer the upsert target from a real constraint, not a
-- foreign key alone.
alter table public.apifox_orders
  add constraint apifox_orders_rental_session_id_key unique (rental_session_id);
