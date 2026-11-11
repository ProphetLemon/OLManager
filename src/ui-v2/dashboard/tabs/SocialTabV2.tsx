import type { GameStateData } from "@/store/gameStore";
import { useActiveLeague } from "@/store/gameStore";
import { Clock, MessageSquare, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { visibleSocialPosts } from "@/lib/social/helpers";
import { createManagerSocialPost, relocalizeSocialFeed } from "@/services/socialService";
import { Card } from "@/ui-v2/components/ui/card";
import { SocialComposer } from "./social/SocialComposer";
import { SocialPostItem } from "./social/SocialPostItem";

interface SocialTabV2Props {
  gameState: GameStateData;
  onGameUpdate: (state: GameStateData) => void;
}

export function SocialTabV2({ gameState, onGameUpdate }: SocialTabV2Props) {
  const { t } = useTranslation();
  const activeLeague = useActiveLeague(gameState);
  const isLEC = activeLeague?.competition_id === "lec";

  if (!isLEC) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-100">
          <MessageSquare className="h-10 w-10 text-orange-500" />
        </div>
        <div className="max-w-md space-y-2">
          <h2 className="font-heading text-xl font-bold uppercase tracking-wide text-zinc-900">
            {t("social.comingSoonTitle")}
          </h2>
          <p
            className="text-sm text-zinc-500"
            dangerouslySetInnerHTML={{ __html: t("social.comingSoonBody") }}
          />
          <p className="text-sm text-zinc-400">
            {t("social.comingSoonSub")}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-500">
          <Clock className="h-4 w-4" />
          <span>{t("social.currentlyPlaying")} {activeLeague?.name ?? t("common.unknown")}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6 scrollbar-v2">
      <SocialFeed gameState={gameState} onGameUpdate={onGameUpdate} />
    </div>
  );
}

function toggleId(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function SocialFeed({ gameState, onGameUpdate }: SocialTabV2Props) {
  const { t, i18n } = useTranslation();
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(() => new Set());
  const [repostedPostIds, setRepostedPostIds] = useState<Set<string>>(() => new Set());
  const [composerText, setComposerText] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const lastLocalizedLanguageRef = useRef<string>("");
  const posts = useMemo(
    () => visibleSocialPosts(gameState.social_posts ?? [], i18n.language),
    [gameState.social_posts, i18n.language],
  );

  useEffect(() => {
    const language = i18n.language;
    if (!language || lastLocalizedLanguageRef.current === language) return;
    lastLocalizedLanguageRef.current = language;
    relocalizeSocialFeed(language)
      .then((updated) => onGameUpdate(updated))
      .catch(() => {
        // keep the current timeline if relocalization fails
      });
  }, [i18n.language, onGameUpdate]);

  async function handlePublishPost(): Promise<void> {
    const text = composerText.trim();
    if (!text) return;
    setPosting(true);
    setPostError(null);
    try {
      onGameUpdate(await createManagerSocialPost(text));
      setComposerText("");
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "No se pudo publicar el post.");
    } finally {
      setPosting(false);
    }
  }

  if (posts.length === 0) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-club-text">
          <Sparkles className="size-7" />
        </div>
        <h2 className="font-heading text-xl font-bold uppercase tracking-wider">
          {t("social.emptyTitle", { defaultValue: "The timeline is quiet" })}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {t("social.emptyBody", {
            defaultValue:
              "Play matches and the community will start posting banter, hot takes, and questionable analysis.",
          })}
        </p>
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-2xl gap-0 overflow-hidden py-0">
      <div className="sticky top-0 z-10 border-b bg-card/90 px-5 py-4 backdrop-blur">
        <h2 className="font-heading text-xl font-bold uppercase tracking-wide">
          {t("social.title", { defaultValue: "Social" })}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("social.subtitle", { defaultValue: "Community timeline" })}
        </p>
        <SocialComposer
          text={composerText}
          posting={posting}
          error={postError}
          onChange={setComposerText}
          onPublish={() => void handlePublishPost()}
        />
      </div>
      {posts.map((post) => (
        <SocialPostItem
          key={post.id}
          post={post}
          gameState={gameState}
          liked={likedPostIds.has(post.id)}
          reposted={repostedPostIds.has(post.id)}
          onToggleLike={() => setLikedPostIds((ids) => toggleId(ids, post.id))}
          onToggleRepost={() => setRepostedPostIds((ids) => toggleId(ids, post.id))}
        />
      ))}
    </Card>
  );
}
