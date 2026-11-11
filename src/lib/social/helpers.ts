import type { SocialPostData } from "@/store/gameStore";

export const SOCIAL_AUTHOR_LABELS: Record<string, string> = {
  Team: "Team",
  Player: "Player",
  Fan: "Fan",
  Analyst: "Analyst",
  Journalist: "Media",
  MemeAccount: "Meme",
  Manager: "Manager",
};

const SENTIMENT_CLASSES: Record<string, string> = {
  Hype: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Calm: "bg-muted text-muted-foreground",
  Worried: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Angry: "bg-red-500/10 text-red-600 dark:text-red-400",
  Meltdown: "bg-red-500/10 text-red-600 dark:text-red-400",
  Copium: "bg-primary/10 text-club-text",
};

export function sentimentClasses(sentiment: string): string {
  return SENTIMENT_CLASSES[sentiment] ?? SENTIMENT_CLASSES.Calm;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function authorRing(authorType: string): string {
  switch (authorType) {
    case "Team":
      return "from-primary to-primary/70";
    case "Player":
      return "from-emerald-500 to-emerald-400";
    case "Analyst":
    case "Journalist":
      return "from-indigo-500 to-indigo-400";
    case "MemeAccount":
      return "from-pink-500 to-orange-400";
    default:
      return "from-muted to-muted-foreground/30";
  }
}

export function verifiedMeta(authorType: string): { color: string; title: string } | null {
  if (authorType === "Team") return { color: "text-amber-400", title: "Golden verified team" };
  if (authorType === "Player") return { color: "text-sky-500", title: "Verified player" };
  return null;
}

/** Newest first; the Spanish-only fan post is hidden for other languages. */
export function visibleSocialPosts(posts: SocialPostData[], language: string): SocialPostData[] {
  return [...posts]
    .filter((post) => {
      if (post.id.endsWith("_fan_bouzys_fnatic")) {
        return language.toLowerCase().startsWith("es");
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
