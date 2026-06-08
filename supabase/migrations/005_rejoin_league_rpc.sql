-- ============================================================
-- RPC fantasy_rejoin_league
-- Reconnexion par pseudo : met à jour user_id si le pseudo existe,
-- sinon crée le participant. Jamais d'erreur "pseudo déjà utilisé".
-- ============================================================

CREATE OR REPLACE FUNCTION fantasy_rejoin_league(
  p_display_name text,
  p_league_code  text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_league   fantasy_leagues%ROWTYPE;
  v_count    int;
  v_user_id  uuid := auth.uid();
  v_part_id  uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN json_build_object('error', 'Non authentifié');
  END IF;

  SELECT * INTO v_league FROM fantasy_leagues WHERE code = p_league_code;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Ligue introuvable');
  END IF;

  -- Déjà membre avec ce user_id exact → rien à faire
  IF EXISTS (
    SELECT 1 FROM fantasy_participants
    WHERE league_id = v_league.id AND user_id = v_user_id
  ) THEN
    RETURN json_build_object('ok', true, 'already_member', true);
  END IF;

  -- Pseudo existant → reconnexion : on réassigne le user_id
  SELECT id INTO v_part_id
  FROM fantasy_participants
  WHERE league_id = v_league.id AND lower(display_name) = lower(p_display_name);

  IF v_part_id IS NOT NULL THEN
    UPDATE fantasy_participants SET user_id = v_user_id WHERE id = v_part_id;
    RETURN json_build_object('ok', true, 'rejoined', true);
  END IF;

  -- Nouveau joueur → vérifier la capacité puis insérer
  SELECT count(*) INTO v_count FROM fantasy_participants WHERE league_id = v_league.id;
  IF v_count >= 10 THEN
    RETURN json_build_object('error', 'La ligue est complète (10 participants maximum)');
  END IF;

  INSERT INTO fantasy_participants (league_id, user_id, display_name, budget_remaining)
  VALUES (v_league.id, v_user_id, p_display_name, v_league.budget_per_user);

  RETURN json_build_object('ok', true);
END;
$$;
