# CDM26 Fantasy

Application de fantasy football pour la Coupe du Monde 2026.

## Stack
- Next.js 14 (App Router)
- Tailwind CSS
- Supabase (DB + Auth + RLS)
- Vercel (déploiement)

---

## Installation

```bash
npm install
cp .env.local.example .env.local
# Remplir .env.local avec tes clés Supabase
```

---

## Setup Supabase

1. Créer un projet Supabase
2. Lancer la migration :
   - Aller dans **SQL Editor** sur supabase.com
   - Copier-coller le contenu de `supabase/migrations/001_initial.sql`
   - Exécuter

3. Activer l'auth anonyme :
   - **Authentication → Providers → Anonymous** → Enable

---

## Import des données (dans l'ordre)

### 1. Joueurs (CSV)

Remplir `scripts/players_template.csv` avec tous les joueurs CDM 2026.
Colonnes : `name, position, team, nationality, transfermarkt_value_m, sofascore_id, photo_url`

- `position` : GK | DEF | MID | ATT
- `transfermarkt_value_m` : valeur en millions d'euros (ex: 180.0)
- `sofascore_id` : l'ID numérique du joueur sur sofascore.com (chercher le joueur, regarder l'URL)
- `photo_url` : optionnel

```bash
npx tsx scripts/import-players.ts scripts/players_template.csv
```

### 2. Calendrier des matchs

> ⚠️ Vérifier que SEASON_ID dans `scripts/import-matches.ts` correspond à la CDM 2026 sur SofaScore.
> Vérifier sur : https://api.sofascore.com/api/v1/unique-tournament/16/seasons

```bash
npx tsx scripts/import-matches.ts
```

### 3. Calcul des prix initiaux

```bash
npx tsx scripts/compute-prices.ts initial
```

Le script affiche le **budget recommandé** → mettre à jour dans l'admin ou via SQL :
```sql
UPDATE cdm_leagues SET budget_per_user = VALEUR;
```

---

## Lancement en dev

```bash
npm run dev
# http://localhost:3000
```

---

## Déploiement Vercel

```bash
vercel --prod
```

Variables d'environnement à ajouter dans Vercel :
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ODDS_API_KEY` (optionnel)

---

## Workflow du tournoi

### Avant le tournoi
1. Admin crée la ligue → partage le code
2. Participants rejoignent
3. Admin ouvre le draft
4. Chacun achète ses joueurs simultanément

### Pendant le tournoi
- Scraping automatique des notes après chaque match :
  ```bash
  npx tsx scripts/fetch-ratings.ts
  ```
  (à mettre en cron Vercel ou lancer manuellement)

### Fenêtres de transfert
1. Admin ferme le draft / clique "Avancer la phase" dans l'admin
2. Admin recalcule les prix :
   ```bash
   npx tsx scripts/compute-prices.ts post_poule
   # ou post_8, post_quart, post_demi
   ```
3. Admin ouvre le marché des transferts
4. Participants vendent / rachètent

---

## Architecture des routes

```
/                          → Accueil (rejoindre / créer une ligue)
/league/[code]             → Hub de la ligue
/league/[code]/draft       → Draft & marché (acheter / vendre)
/league/[code]/squad       → Mon équipe
/league/[code]/standings   → Classement (points + VfM)
/league/[code]/admin       → Administration (admin uniquement)
```

---

## Formule de prix

```
team_score  = 1 / cote_victoire_finale
price       = valeur_TM_M€ × (1 + team_score × 10)
```

Exemple :
- Mbappé (180M€, France cote 3.5) → price ≈ 69.5 crédits
- Joueur modeste (3M€, équipe cote 100) → price ≈ 3.3 crédits

## Composition minimale

- 2 GK · 5 DEF · 6 MID · 5 ATT · minimum 18 joueurs total

## Scoring

- Note SofaScore de chaque match joué
- Cumul sur tout le tournoi
- Classement VfM = total_points / crédits_dépensés × 100
