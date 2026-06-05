-- ============================================================
-- CDM26 Fantasy — Migration initiale
-- ============================================================

-- 1. JOUEURS (importé via CSV)
create table cdm_players (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  position                text not null check (position in ('GK','DEF','MID','ATT')),
  team                    text not null,
  nationality             text not null,
  transfermarkt_value_m   numeric(8,2) not null default 0,
  sofascore_id            text unique,
  photo_url               text,
  active                  boolean default true,
  created_at              timestamptz default now()
);

-- 2. ÉQUIPES NATIONALES avec cotes
create table cdm_teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  odds_winner   numeric(8,2),   -- cote décimale victoire finale
  team_score    numeric(8,4),   -- calculé : 1 / odds_winner
  updated_at    timestamptz default now()
);

-- 3. PRIX DES JOUEURS PAR PHASE
create table cdm_prices (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid references cdm_players(id) on delete cascade,
  phase       text not null check (phase in ('initial','post_poule','post_8','post_quart','post_demi')),
  team_odds   numeric(8,2),
  price       numeric(8,1) not null,
  computed_at timestamptz default now(),
  unique(player_id, phase)
);

-- 4. LIGUES
create table cdm_leagues (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  code            text unique not null,   -- code invitation 6 chars
  admin_user_id   uuid references auth.users(id),
  phase           text not null default 'draft'
                  check (phase in ('draft','poule','post_poule','huitieme','post_8','quart','post_quart','demi','post_demi','finale','termine')),
  budget_per_user numeric(10,1) not null default 1000,
  draft_open      boolean default false,
  market_open     boolean default false,
  created_at      timestamptz default now()
);

-- 5. PARTICIPANTS
create table cdm_participants (
  id               uuid primary key default gen_random_uuid(),
  league_id        uuid references cdm_leagues(id) on delete cascade,
  user_id          uuid references auth.users(id),
  display_name     text not null,
  budget_remaining numeric(10,1) not null,
  joined_at        timestamptz default now(),
  unique(league_id, user_id)
);

-- 6. SQUAD (achats / ventes)
create table cdm_squads (
  id               uuid primary key default gen_random_uuid(),
  league_id        uuid references cdm_leagues(id) on delete cascade,
  participant_id   uuid references cdm_participants(id) on delete cascade,
  player_id        uuid references cdm_players(id),
  bought_at_price  numeric(8,1) not null,
  bought_at_phase  text not null,
  sold_at_price    numeric(8,1),
  sold_at_phase    text,
  sold_at          timestamptz,
  active           boolean default true,
  created_at       timestamptz default now()
);

-- 7. MATCHS CDM
create table cdm_matches (
  id                  uuid primary key default gen_random_uuid(),
  sofascore_match_id  text unique not null,
  phase               text not null,
  round               text,
  home_team           text not null,
  away_team           text not null,
  match_date          timestamptz not null,
  processed           boolean default false,
  created_at          timestamptz default now()
);

-- 8. NOTES JOUEURS PAR MATCH
create table cdm_scores (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid references cdm_players(id) on delete cascade,
  match_id            uuid references cdm_matches(id) on delete cascade,
  sofascore_match_id  text,
  rating              numeric(4,2),   -- ex: 7.42
  minutes_played      int default 0,
  match_date          timestamptz,
  fetched_at          timestamptz default now(),
  unique(player_id, match_id)
);

-- ============================================================
-- INDEXES
-- ============================================================
create index on cdm_squads(league_id, participant_id) where active = true;
create index on cdm_scores(player_id);
create index on cdm_scores(match_id);
create index on cdm_prices(player_id, phase);
create index on cdm_players(team);
create index on cdm_players(position);

-- ============================================================
-- RLS
-- ============================================================
alter table cdm_players      enable row level security;
alter table cdm_teams        enable row level security;
alter table cdm_prices       enable row level security;
alter table cdm_leagues      enable row level security;
alter table cdm_participants enable row level security;
alter table cdm_squads       enable row level security;
alter table cdm_matches      enable row level security;
alter table cdm_scores       enable row level security;

-- Lecture publique : joueurs, équipes, prix, matchs, notes
create policy "public read players"  on cdm_players  for select using (true);
create policy "public read teams"    on cdm_teams    for select using (true);
create policy "public read prices"   on cdm_prices   for select using (true);
create policy "public read matches"  on cdm_matches  for select using (true);
create policy "public read scores"   on cdm_scores   for select using (true);

-- Ligues
create policy "read league if member" on cdm_leagues for select
  using (
    auth.uid() = admin_user_id
    or exists (
      select 1 from cdm_participants p
      where p.league_id = cdm_leagues.id and p.user_id = auth.uid()
    )
  );
create policy "admin manages league" on cdm_leagues for all
  using (auth.uid() = admin_user_id);

-- Participants
create policy "read participants in league" on cdm_participants for select
  using (
    exists (
      select 1 from cdm_participants me
      where me.league_id = cdm_participants.league_id and me.user_id = auth.uid()
    )
    or exists (
      select 1 from cdm_leagues l
      where l.id = cdm_participants.league_id and l.admin_user_id = auth.uid()
    )
  );
create policy "insert own participant" on cdm_participants for insert
  with check (auth.uid() = user_id);
create policy "update own participant" on cdm_participants for update
  using (auth.uid() = user_id);

-- Squads
create policy "read squads in league" on cdm_squads for select
  using (
    exists (
      select 1 from cdm_participants p
      where p.id = cdm_squads.participant_id
        and exists (
          select 1 from cdm_participants me
          where me.league_id = p.league_id and me.user_id = auth.uid()
        )
    )
  );
create policy "manage own squad" on cdm_squads for all
  using (
    exists (
      select 1 from cdm_participants p
      where p.id = cdm_squads.participant_id and p.user_id = auth.uid()
    )
  );

-- ============================================================
-- VUE : classement général
-- ============================================================
create or replace view cdm_standings as
select
  p.league_id,
  p.id                              as participant_id,
  p.user_id,
  p.display_name,
  p.budget_remaining,
  coalesce(sum(sc.rating), 0)       as total_points,
  coalesce(sum(sq.bought_at_price), 0) as total_spent,
  case
    when coalesce(sum(sq.bought_at_price), 0) > 0
    then round(coalesce(sum(sc.rating), 0) / sum(sq.bought_at_price) * 100, 2)
    else 0
  end                               as value_for_money
from cdm_participants p
left join cdm_squads sq on sq.participant_id = p.id and sq.active = true
left join cdm_scores sc on sc.player_id = sq.player_id
group by p.league_id, p.id, p.user_id, p.display_name, p.budget_remaining;

-- ============================================================
-- VUE : détail squad
-- ============================================================
create or replace view cdm_squad_detail as
select
  sq.league_id,
  sq.participant_id,
  sq.id                             as squad_id,
  sq.active,
  sq.bought_at_price,
  sq.bought_at_phase,
  sq.sold_at_price,
  pl.id                             as player_id,
  pl.name                           as player_name,
  pl.position,
  pl.team,
  pl.photo_url,
  coalesce(sum(sc.rating), 0)       as total_rating,
  count(sc.id)                      as matches_played
from cdm_squads sq
join cdm_players pl on pl.id = sq.player_id
left join cdm_scores sc on sc.player_id = sq.player_id
group by
  sq.league_id, sq.participant_id, sq.id, sq.active,
  sq.bought_at_price, sq.bought_at_phase, sq.sold_at_price,
  pl.id, pl.name, pl.position, pl.team, pl.photo_url;
