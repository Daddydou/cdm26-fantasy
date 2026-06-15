-- ============================================================
-- CDM26 Fantasy — Migration 006
-- Phases finales : multiplicateurs de points + calendrier knockout
-- ============================================================

-- 1. Colonne multiplicateur (DEFAULT 1.0 → poule inchangée)
ALTER TABLE fantasy_matches
  ADD COLUMN IF NOT EXISTS points_multiplier numeric NOT NULL DEFAULT 1.0;

-- 2. Suppression des matchs knockout vides (aucun score attaché)
DELETE FROM fantasy_matches
WHERE phase IN ('huitieme', 'quart', 'demi', 'finale');

-- 3. Insertion des 32 matchs knockout avec multiplicateurs
INSERT INTO fantasy_matches
  (sofascore_match_id, phase, round, home_team, away_team, match_date, processed, points_multiplier)
VALUES
  -- 1/16 de finale (×1.2) — 28 juin → 5 juillet
  ('ko_s16_01', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-06-28 18:00:00+00', false, 1.2),
  ('ko_s16_02', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-06-28 21:00:00+00', false, 1.2),
  ('ko_s16_03', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-06-29 18:00:00+00', false, 1.2),
  ('ko_s16_04', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-06-29 21:00:00+00', false, 1.2),
  ('ko_s16_05', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-06-30 18:00:00+00', false, 1.2),
  ('ko_s16_06', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-06-30 21:00:00+00', false, 1.2),
  ('ko_s16_07', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-01 18:00:00+00', false, 1.2),
  ('ko_s16_08', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-01 21:00:00+00', false, 1.2),
  ('ko_s16_09', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-02 18:00:00+00', false, 1.2),
  ('ko_s16_10', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-02 21:00:00+00', false, 1.2),
  ('ko_s16_11', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-03 18:00:00+00', false, 1.2),
  ('ko_s16_12', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-03 21:00:00+00', false, 1.2),
  ('ko_s16_13', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-04 18:00:00+00', false, 1.2),
  ('ko_s16_14', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-04 21:00:00+00', false, 1.2),
  ('ko_s16_15', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-05 18:00:00+00', false, 1.2),
  ('ko_s16_16', 'seizieme',    '1/16 de finale',  'TBD', 'TBD', '2026-07-05 21:00:00+00', false, 1.2),
  -- 1/8 de finale (×1.4) — 6 → 9 juillet
  ('ko_s8_01',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-06 18:00:00+00', false, 1.4),
  ('ko_s8_02',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-06 21:00:00+00', false, 1.4),
  ('ko_s8_03',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-07 18:00:00+00', false, 1.4),
  ('ko_s8_04',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-07 21:00:00+00', false, 1.4),
  ('ko_s8_05',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-08 18:00:00+00', false, 1.4),
  ('ko_s8_06',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-08 21:00:00+00', false, 1.4),
  ('ko_s8_07',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-09 18:00:00+00', false, 1.4),
  ('ko_s8_08',  'huitieme',    '1/8 de finale',   'TBD', 'TBD', '2026-07-09 21:00:00+00', false, 1.4),
  -- Quarts de finale (×1.6) — 11 → 13 juillet
  ('ko_q_01',   'quart',       'Quart de finale', 'TBD', 'TBD', '2026-07-11 18:00:00+00', false, 1.6),
  ('ko_q_02',   'quart',       'Quart de finale', 'TBD', 'TBD', '2026-07-11 21:00:00+00', false, 1.6),
  ('ko_q_03',   'quart',       'Quart de finale', 'TBD', 'TBD', '2026-07-12 21:00:00+00', false, 1.6),
  ('ko_q_04',   'quart',       'Quart de finale', 'TBD', 'TBD', '2026-07-13 21:00:00+00', false, 1.6),
  -- Demi-finales (×1.8) — 14 + 15 juillet
  ('ko_sf_01',  'demi',        'Demi-finale',     'TBD', 'TBD', '2026-07-14 21:00:00+00', false, 1.8),
  ('ko_sf_02',  'demi',        'Demi-finale',     'TBD', 'TBD', '2026-07-15 21:00:00+00', false, 1.8),
  -- 3e / 4e place (×1.8) — 18 juillet
  ('ko_3rd',    'finale_3eme', '3e/4e place',     'TBD', 'TBD', '2026-07-18 18:00:00+00', false, 1.8),
  -- Finale (×2.0) — 19 juillet
  ('ko_f',      'finale',      'Finale',          'TBD', 'TBD', '2026-07-19 21:00:00+00', false, 2.0);

-- 4. Vue classement : total_points pondéré par le multiplicateur
CREATE OR REPLACE VIEW fantasy_standings AS
SELECT
  p.league_id,
  p.id                              AS participant_id,
  p.user_id,
  p.display_name,
  p.budget_remaining,
  COALESCE(SUM(sc.rating * COALESCE(fm.points_multiplier, 1.0)), 0)
                                    AS total_points,
  COALESCE(SUM(sq.bought_at_price), 0)
                                    AS total_spent,
  CASE
    WHEN COALESCE(SUM(sq.bought_at_price), 0) > 0
    THEN ROUND(
      COALESCE(SUM(sc.rating * COALESCE(fm.points_multiplier, 1.0)), 0)
      / SUM(sq.bought_at_price) * 100, 2)
    ELSE 0
  END                               AS value_for_money
FROM fantasy_participants p
LEFT JOIN fantasy_squads sq ON sq.participant_id = p.id AND sq.active = true
LEFT JOIN fantasy_scores sc ON sc.player_id = sq.player_id
LEFT JOIN fantasy_matches fm ON fm.id = sc.match_id
GROUP BY p.league_id, p.id, p.user_id, p.display_name, p.budget_remaining;
