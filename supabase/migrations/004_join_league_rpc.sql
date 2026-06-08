-- ============================================================
-- RPC fantasy_join_league — SECURITY DEFINER pour contourner RLS
-- lors de la première connexion anonyme (pas encore participant)
-- ============================================================

CREATE OR REPLACE FUNCTION fantasy_join_league(
  p_display_name text,
  p_league_code  text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_league   fantasy_leagues%ROWTYPE;
  v_count    int;
  v_user_id  uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'Non authentifié');
  END IF;

  SELECT * INTO v_league FROM fantasy_leagues WHERE code = p_league_code;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Ligue introuvable');
  END IF;

  -- Déjà membre ?
  IF EXISTS (
    SELECT 1 FROM fantasy_participants
    WHERE league_id = v_league.id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('ok', true, 'already_member', true);
  END IF;

  -- Capacité max
  SELECT count(*) INTO v_count FROM fantasy_participants WHERE league_id = v_league.id;
  IF v_count >= 10 THEN
    RETURN json_build_object('error', 'La ligue est complète (10 participants maximum)');
  END IF;

  -- Pseudo unique (insensible à la casse)
  IF EXISTS (
    SELECT 1 FROM fantasy_participants
    WHERE league_id = v_league.id AND lower(display_name) = lower(p_display_name)
  ) THEN
    RETURN json_build_object('error', 'Ce pseudo est déjà utilisé');
  END IF;

  INSERT INTO fantasy_participants (league_id, user_id, display_name, budget_remaining)
  VALUES (v_league.id, v_user_id, p_display_name, v_league.budget_per_user);

  RETURN json_build_object('ok', true);
END;
$$;
