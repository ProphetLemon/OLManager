# Home Tab (Inicio)

The Home tab is the first screen the user sees after entering the dashboard. It provides a day-to-day overview of the team's status: next match, league standings, roster, messages, and news.

## Data flow

```
gameState (from Zustand store)
  │
  ├─ getNextOpponentWidgetData() → NextOpponentCard
  ├─ getRecentResultsForTeam()   → RecentResultsCard
  ├─ league.standings.sort()     → FullStandingsCard
  ├─ messages.slice().sort()     → MessagesCard
  ├─ news.slice().sort()         → NewsCard
  └─ players.filter(team_id)      → RosterLineupV2
```

All data is derived from `gameState` using `useMemo` — no additional `invoke` calls. The component is purely presentational.

## Layout

```
┌──────────────────────────────────────────────────┐
│  TodayPhaseCard (full width, top)                │
│  ─ Muestra la fase actual del día               │
│  ─ Si hay partido hoy, lo muestra                │
├──────────────────────────────────────────────────┤
│  NextOpponentCard       │  FullStandingsCard     │
│  (flex-1)               │  (w-72, hidden mobile)│
├──────────────────────────────────────────────────┤
│  RosterLineupV2 (full width)                     │
│  ─ 5 role cards con jugador, splash, stats      │
├──────────────────────────────────────────────────┤
│  FinancesCard   │  MessagesCard  │  ...           │
│  RecentResults  │  NewsCard      │                │
└──────────────────────────────────────────────────┘
```

The layout uses a 4-column CSS grid (`lg:grid-cols-4`) with `grid-flow-dense` for auto-placement. Each section fades in with staggered delay (`0ms`, `25ms`, `50ms`).

## Components

| Component | Lines | Purpose |
|---|---|---|
| `TodayPhaseCard` | 926-1003 | Current game phase (Morning/ScrimBlock) or match-day banner (component not found in `src/ui-v2`, see below) |
| `NextOpponentCard` | 155-376 | Next fixture: opponent, lineup comparison, strength bar, recent form |
| `FullStandingsCard` | 418-534 | League standings table (always 8 rows) |
| `RosterLineupV2` | External | 5 role cards with player photo, champion splash, OVR, energy, morale |
| `FinancesCard` | 608-695 | Budget overview: balance, salary cap usage, income/expenses |
| `MessagesCard` | 699-798 | Recent inbox messages with read/unread state |
| `RecentResultsCard` | 538-590 | Last 5 match results with W/L/D pills |
| `NewsCard` | 802-859 | Latest news headlines in a 2-column grid |

### TodayPhaseCard

Shows the current `gameState.day_phase` with an icon, title, description, and call-to-action button. If there's a fixture today, it shows a "Día de partido" card instead.

The day has two phases: `Morning` and `ScrimBlock`. `ReviewBlock`, `TrainingBlock` and `Evening` were folded into `ScrimBlock` in 2026-11, and saves stored in them load as `ScrimBlock`. A day takes one press of Continue, or two on a scrim day (the scrims are played, `ScrimBlock` waits for the review decision, the next press ends the day).

> **Status of this component**: no `TodayPhaseCard` or `PHASE_META` exists in `src/ui-v2` any more, and this document does not describe what replaced it on Home. The day phase is still shown in the dashboard header: `DashboardHeaderV2` passes `gameState.day_phase` to `ClockPlate` as a chip labelled "Morning" or "Scrims" (keys `onAir.bar.phase.morning` and `onAir.bar.phase.scrimBlock`). The description below is the original v1 design.

The phase metadata is in `PHASE_META` constant, mapping each phase to:
- `icon` — Lucide icon component
- `label` — Short phase name
- `title` — Header text
- `description` — Contextual hint
- `accent` — Tailwind color class
- `actionLabel` / `actionTab` — CTA button redirect

### NextOpponentCard

Shows the next upcoming fixture. Details:
- **Matchup hero**: logos + short names of both teams, match type badge, date
- **Strength bar**: Comparative OVR visualization (green=home, red=away)
- **Lineup comparison**: 5 role rows with player photo, name, OVR for each role
- **Opponent form**: Last 5 results as W/L/D pills
- **CTA**: "Calendario" button → navigates to Schedule tab

If there's no upcoming fixture, shows an empty state with "Ver competiciones" link.

**Lineup resolution** (`getLineupByRole`):
1. Filters players by `team_id`
2. Matches to role using `ROLE_BY_IGN` (known pro players) or `position`/`natural_position` fallback
3. Returns top OVR player per role, or top 5 by OVR if role matching fails

### FullStandingsCard

League standings table from `league.standings`, sorted by `compareStandingsByLolScore`. Always shows exactly 8 rows — empty rows are filled with `—`. The user's team row is highlighted with `bg-primary/10`. Clicking a team navigates to the Teams tab.

### RosterLineupV2 (external component at `./RosterLineupV2.tsx`)

5 role cards in a row, each showing:
- Champion splash as background (from `resolveChampionSplash`)
- Player photo, match name, OVR
- Top mastered champion
- Energy + Morale stat boxes (color-coded)
- Clicking a player → `onSelectPlayer`

### FinancesCard

Compact overview: club balance, salary budget usage bar (green/amber/red), income/expenses/net for the season. Click "Detalle" → navigates to Finances tab.

### MessagesCard

Recent messages with:
- Unread indicator (left border in primary color)
- Sender initial + color (read/unread)
- Subject, body preview, priority badge
- Date in compact format
- Click → navigates to Inbox tab with `messageId` context
- "Ver todos" link at bottom

### NewsCard

Latest news articles in a responsive 2-column grid. Shows headline, source, date. Click "Ver todas" → navigates to News tab.

### RecentResultsCard

Last 5 match results for the user's team. Each result shows:
- W/L/D pill with color coding
- Opponent name, match type, home/away
- Score (myGoals–opponentGoals)

## Props

```typescript
interface Props {
  gameState: GameStateData;      // Full game state from Zustand store
  onNavigate?: (tab: string, context?: { messageId?: string }) => void;  // Tab navigation
  onSelectPlayer?: (id: string) => void;  // Player selection → profile
}
```

## Key helpers

| Helper | Source | Purpose |
|---|---|---|
| `getNextOpponentWidgetData` | `home/HomeTab.helpers` | Returns next fixture + opponent + recent form |
| `getRecentResultsForTeam` | Same file | Last N results with scores |
| `getLineupByRole` | `components/NextMatchDisplay` | 5-player lineup sorted by role |
| `teamLineupOvr` | Same file | Average OVR of a lineup |
| `calculateLolOvr` | `players/lolPlayerStats` | Individual player OVR |
| `resolvePlayerPhoto` | `players/playerPhotos` | Resolve photo URL |
| `resolveTeamLogo` | `teams/teamLogos` | Resolve team logo by name/logo_url |
| `compareStandingsByLolScore` | `gameStore` | Standings sorting comparator |
| `resolveMessage` | `i18n/backendI18n` | Resolve i18n message from backend |
| `resolveNewsArticle` | Same | Resolve news article i18n |

## Animations

- All cards use `animate-fade-in-up` with staggered delays:
  - TodayPhaseCard: `0ms`
  - Main row (NextOpponent + Standings): `25ms`
  - Roster: `50ms`
- Noise texture background (SVG filter) for visual depth
