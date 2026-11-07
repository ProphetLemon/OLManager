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
│   ├── components/ui/         # shadcn primitives
│   ├── lib/utils.ts           # cn()
│   ├── pages/                 # v2 pages (SettingsV2, TeamSelectionV2)
│   └── dashboard/
│       ├── DashboardV2.tsx    # state container + tab dispatcher
│       ├── DashboardSidebarV2.tsx
│       ├── DashboardHeaderV2.tsx
│       └── tabs/              # 21 tabs nativos v2
└── store/, services/, hooks/, api/, context/  # compartidos
```

---

## 3. Legacy wrappers que usan _legacy/

| Tab v2 | Importa de _legacy |
|--------|-------------------|
| PlayerProfileV2 | `_legacy/components/playerProfile/PlayerProfile` |
| ScheduleTabV2 | `_legacy/components/schedule/ScheduleCalendarView` |
| ScheduleTabV2 | `_legacy/components/match/DraftResultScreen` |
| ScheduleTabV2 | `_legacy/components/playoffs/PlayoffBracketBoard` |
| HomeTabV2 | `_legacy/components/NextMatchDisplay` |
| TransfersTabV2 | modals y CountryFlag desde _legacy |
| SquadTabV2, PlayersTabV2 | PlayerAvatar, ContextMenu desde _legacy |
| CompetitionsTabV2 | ScheduleCalendarView desde _legacy |
| AppV2 | FloatingBugButton, MainMenu, MatchSimulation, SettingsV2 |

---

## 4. Diseño

Tokens: zinc neutrals + **orange primary** (`#F97316`). Heading font: **Barlow Condensed** uppercase, tabular numbers.

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

- Portar los wrappers `_legacy/` a v2 nativo (PlayerProfile, transfer modals)
- Separar chunks grandes (MatchSimulation, _legacy) con lazy loading
