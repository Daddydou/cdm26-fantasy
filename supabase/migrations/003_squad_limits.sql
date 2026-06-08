-- ============================================================
-- CDM26 Fantasy — Limites de composition (max, pas de minimum)
-- MAX : 18 joueurs total | GK:2 DEF:5 MID:5 ATT:6
-- ============================================================

CREATE OR REPLACE FUNCTION fantasy_buy_player(
  p_league_id      uuid,
  p_participant_id uuid,
  p_player_id      uuid,
  p_price          numeric,
  p_phase          text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_league        fantasy_leagues%ROWTYPE;
  v_budget        numeric;
  v_position      text;
  v_pos_count     int;
  v_total_count   int;
  v_new_squad_id  uuid;
  v_pos_max       int;
BEGIN
  SELECT * INTO v_league FROM fantasy_leagues WHERE id = p_league_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Ligue introuvable');
  END IF;
  IF NOT (v_league.draft_open OR v_league.market_open) THEN
    RETURN json_build_object('error', 'Draft / marché fermé');
  END IF;

  SELECT budget_remaining INTO v_budget
  FROM fantasy_participants WHERE id = p_participant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Participant introuvable');
  END IF;
  IF v_budget < p_price THEN
    RETURN json_build_object('error', 'Budget insuffisant');
  END IF;

  IF EXISTS (
    SELECT 1 FROM fantasy_squads
    WHERE participant_id = p_participant_id AND player_id = p_player_id AND active = true
  ) THEN
    RETURN json_build_object('error', 'Joueur déjà dans votre équipe');
  END IF;

  SELECT position INTO v_position FROM fantasy_players WHERE id = p_player_id;
  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Joueur introuvable');
  END IF;

  SELECT count(*) INTO v_total_count
  FROM fantasy_squads
  WHERE participant_id = p_participant_id AND active = true;
  IF v_total_count >= 18 THEN
    RETURN json_build_object('error', 'Équipe complète (18 joueurs maximum)');
  END IF;

  v_pos_max := CASE v_position
    WHEN 'GK'  THEN 2
    WHEN 'DEF' THEN 5
    WHEN 'MID' THEN 5
    WHEN 'ATT' THEN 6
    ELSE 0
  END;

  SELECT count(*) INTO v_pos_count
  FROM fantasy_squads sq
  JOIN fantasy_players pl ON pl.id = sq.player_id
  WHERE sq.participant_id = p_participant_id AND sq.active = true AND pl.position = v_position;

  IF v_pos_count >= v_pos_max THEN
    RETURN json_build_object('error', 'Limite de ' || v_pos_max || ' ' || v_position || ' atteinte');
  END IF;

  UPDATE fantasy_participants
  SET budget_remaining = budget_remaining - p_price
  WHERE id = p_participant_id;

  INSERT INTO fantasy_squads (league_id, participant_id, player_id, bought_at_price, bought_at_phase)
  VALUES (p_league_id, p_participant_id, p_player_id, p_price, p_phase)
  RETURNING id INTO v_new_squad_id;

  SELECT budget_remaining INTO v_budget FROM fantasy_participants WHERE id = p_participant_id;

  RETURN json_build_object('squad_id', v_new_squad_id, 'budget_remaining', v_budget);
END;
$$;


CREATE OR REPLACE FUNCTION fantasy_sell_player(
  p_participant_id uuid,
  p_squad_id       uuid,
  p_sell_price     numeric,
  p_phase          text
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_budget  numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fantasy_squads
    WHERE id = p_squad_id AND participant_id = p_participant_id AND active = true
  ) THEN
    RETURN json_build_object('error', 'Entrée squad introuvable');
  END IF;

  UPDATE fantasy_squads SET
    active        = false,
    sold_at_price = p_sell_price,
    sold_at_phase = p_phase,
    sold_at       = now()
  WHERE id = p_squad_id;

  UPDATE fantasy_participants
  SET budget_remaining = budget_remaining + p_sell_price
  WHERE id = p_participant_id;

  SELECT budget_remaining INTO v_budget FROM fantasy_participants WHERE id = p_participant_id;

  RETURN json_build_object('budget_remaining', v_budget);
END;
$$;
