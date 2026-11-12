import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { X, Heart, ExternalLink, Download } from "lucide-react";
import { useRovingFocus } from "@/hooks/useRovingFocus";

const GITHUB_URL = "https://github.com/ProphetLemon/OLManager";
const DOWNLOADS_URL = "https://github.com/ProphetLemon/OLManager/releases/latest";

const SUPPORTERS: Array<{ name: string; note?: string }> = [];

function openExternal(url: string): void {
  const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    void import("@tauri-apps/plugin-opener")
      .then((m) => m.openUrl(url))
      .catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.5 11.5 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222 0 1.606-.014 2.898-.014 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.598 24 12.297c0-6.627-5.373-12-12-12Z" />
    </svg>
  );
}

const LINK_ITEMS: Array<{
  key: string;
  label: string;
  labelKey?: string;
  url: string;
  icon: ReactNode;
}> = [
  {
    key: "github",
    label: "GitHub",
    url: GITHUB_URL,
    icon: <GithubIcon className="w-5 h-5 text-gray-300 shrink-0 group-hover:text-white transition-colors" />,
  },
  {
    key: "downloads",
    labelKey: "community.links.downloads",
    label: "Descargas",
    url: DOWNLOADS_URL,
    icon: <Download className="w-5 h-5 text-gray-300 shrink-0 group-hover:text-white transition-colors" aria-hidden="true" />,
  },
];

export default function CommunityPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const linkLabel = (item: (typeof LINK_ITEMS)[number]): string =>
    item.labelKey ? t(item.labelKey, item.label) : item.label;

  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { activeIndex, handleKeyDown, getTabIndex } = useRovingFocus({
    itemCount: LINK_ITEMS.length,
    columns: 1,
    loop: false,
    onSelect: (i) => openExternal(LINK_ITEMS[i]?.url),
    getItemLabel: (i) => (LINK_ITEMS[i] ? linkLabel(LINK_ITEMS[i]) : ""),
  });

  useEffect(() => {
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  return (
    <div className="flex flex-col" onKeyDown={handleKeyDown}>
      <div className="flex justify-between items-center pb-5">
        <h2 className="text-2xl font-heading font-bold uppercase tracking-wider text-white drop-shadow">
          {t("community.title", "Comunidad")}
        </h2>
        <button type="button" onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <p className="text-sm text-gray-300 leading-relaxed border-t border-white/10 py-4">
        {t("community.blurb", {
          defaultValue:
            "Open League Manager · Limón Edition es un fork gratuito y de código abierto de Open League Manager. ¿Has encontrado un problema? Díselo a la persona que te pasó el juego y adjunta el ZIP que guarda el botón «{{bugButton}}».",
          bugButton: t("onAir.nav.bug", "Reportar bug"),
        })}
      </p>

      <div className="flex flex-col border-t border-white/10">
        {LINK_ITEMS.map((item, i) => (
          <button
            key={item.key}
            ref={(el) => { itemRefs.current[i] = el; }}
            tabIndex={getTabIndex(i)}
            type="button"
            onClick={() => openExternal(item.url)}
            className="group flex items-center justify-between gap-3 w-full py-4 text-white transition-colors border-b border-white/10 hover:bg-white/5"
          >
            <span className="flex items-center gap-3 min-w-0">
              {item.icon}
              <span className="font-heading font-bold uppercase tracking-wider">{linkLabel(item)}</span>
            </span>
            <ExternalLink className="w-4 h-4 text-gray-400 group-hover:text-accent-400 transition-colors" />
          </button>
        ))}
      </div>

      {SUPPORTERS.length > 0 && (
      <div className="border-t border-white/10 py-4">
        <div className="flex items-center gap-2 mb-1">
          <Heart className="w-4 h-4 text-accent-400" />
          <h3 className="text-sm font-heading font-bold uppercase tracking-wider text-white">
            {t("community.mentionsTitle", "Menciones")}
          </h3>
        </div>
        <p className="text-xs text-gray-400 mb-3">
          {t("community.mentionsSubtitle", "Gracias a quienes más han apoyado el proyecto")}
        </p>
        <ul className="flex flex-col gap-2">
            {SUPPORTERS.map((s) => (
              <li key={s.name} className="flex items-center gap-3">
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-400/15 text-accent-400 font-heading font-bold text-sm shrink-0">
                  {s.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{s.name}</p>
                  {s.note && <p className="text-xs text-gray-400 truncate">{s.note}</p>}
                </div>
              </li>
            ))}
          </ul>
      </div>
      )}
    </div>
  );
}
