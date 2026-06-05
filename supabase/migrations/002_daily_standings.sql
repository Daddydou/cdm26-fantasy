-- Vue : classement par journée de matchs
create or replace view fantasy_daily_standings as
select
  p.league_id,
  p.id                                as participant_id,
  p.display_name,
  m.match_date::date                  as match_day,
  coalesce(sum(sc.rating), 0)         as day_points,
  count(distinct sc.match_id)         as matches_scored
from fantasy_participants p
join fantasy_squads sq on sq.participant_id = p.id and sq.active = true
join fantasy_scores sc on sc.player_id = sq.player_id
join fantasy_matches m on m.id = sc.match_id
group by p.league_id, p.id, p.display_name, m.match_date::date
order by match_day desc, day_points desc;
