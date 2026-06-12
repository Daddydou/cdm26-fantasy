export type Position = 'GK' | 'DEF' | 'MID' | 'ATT'
export type Phase =
  | 'draft'
  | 'poule'
  | 'apres_poule'
  | 'seizieme'
  | 'apres_seizieme'
  | 'huitieme'
  | 'apres_huitieme'
  | 'quart'
  | 'apres_quart'
  | 'demi'
  | 'apres_demi'
  | 'finale'
  | 'termine'
export type PricePhase = 'initial' | 'post_poule' | 'post_8' | 'post_quart' | 'post_demi'

export type Database = {
  public: {
    Tables: {
      fantasy_players: {
        Row: {
          id: string
          name: string
          position: Position
          team: string
          nationality: string
          transfermarkt_value_m: number
          sofascore_id: string | null
          photo_url: string | null
          active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_players']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['fantasy_players']['Insert']>
      }
      fantasy_teams: {
        Row: {
          id: string
          name: string
          odds_winner: number | null
          team_score: number | null
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_teams']['Row'], 'id' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['fantasy_teams']['Insert']>
      }
      fantasy_prices: {
        Row: {
          id: string
          player_id: string
          phase: PricePhase
          team_odds: number | null
          price: number
          computed_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_prices']['Row'], 'id' | 'computed_at'>
        Update: Partial<Database['public']['Tables']['fantasy_prices']['Insert']>
      }
      fantasy_leagues: {
        Row: {
          id: string
          name: string
          code: string
          admin_user_id: string | null
          phase: Phase
          budget_per_user: number
          draft_open: boolean
          market_open: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_leagues']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['fantasy_leagues']['Insert']>
      }
      fantasy_participants: {
        Row: {
          id: string
          league_id: string
          user_id: string
          display_name: string
          budget_remaining: number
          joined_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_participants']['Row'], 'id' | 'joined_at'>
        Update: Partial<Database['public']['Tables']['fantasy_participants']['Insert']>
      }
      fantasy_squads: {
        Row: {
          id: string
          league_id: string
          participant_id: string
          player_id: string
          bought_at_price: number
          bought_at_phase: string
          sold_at_price: number | null
          sold_at_phase: string | null
          sold_at: string | null
          active: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_squads']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['fantasy_squads']['Insert']>
      }
      fantasy_matches: {
        Row: {
          id: string
          sofascore_match_id: string
          phase: string
          round: string | null
          home_team: string
          away_team: string
          match_date: string
          processed: boolean
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_matches']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['fantasy_matches']['Insert']>
      }
      fantasy_scores: {
        Row: {
          id: string
          player_id: string
          match_id: string
          sofascore_match_id: string | null
          rating: number | null
          minutes_played: number
          match_date: string | null
          fetched_at: string
        }
        Insert: Omit<Database['public']['Tables']['fantasy_scores']['Row'], 'id' | 'fetched_at'>
        Update: Partial<Database['public']['Tables']['fantasy_scores']['Insert']>
      }
    }
    Views: {
      fantasy_standings: {
        Row: {
          league_id: string
          participant_id: string
          user_id: string
          display_name: string
          budget_remaining: number
          total_points: number
          total_spent: number
          value_for_money: number
        }
      }
      fantasy_squad_detail: {
        Row: {
          league_id: string
          participant_id: string
          squad_id: string
          active: boolean
          bought_at_price: number
          bought_at_phase: string
          sold_at_price: number | null
          player_id: string
          player_name: string
          position: Position
          team: string
          photo_url: string | null
          total_rating: number
          matches_played: number
        }
      }
    }
  }
}

// Helpers
export type Player = Database['public']['Tables']['fantasy_players']['Row']
export type Team = Database['public']['Tables']['fantasy_teams']['Row']
export type Price = Database['public']['Tables']['fantasy_prices']['Row']
export type League = Database['public']['Tables']['fantasy_leagues']['Row']
export type Participant = Database['public']['Tables']['fantasy_participants']['Row']
export type Squad = Database['public']['Tables']['fantasy_squads']['Row']
export type Match = Database['public']['Tables']['fantasy_matches']['Row']
export type Score = Database['public']['Tables']['fantasy_scores']['Row']
export type Standing = Database['public']['Views']['fantasy_standings']['Row']
export type SquadDetail = Database['public']['Views']['fantasy_squad_detail']['Row']

// Player avec prix courant (utilisé partout dans l'UI)
export type PlayerWithPrice = Player & {
  current_price: number | null
  current_phase: PricePhase | null
}

// Vue daily standings (ajoutée via migration 002)
export type DailyStanding = {
  league_id: string
  participant_id: string
  display_name: string
  match_day: string
  day_points: number
  matches_scored: number
}
