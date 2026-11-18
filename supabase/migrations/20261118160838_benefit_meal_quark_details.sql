alter table public.benefit_meal_rows
  add column quark_details jsonb
  check (quark_details is null or jsonb_typeof(quark_details) = 'object');

comment on column public.benefit_meal_rows.quark_details is
  'Opções de alimentação e tipos administrativos de ausência, consultados separadamente para esta apuração. Mantém as políticas de acesso da linha original.';

notify pgrst, 'reload schema';
