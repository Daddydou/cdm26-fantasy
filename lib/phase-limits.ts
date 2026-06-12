export type PhaseLimits = { total: number; GK: number; DEF: number; MID: number; ATT: number }

export const PHASE_LIMITS: Record<string, PhaseLimits> = {
  draft:          { total: 18, GK: 2, DEF: 5, MID: 5, ATT: 6 },
  poule:          { total: 18, GK: 2, DEF: 5, MID: 5, ATT: 6 },
  apres_poule:    { total: 18, GK: 2, DEF: 5, MID: 5, ATT: 6 },
  seizieme:       { total: 18, GK: 2, DEF: 5, MID: 5, ATT: 6 },
  apres_seizieme: { total: 16, GK: 2, DEF: 4, MID: 5, ATT: 5 },
  huitieme:       { total: 16, GK: 2, DEF: 4, MID: 5, ATT: 5 },
  apres_huitieme: { total: 14, GK: 2, DEF: 4, MID: 4, ATT: 4 },
  quart:          { total: 14, GK: 2, DEF: 4, MID: 4, ATT: 4 },
  apres_quart:    { total: 12, GK: 1, DEF: 4, MID: 4, ATT: 4 },
  demi:           { total: 12, GK: 1, DEF: 4, MID: 4, ATT: 4 },
  apres_demi:     { total: 10, GK: 1, DEF: 3, MID: 3, ATT: 3 },
  finale:         { total: 10, GK: 1, DEF: 3, MID: 3, ATT: 3 },
  termine:        { total: 10, GK: 1, DEF: 3, MID: 3, ATT: 3 },
}

const DEFAULT_LIMITS: PhaseLimits = { total: 18, GK: 2, DEF: 5, MID: 5, ATT: 6 }

export function getPhaseLimits(phase: string): PhaseLimits {
  return PHASE_LIMITS[phase] ?? DEFAULT_LIMITS
}
