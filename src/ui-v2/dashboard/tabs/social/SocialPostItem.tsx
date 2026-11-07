import { BadgeCheck, Heart, MessageCircle, Repeat2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GameStateData, SocialPostData } from "@/store/gameStore";
import { assetUrl } from "@/lib/assetUrl";
import { formatDateShort } from "@/lib/common/helpers";
import {
  authorRing,
  formatCount,
  sentimentClasses,
  SOCIAL_AUTHOR_LABELS,
  verifiedMeta,
} from "@/lib/social/helpers";
import { resolveSocialAvatar } from "@/lib/social/resolveSocialAvatar";
import { Badge } from "@/ui-v2/components/ui/badge";
import { cn } from "@/ui-v2/lib/utils";

function PostAvatar({
  post,
  gameState,
}: {
  post: SocialPostData;
  gameState: GameStateData;
}) {
  const src = assetUrl(
    resolveSocialAvatar(post, gameState.social_accounts ?? [], gameState.teams, gameState.players),
  );
  return (
    <div
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-linear-to-br font-heading text-sm font-bold text-white",
        authorRing(post.author_type),
      )}
    >
      {src ? (
        <img
          src={src}
          alt={post.author_name}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : (
        <span>{post.author_name.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

interface SocialPostItemProps {
  post: SocialPostData;
  gameState: GameStateData;
  liked: boolean;
  reposted: boolean;
  onToggleLike: () => void;
  onToggleRepost: () => void;
}

export function SocialPostItem({
  post,
  gameState,
  liked,
  reposted,
  onToggleLike,
  onToggleRepost,
}: SocialPostItemProps) {
  const { t, i18n } = useTranslation();
  const verified = verifiedMeta(post.author_type);
  const likes = post.likes + (liked ? 1 : 0);
  const reposts = post.reposts + (reposted ? 1 : 0);

  return (
    <article className="flex gap-3 border-b px-5 py-4 transition-colors hover:bg-muted/50">
      <PostAvatar post={post} gameState={gameState} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="truncate font-bold">{post.author_name}</span>
          {verified ? (
            <BadgeCheck className={cn("size-4 shrink-0", verified.color)} aria-label={verified.title} />
          ) : null}
          <span className="truncate text-sm text-muted-foreground">{post.author_handle}</span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm tabular-nums text-muted-foreground">
            {formatDateShort(post.date, i18n.language)}
          </span>
        </div>

        <p className="mt-1 whitespace-pre-line text-sm leading-normal">{post.body}</p>

        {post.media_url ? (
          <div className="mt-3 overflow-hidden rounded-xl border">
            <img
              src={post.media_url}
              alt={t("social.mediaAlt", { defaultValue: "Post media" })}
              className="max-h-96 w-full object-cover"
              loading="lazy"
            />
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary" className="font-heading uppercase tracking-wider">
            {SOCIAL_AUTHOR_LABELS[post.author_type] ?? post.author_type}
          </Badge>
          <Badge
            variant="ghost"
            className={cn("font-heading uppercase tracking-wider", sentimentClasses(post.sentiment))}
          >
            {post.sentiment}
          </Badge>
        </div>

        <div className="mt-4 flex max-w-md items-center justify-between text-sm tabular-nums text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="size-4" /> {formatCount(post.replies)}
          </span>
          <button
            type="button"
            aria-pressed={reposted}
            onClick={onToggleRepost}
            className={cn(
              "inline-flex items-center gap-1.5 transition-colors hover:text-emerald-500",
              reposted && "text-emerald-500",
            )}
          >
            <Repeat2 className="size-4" /> {formatCount(reposts)}
          </button>
          <button
            type="button"
            aria-pressed={liked}
            onClick={onToggleLike}
            className={cn(
              "inline-flex items-center gap-1.5 transition-colors hover:text-pink-500",
              liked && "text-pink-500",
            )}
          >
            <Heart className={cn("size-4", liked && "fill-current")} /> {formatCount(likes)}
          </button>
        </div>
      </div>
    </article>
  );
}
