# AGENTS.md — UI v2 (la única UI)

v1 fue eliminada. No hay toggle, no hay `src/components/`, no hay `src/App.tsx`.

---

## 1. Estado

| Elemento | Estado |
|----------|--------|
| `src/components/` | ❌ Eliminado |
| `src/pages/` | ❌ Eliminado |
| `src/App.tsx` / `App.css` | ❌ Eliminado |
| `src/ui-v2/uiVersion.ts` | 🗑️ Stub (exporta "v2" fijo) |
| `src/main.tsx` | ✅ Renderiza AppV2 directo |
| Toggle v1/v2 en Config | ❌ Ya no existe funcionalmente |

**Lo que sobrevive de v1** está en `src/ui-v2/_legacy/`. Es el código v1 original con imports convertidos, únicamente lo que los wrappers v2 necesitan para funcionar. No tocar a menos que se esté portando a v2 nativo.

---

## 2. Where things live

```
src/
├── main.tsx                   # entry point → siempre AppV2
├── lib/                       # helpers puros (movidos de @/components/)
│   ├── squad/helpers.ts       # antes en components/squad/SquadTab.helpers
│   ├── home/helpers.ts
│   ├── dashboard/helpers.ts
│   └── ...
├── ui-v2/
│   ├── AppV2.tsx              # router root + update checker + UI scale + Android immersive
│   ├── _legacy/               # copias de v1 con imports convertidos
│   │   ├── components/        # ~30 subdirectorios
│   │   └── pages/
│   ├── components/ui/         # shadcn primitives + On Air primitives (see section 4)
│   ├── shell/                 # navModel.ts (rails, groups, strip tabs), RailItem, SectionStripV2, ClockPlate
│   ├── lib/utils.ts           # cn()
│   ├── pages/                 # v2 pages (SettingsV2, TeamSelectionV2)
│   └── dashboard/
│       ├── DashboardV2.tsx    # state container + tab dispatcher
│       ├── DashboardSidebarV2.tsx  # rail (4.75rem), built on navModel
│       ├── DashboardHeaderV2.tsx   # bar + section strip
│       └── tabs/              # tabs nativos v2 (home/, squad/ = On Air panels)
└── store/, services/, hooks/, api/, context/  # compartidos (hooks/useRovingFocus, useClubTheme)
```

---

## 3. Legacy wrappers que usan _legacy/

| Tab v2 | Importa de _legacy |
|--------|-------------------|
| PlayerProfileV2 | `DashboardModalFrame` desde _legacy (modales de renovación, rescisión y oferta; la página es nativa en `pages/playerProfile/`) |
| ScheduleTabV2 | `_legacy/components/schedule/ScheduleCalendarView` |
| ScheduleTabV2 | `_legacy/components/match/DraftResultScreen` |
| ScheduleTabV2 | `_legacy/components/playoffs/PlayoffBracketBoard` |
| HomeTabV2 | `_legacy/components/NextMatchDisplay` |
| SquadTabV2, PlayersTabV2 | PlayerAvatar, ContextMenu desde _legacy |
| CompetitionsTabV2 | ScheduleCalendarView desde _legacy |
| AppV2 | FloatingBugButton (solo en /match y /select-team), MainMenu, MatchSimulation, SettingsV2 |
| DashboardSidebarV2 | FloatingBugButton con `placement="rail"` (el rail lo aloja en las rutas del dashboard) |

Tocado en _legacy por On Air: `FloatingBugButton` (prop `placement`) y el cambio `text-primary` → `text-club-text` en los ficheros que lo usaban.

---

## 4. Diseño

**P1 On Air.** Tokens en `src/themes/default.css`; sólo tokens, nunca colores crudos.

- Tipografía: **Barlow Condensed** (`--font-heading`), mayúsculas, números tabulares. Tamaños con `--text-*` (2xs, caption, section, title, ovr, scoreboard); mínimo 0.75rem y todo en rem.
- Primary dirigido por el club: `--primary` = `--club` (`useClubTheme`). Texto sobre relleno de club: `--club-foreground`. Texto con el color del club: `--club-text` (`text-club-text`). `--club-wash` = tinte del club (desaparece en alto contraste).
- Superficies: `--rail` (rail), `--line` (bordes), `--dim` (texto atenuado), `--surface-clamp` (superficie de referencia para el contraste del color del club).
- Regla: `text-primary` desnudo está prohibido, usar `text-club-text`. Lo impone `src/ui-v2/tokens.guard.test.ts` (excluye `components/ui/`, `shell/` y `FloatingBugButton`).
- `cn()` (`src/ui-v2/lib/utils.ts`) usa `extendTailwindMerge` y registra los tamaños `text-2xs/caption/section/title/ovr/scoreboard`; un test lo compara con los `--text-*` de `default.css`. Un tamaño nuevo se añade en los dos sitios.
- Los estados activos nunca dependen sólo del color (barra, peso, `aria-current`).

**Shell: rail + bar + strip.** `DashboardSidebarV2` es un rail de 4.75rem (escudo, paradas, ajustes/salir/avatar abajo) con foco por flechas (`useRovingFocus`). `DashboardHeaderV2` es la barra (título, chip de decisiones, reloj, Continuar) y, debajo, `SectionStripV2` con las pestañas del grupo activo. `shell/navModel.ts` es la fuente única de paradas, grupos y pestañas. Con la pantalla de fin de temporada ambos pasan a `compact`.

**Primitivas** (`src/ui-v2/components/ui/`): `ClubShield`, `LowerThird`, `Meter`, `ScoreNumeral`, `SegmentedControl`, `SplitButton`, `TagBlock`, además de las shadcn (`button` con variantes `club` y tamaños `touch`).

**Home y Squad On Air:** `tabs/home/` (ScoreboardHero, NeedsYourCallPanel, InboxPanel, StandingsPanel) y `tabs/squad/` (PlayerCardV2, SelectedPlayerBar, BenchEmptyState, StartingFiveGrid). Textos por i18next con las claves `onAir.*` en los 8 locales (`src/i18n/onAirKeys.test.ts` exige el mismo conjunto de claves).

Layout: `<Card className="h-full">` con `<CardHeader>` + `<CardContent>`.

---

## 5. Workflow

```bash
npx tsc --noEmit
npm run build
npm run tauri dev
```

Branch: `feat/ui-v2`. Commit style: `feat(ui-v2): …`, `fix(ui-v2): …`.

---

## 6. Próximos pasos (opcionales)

- Portar los wrappers `_legacy/` restantes a v2 nativo (ver tabla de la sección 3). Ya son nativos: dialogs de fichajes (`dashboard/tabs/transfers/`), `CountryFlag` (`components/ui/country-flag`) y `NegotiationFeedbackPanel` (`components/negotiation/`)
- Separar chunks grandes (MatchSimulation, _legacy) con lazy loading
