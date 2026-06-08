/**
 * Formule de prix CDM26 Fantasy
 *
 * team_score = 1 / cote_victoire_finale
 * raw_price  = valeur_TM_M€ × (1 + team_score × 10)
 * price      = round(raw_price, 1)
 *
 * Exemples :
 *   Mbappé   180M€, France  cote 3.5  → score=0.286 → price = 180 × 3.86  ≈ 69.5
 *   Modrić    20M€, Croatie cote 40   → score=0.025 → price =  20 × 1.25  ≈ 25.0
 *   Anonyme    3M€, équipe  cote 200  → score=0.005 → price =   3 × 1.05  ≈  3.2
 */

export function computePrice(
  transfermarktValueM: number,
  oddsWinner: number
): number {
  if (oddsWinner <= 0) return Math.round(transfermarktValueM * 10) / 10
  const teamScore = 1 / oddsWinner
  const rawPrice = transfermarktValueM * (1 + teamScore * 10)
  return Math.round(rawPrice * 10) / 10
}

/**
 * Calibrage du budget de départ.
 * On vise que le draft "type" (18 joueurs de prix médian) consomme ~70% du budget.
 */
export function calibrateBudget(prices: number[]): number {
  if (prices.length === 0) return 1000
  const sorted = [...prices].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  // 18 joueurs × médiane × facteur 1.43 pour atteindre ~70% de dépense
  const raw = median * 18 * (1 / 0.7)
  // arrondi au 50 supérieur
  return Math.ceil(raw / 50) * 50
}

/**
 * Répartition standard CDM : 32 équipes qualifiées
 * Source cotes : The Odds API ou saisie manuelle admin
 */
export const POSITION_LABELS: Record<string, string> = {
  GK:  'Gardien',
  DEF: 'Défenseur',
  MID: 'Milieu',
  ATT: 'Attaquant',
}

export const PHASE_LABELS: Record<string, string> = {
  draft:      'Draft initial',
  poule:      'Phase de poule',
  post_poule: 'Après poule',
  huitieme:   '8es de finale',
  post_8:     'Après 8es',
  quart:      '1/4 de finale',
  post_quart: 'Après 1/4',
  demi:       'Demi-finales',
  post_demi:  'Après demies',
  finale:     'Finale',
  termine:    'Terminé',
}

export const PRICE_PHASES: Record<string, string> = {
  initial:    'Avant le tournoi',
  post_poule: 'Après la phase de poule',
  post_8:     'Après les 8es',
  post_quart: 'Après les 1/4',
  post_demi:  'Après les demies',
}

export const SQUAD_MAX = { GK: 2, DEF: 5, MID: 5, ATT: 6, TOTAL: 18 } as const

/** Vérifie que les maximums par poste et le total de 18 ne sont pas dépassés */
export function validateSquad(players: { position: string }[]): {
  valid: boolean
  errors: string[]
} {
  const counts = { GK: 0, DEF: 0, MID: 0, ATT: 0 }
  for (const p of players) {
    if (p.position in counts) counts[p.position as keyof typeof counts]++
  }

  const errors: string[] = []
  if (players.length > SQUAD_MAX.TOTAL) errors.push(`Maximum ${SQUAD_MAX.TOTAL} joueurs (${players.length} sélectionnés)`)
  if (counts.GK  > SQUAD_MAX.GK)        errors.push(`Maximum ${SQUAD_MAX.GK} gardiens (${counts.GK} sélectionnés)`)
  if (counts.DEF > SQUAD_MAX.DEF)       errors.push(`Maximum ${SQUAD_MAX.DEF} défenseurs (${counts.DEF} sélectionnés)`)
  if (counts.MID > SQUAD_MAX.MID)       errors.push(`Maximum ${SQUAD_MAX.MID} milieux (${counts.MID} sélectionnés)`)
  if (counts.ATT > SQUAD_MAX.ATT)       errors.push(`Maximum ${SQUAD_MAX.ATT} attaquants (${counts.ATT} sélectionnés)`)

  return { valid: errors.length === 0, errors }
}

/**
 * Formule de prix avec stats individuelles 2025-2026
 *
 * stat_score = (buts + passes) / matchs × note_moy / 10
 * prix = valeur_TM × (1 + team_score × 10) × (1 + stat_score × 0.5)
 *
 * Exemple :
 *   Mbappé 180M€, France cote 3.5, 25G+10A en 35 matchs, note 7.8
 *   → team_score = 0.286
 *   → stat_score = (35/35) × 7.8/10 = 0.78
 *   → prix = 180 × 3.86 × 1.39 ≈ 96.5 (vs 69.5 sans stats)
 */
export function computePriceWithStats(
  transfermarktValueM: number,
  oddsWinner: number,
  goals: number,
  assists: number,
  matches: number,
  rating: number
): number {
  if (oddsWinner <= 0) return Math.round(transfermarktValueM * 10) / 10

  const teamScore = 1 / oddsWinner
  const basePrice = transfermarktValueM * (1 + teamScore * 10)

  // Stat score : contribution par match × qualité de rating
  const contributions = matches > 0 ? (goals + assists) / matches : 0
  const ratingFactor  = rating > 0 ? rating / 10 : 0.65 // 6.5 par défaut si pas de note
  const statScore     = contributions * ratingFactor

  const finalPrice = basePrice * (1 + statScore * 0.5)
  return Math.round(finalPrice * 10) / 10
}
