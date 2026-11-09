-- Esquema de l'app de comandes. L'app el crea automàticament en arrencar,
-- però també es pot executar a mà al SQL Editor de Supabase.

create table if not exists schools (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists providers (
  id text primary key,
  name text not null,
  channel text not null default 'email' check (channel in ('email', 'whatsapp', 'phone', 'print')),
  emails text[] not null default '{}',
  phone text not null default '',
  aliases text[] not null default '{}',
  notes text not null default '',
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null references providers(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (provider_id, name)
);

create table if not exists settings (
  key text primary key,
  value text not null
);

create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  week_id text not null,
  school_id uuid not null references schools(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'review', 'confirmed')),
  observations text not null default '',
  detected_school text,
  week_text text,
  reading boolean not null default false,
  read_error text,
  version integer not null default 0,
  updated_at timestamptz,
  unique (week_id, school_id)
);

create table if not exists submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  position integer not null default 0,
  provider_id text references providers(id) on delete set null,
  product text not null default '',
  quantity text not null default '',
  day text not null default '',
  note text not null default '',
  ai_note text not null default '',
  confidence text not null default 'alta',
  in_catalog boolean not null default true,
  source text not null default 'manual'
);
create index if not exists submission_items_submission_idx on submission_items (submission_id);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references submissions(id) on delete cascade,
  storage_path text not null,
  media_type text not null,
  read boolean not null default false,
  uploaded_at timestamptz not null default now()
);
create index if not exists photos_submission_idx on photos (submission_id);

create table if not exists sent_orders (
  week_id text not null,
  provider_id text not null references providers(id) on delete cascade,
  sent_at timestamptz not null default now(),
  via text not null default '',
  recipients text not null default '',
  primary key (week_id, provider_id)
);

-- Les taules només les fa servir el servidor de l'app (connexió directa a Postgres).
-- Activem RLS sense polítiques perquè ningú hi pugui accedir amb la clau pública (anon).
alter table schools enable row level security;
alter table providers enable row level security;
alter table products enable row level security;
alter table settings enable row level security;
alter table submissions enable row level security;
alter table submission_items enable row level security;
alter table photos enable row level security;
alter table sent_orders enable row level security;
