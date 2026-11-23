import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { usePhoneForm } from "@/hooks/usePhoneForm";
import { PHONE_ICON_BUTTON } from "./phoneClasses";
import changelogRaw from "../../../../../CHANGELOG.md?raw";

interface ChangeGroup {
  type: string;
  items: string[];
}

interface Release {
  version: string;
  date?: string;
  groups: ChangeGroup[];
}

function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: ChangeGroup | null = null;

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const text = h2[1].trim();
      const match = /^\[?([^\]]+?)\]?\s*(?:[-–]\s*(.+))?$/.exec(text);
      release = { version: match ? match[1].trim() : text, date: match?.[2]?.trim(), groups: [] };
      releases.push(release);
      group = null;
      continue;
    }
    if (!release) continue;
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h3) { group = { type: h3[1].trim(), items: [] }; release.groups.push(group); continue; }
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!group) { group = { type: "", items: [] }; release.groups.push(group); }
      group.items.push(bullet[1].trim());
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && group && group.items.length > 0) {
      group.items[group.items.length - 1] += ` ${trimmed}`;
    }
  }
  return releases;
}

function groupStyle(type: string, t: (key: string, def: string) => string): { label: string; className: string } {
  const key = type.toLowerCase();
  const map: Record<string, [string, string]> = {
    added: ["patchNotes.added", "text-green-400"],
    changed: ["patchNotes.changed", "text-accent-400"],
    fixed: ["patchNotes.fixed", "text-amber-400"],
    removed: ["patchNotes.removed", "text-red-400"],
    security: ["patchNotes.security", "text-purple-400"],
    chores: ["patchNotes.chores", "text-gray-400"],
    contributors: ["patchNotes.contributors", "text-sky-400"],
    notes: ["patchNotes.notes", "text-gray-400"],
  };
  const entry = map[key] ?? [type, "text-gray-300"];
  return { label: t(entry[0], type), className: entry[1] };
}

export default function PatchNotesPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const phone = usePhoneForm();
  const releases = useMemo(() => parseChangelog(changelogRaw), []);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.focus();
  }, []);

  return (
    <div className={phone ? "flex h-full min-h-0 flex-col" : "flex flex-col"}>
      <div className={phone ? "flex shrink-0 justify-between items-center pb-1" : "flex justify-between items-center pb-5"}>
        <h2 className="text-2xl font-heading font-bold uppercase tracking-wider text-white drop-shadow">
          {t("menu.patchNotes", "Novedades")}
        </h2>
        <button type="button" onClick={onClose}
          aria-label={phone ? t("common.close") : undefined}
          className={`text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10${phone ? ` ${PHONE_ICON_BUTTON}` : ""}`}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div ref={scrollRef} tabIndex={0}
        className={`${phone ? "min-h-0 flex-1" : "max-h-[60vh]"} overflow-y-auto overscroll-contain border-t border-white/10 scrollbar-v2 outline-none`}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const el = scrollRef.current;
            if (!el) return;
            const line = 40;
            el.scrollBy({ top: e.key === "ArrowDown" ? line : -line, behavior: "smooth" });
          }
        }}
      >
        {releases.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">{t("patchNotes.empty", "Todavía no hay notas de versión.")}</p>
        ) : (
          releases.map((release) => (
            <div key={release.version} className="py-4 border-b border-white/10">
              <div className="flex items-baseline gap-2 mb-3">
                <h3 className="text-lg font-heading font-bold uppercase tracking-wider text-accent-400">v{release.version}</h3>
                {release.date && <span className="text-xs text-gray-500 font-heading uppercase tracking-wide">{release.date}</span>}
              </div>
              <div className="flex flex-col gap-4">
                {release.groups.map((g, gi) => {
                  const style = g.type ? groupStyle(g.type, t) : null;
                  return (
                    <div key={`${release.version}-${gi}`}>
                      {style && <p className={`text-2xs font-heading font-bold uppercase tracking-wider mb-1 ${style.className}`}>{style.label}</p>}
                      <ul className="flex flex-col gap-1">
                        {g.items.map((item, ii) => (
                          <li key={ii} className="text-sm text-gray-300 leading-snug pl-3 relative before:absolute before:left-0 before:top-2 before:w-1 before:h-1 before:rounded-full before:bg-accent-400/70">{item}</li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
