import { useTranslation } from "react-i18next";

import { Button } from "@/ui-v2/components/ui/button";

interface SocialComposerProps {
  text: string;
  posting: boolean;
  error: string | null;
  onChange: (text: string) => void;
  onPublish: () => void;
}

export function SocialComposer({ text, posting, error, onChange, onPublish }: SocialComposerProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 rounded-xl border bg-muted/50 p-3">
      <textarea
        value={text}
        maxLength={280}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t("social.composerPlaceholder", { defaultValue: "¿Qué está pensando el míster hoy?" })}
        className="min-h-[84px] w-full resize-none bg-transparent text-sm placeholder:text-muted-foreground"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs tabular-nums text-muted-foreground">{text.length}/280</span>
        <Button
          type="button"
          size="sm"
          disabled={posting || text.trim().length === 0}
          onClick={onPublish}
          className="rounded-full font-heading uppercase tracking-wider"
        >
          {posting
            ? t("social.posting", { defaultValue: "Publicando..." })
            : t("social.post", { defaultValue: "Postear" })}
        </Button>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
