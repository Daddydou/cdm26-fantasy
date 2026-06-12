-- ============================================================
-- Migration : phases 1/16e + limites dynamiques par phase
-- ============================================================

-- ── 1. Colonne phase dans fantasy_leagues ──────────────────
-- Si la colonne est TEXT, aucune migration nécessaire.
-- Si c'est un enum, ajouter les nouvelles valeurs :

DO $$
BEGIN
  -- Vérifier si le type est un enum
  IF EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'fantasy_phase'
  ) THEN
    -- Ajouter les valeurs manquantes (idempotent grâce au IF NOT EXISTS)
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'apres_poule'    AND enumtypid = 'fantasy_phase'::regtype) THEN
      ALTER TYPE fantasy_phase ADD VALUE 'apres_poule';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'seizieme'       AND enumtypid = 'fantasy_phase'::regtype) THEN
      ALTER TYPE fantasy_phase ADD VALUE 'seizieme';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'apres_seizieme' AND enumtypid = 'fantasy_phase'::regtype) THEN
      ALTER TYPE fantasy_phase ADD VALUE 'apres_seizieme';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'apres_huitieme' AND enumtypid = 'fantasy_phase'::regtype) THEN
      ALTER TYPE fantasy_phase ADD VALUE 'apres_huitieme';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'apres_quart'    AND enumtypid = 'fantasy_phase'::regtype) THEN
      ALTER TYPE fantasy_phase ADD VALUE 'apres_quart';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'apres_demi'     AND enumtypid = 'fantasy_phase'::regtype) THEN
      ALTER TYPE fantasy_phase ADD VALUE 'apres_demi';
    END IF;
    RAISE NOTICE 'Enum fantasy_phase mis à jour.';
  ELSE
    RAISE NOTICE 'Colonne phase est TEXT — aucun ALTER TYPE nécessaire.';
  END IF;
END $$;


-- ── 2. Table des limites par phase (alternative à CASE WHEN) ──
CREATE TABLE IF NOT EXISTS fantasy_phase_limits (
  phase        TEXT PRIMARY KEY,
  total        INT  NOT NULL,
  max_gk       INT  NOT NULL,
  max_def      INT  NOT NULL,
  max_mid      INT  NOT NULL,
  max_att      INT  NOT NULL
);

INSERT INTO fantasy_phase_limits (phase, total, max_gk, max_def, max_mid, max_att) VALUES
  ('draft',          18, 2, 5, 5, 6),
  ('poule',          18, 2, 5, 5, 6),
  ('apres_poule',    18, 2, 5, 5, 6),
  ('seizieme',       18, 2, 5, 5, 6),
  ('apres_seizieme', 16, 2, 4, 5, 5),
  ('huitieme',       16, 2, 4, 5, 5),
  ('apres_huitieme', 14, 2, 4, 4, 4),
  ('quart',          14, 2, 4, 4, 4),
  ('apres_quart',    12, 1, 4, 4, 4),
  ('demi',           12, 1, 4, 4, 4),
  ('apres_demi',     10, 1, 3, 3, 3),
  ('finale',         10, 1, 3, 3, 3),
  ('termine',        10, 1, 3, 3, 3)
ON CONFLICT (phase) DO UPDATE SET
  total   = EXCLUDED.total,
  max_gk  = EXCLUDED.max_gk,
  max_def = EXCLUDED.max_def,
  max_mid = EXCLUDED.max_mid,
  max_att = EXCLUDED.max_att;


-- ── 3. RPC fantasy_buy_player avec limites dynamiques ─────────
CREATE OR REPLACE FUNCTION fantasy_buy_player(
  p_league_id      UUID,
  p_participant_id UUID,
  p_player_id      UUID,
  p_price          NUMERIC,
  p_phase          TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_budget         NUMERIC;
  v_pos_count      INT;
  v_total_count    INT;
  v_position       TEXT;
  v_already_owned  BOOLEAN;
  v_squad_id       UUID;
  v_league_phase   TEXT;
  v_limits         fantasy_phase_limits%ROWTYPE;
BEGIN
  -- Récupérer la phase actuelle de la ligue et le budget
  SELECT fl.phase, fp.budget_remaining
  INTO v_league_phase, v_budget
  FROM fantasy_leagues fl
  JOIN fantasy_participants fp ON fp.id = p_participant_id
  WHERE fl.id = p_league_id;

  -- Charger les limites pour cette phase
  SELECT * INTO v_limits FROM fantasy_phase_limits WHERE phase = v_league_phase;
  IF NOT FOUND THEN
    -- Fallback limites par défaut
    v_limits.total   := 18;
    v_limits.max_gk  := 2;
    v_limits.max_def := 5;
    v_limits.max_mid := 5;
    v_limits.max_att := 6;
  END IF;

  -- Vérifier que le joueur n'est pas déjà dans le squad
  SELECT EXISTS(
    SELECT 1 FROM fantasy_squads
    WHERE participant_id = p_participant_id AND player_id = p_player_id AND active = TRUE
  ) INTO v_already_owned;

  IF v_already_owned THEN
    RETURN json_build_object('error', 'Joueur déjà dans ton équipe');
  END IF;

  -- Budget suffisant ?
  IF v_budget < p_price THEN
    RETURN json_build_object('error', 'Budget insuffisant');
  END IF;

  -- Récupérer le poste du joueur
  SELECT position INTO v_position FROM fantasy_players WHERE id = p_player_id;

  -- Limite totale
  SELECT COUNT(*) INTO v_total_count
  FROM fantasy_squads
  WHERE participant_id = p_participant_id AND active = TRUE;

  IF v_total_count >= v_limits.total THEN
    RETURN json_build_object('error', 'Équipe complète (' || v_limits.total || ' joueurs max pour cette phase)');
  END IF;

  -- Limite par poste
  SELECT COUNT(*) INTO v_pos_count
  FROM fantasy_squads fs
  JOIN fantasy_players fp ON fp.id = fs.player_id
  WHERE fs.participant_id = p_participant_id AND fs.active = TRUE AND fp.position = v_position;

  IF v_position = 'GK'  AND v_pos_count >= v_limits.max_gk  THEN
    RETURN json_build_object('error', 'Maximum ' || v_limits.max_gk  || ' gardien(s) pour cette phase');
  END IF;
  IF v_position = 'DEF' AND v_pos_count >= v_limits.max_def THEN
    RETURN json_build_object('error', 'Maximum ' || v_limits.max_def || ' défenseurs pour cette phase');
  END IF;
  IF v_position = 'MID' AND v_pos_count >= v_limits.max_mid THEN
    RETURN json_build_object('error', 'Maximum ' || v_limits.max_mid || ' milieux pour cette phase');
  END IF;
  IF v_position = 'ATT' AND v_pos_count >= v_limits.max_att THEN
    RETURN json_build_object('error', 'Maximum ' || v_limits.max_att || ' attaquants pour cette phase');
  END IF;

  -- Achat
  INSERT INTO fantasy_squads (league_id, participant_id, player_id, bought_at_price, bought_at_phase, active)
  VALUES (p_league_id, p_participant_id, p_player_id, p_price, p_phase, TRUE)
  RETURNING id INTO v_squad_id;

  UPDATE fantasy_participants
  SET budget_remaining = budget_remaining - p_price
  WHERE id = p_participant_id
  RETURNING budget_remaining INTO v_budget;

  RETURN json_build_object(
    'squad_id',         v_squad_id,
    'budget_remaining', v_budget
  );
END;
$$;
