import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { GameStateData } from "@/store/gameStore";
import { MatchSnapshot } from "@/ui-v2/_legacy/components/match/types";
import { Badge } from "@/ui-v2/_legacy/components/ui";
import { ChevronRight, Mic, MessageSquare } from "lucide-react";
import { buildPressConferenceQuestions } from "@/ui-v2/_legacy/components/match/pressConferenceContent";
import { cn } from "@/ui-v2/lib/utils";

interface PressConferenceProps {
  snapshot: MatchSnapshot;
  gameState: GameStateData;
  userSide: "Home" | "Away";
  /** The user's actual in-game side (blue/red). */
  controlledSide?: "blue" | "red";
  /** The actual winning side (blue/red). */
  winnerSide?: "blue" | "red";
  /** Optional explicit result override. */
  userResult?: "win" | "loss";
  /** Games in the series that just ended; series questions are only asked after more than one. */
  seriesLength?: number;
  onFinish: () => void;
  onGameUpdate?: (game: GameStateData) => void;
}

interface AnswerPayload {
  question_id: string;
  response_id: string;
  effect_id: string;
  response_tone: string;
  response_text: string;
  question_text: string;
  player_id?: string;
}

const RECENT_PRESS_QUESTIONS_KEY = "olmanager:match:pressConference:recentQuestionIds";
const RECENT_PRESS_QUESTIONS_LIMIT = 12;

function readRecentPressQuestionIds(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_PRESS_QUESTIONS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function persistRecentPressQuestionIds(questionIds: string[]): void {
  if (questionIds.length === 0) return;

  try {
    const existing = readRecentPressQuestionIds();
    const merged = [...existing, ...questionIds].filter(
      (id, index, ids) => ids.lastIndexOf(id) === index,
    );
    window.localStorage.setItem(
      RECENT_PRESS_QUESTIONS_KEY,
      JSON.stringify(merged.slice(-RECENT_PRESS_QUESTIONS_LIMIT)),
    );
  } catch {
    // Ignore storage failures; press conference submission must remain unaffected.
  }
}

export default function PressConference({
  snapshot,
  gameState,
  userSide,
  controlledSide,
  winnerSide,
  userResult,
  seriesLength,
  onFinish,
  onGameUpdate,
}: PressConferenceProps) {
  const { t } = useTranslation();
  const [questions] = useState(() =>
    buildPressConferenceQuestions({
      snapshot,
      userSide,
      gameState,
      controlledSide,
      winnerSide,
      userResult,
      seriesLength,
      t,
      recentQuestionIds: readRecentPressQuestionIds(),
    }),
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const currentQ = questions[currentIdx];
  const isLastQuestion = currentIdx === questions.length - 1;
  const hasAnswered = currentQ ? !!answers[currentQ.id] : false;

  useEffect(() => {
    persistRecentPressQuestionIds(questions.map((question) => question.id));
  }, [questions]);

  const handleAnswer = (responseId: string) => {
    if (!currentQ) return;
    setAnswers((prev) => ({ ...prev, [currentQ.id]: responseId }));
  };

  const submitToBackend = async () => {
    setSubmitting(true);
    try {
      const payloads: AnswerPayload[] = questions
        .map((q) => {
          const rid = answers[q.id];
          const resp = q.responses.find((r) => r.id === rid);
          return {
            question_id: q.id,
            response_id: rid || "",
            effect_id: resp?.effectId || "",
            response_tone: resp?.tone || "",
            response_text: resp?.text || "",
            question_text: q.question,
            player_id: q.playerId || "",
          };
        })
        .filter((p) => p.response_id);

      const userTeamName =
        userSide === "Home" ? snapshot.home_team.name : snapshot.away_team.name;
      const userTeamId =
        userSide === "Home" ? snapshot.home_team.id : snapshot.away_team.id;
      const resultStr = `${snapshot.home_team.name} ${snapshot.home_score} - ${snapshot.away_score} ${snapshot.away_team.name}`;
      const quotes = payloads
        .filter((p) => p.response_text)
        .map((p) => `"${p.response_text}"`);
      const firstQuoteRaw = payloads[0]?.response_text ?? "";

      const prerenderedHeadline =
        quotes.length === 0
          ? t("match.pressReport.headlinePostMatch", { team: userTeamName, result: resultStr })
          : Math.random() < 0.5
            ? t("match.pressReport.headlineManagerQuote", { team: userTeamName, quote: firstQuoteRaw })
            : t("match.pressReport.headlinePressConf", { team: userTeamName, quote: firstQuoteRaw });

      let prerenderedBody: string;
      if (quotes.length > 1) {
        const bulletList = quotes.map((q) => `• ${q}`).join("\n");
        prerenderedBody =
          t("match.pressReport.bodyIntro", { result: resultStr, team: userTeamName }) +
          "\n\n" +
          bulletList +
          "\n\n" +
          t("match.pressReport.bodyOutro");
      } else if (quotes.length === 1) {
        prerenderedBody =
          t("match.pressReport.bodySingle", { team: userTeamName, result: resultStr }) +
          "\n\n" +
          quotes[0];
      } else {
        prerenderedBody = t("match.pressReport.bodyNone", { team: userTeamName, result: resultStr });
      }

      const result = await invoke<{
        game: GameStateData;
        morale_delta: number;
      }>("submit_press_conference", {
        answers: payloads,
        homeTeam: snapshot.home_team.name,
        awayTeam: snapshot.away_team.name,
        homeScore: snapshot.home_score,
        awayScore: snapshot.away_score,
        userTeamName: userTeamName,
        userTeamId: userTeamId,
        prerenderedBody,
        prerenderedHeadline,
      });
      if (result.game && onGameUpdate) {
        onGameUpdate(result.game);
      }
    } catch (err) {
      console.error("Failed to submit press conference:", err);
    } finally {
      setSubmitting(false);
      onFinish();
    }
  };

  const handleNext = () => {
    if (isLastQuestion) {
      submitToBackend();
    } else {
      setCurrentIdx((prev) => prev + 1);
    }
  };

  const userTeamName =
    userSide === "Home" ? snapshot.home_team.name : snapshot.away_team.name;

  return (
    <div className="min-h-0 flex-1 bg-background text-foreground flex flex-col overflow-y-auto">
      <header className="border-b border-border bg-card px-4 py-6">
        <div className="max-w-3xl mx-auto text-center relative">

          <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-muted rounded-full mb-3">
            <Mic className="w-4 h-4 text-accent-400" />
            <span className="font-heading font-bold text-xs uppercase tracking-widest text-muted-foreground">
              {t("match.pressConference")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("match.pressSubtitle", { team: userTeamName })}
          </p>
          <div className="flex items-center justify-center gap-1 mt-3">
            {questions.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "w-8 h-1 rounded-full transition-colors",
                  i < currentIdx
                    ? "bg-primary-500"
                    : i === currentIdx
                      ? "bg-primary-400"
                      : "bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-6">
        {currentQ && (
          <div className="max-w-2xl w-full">
            <div className="flex items-start gap-4 mb-8">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <MessageSquare className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-heading font-bold text-sm text-foreground">
                    {currentQ.journalist}
                  </span>
                  <Badge variant="neutral" size="sm">
                    {currentQ.outlet}
                  </Badge>
                </div>
                <p className="text-lg text-muted-foreground leading-relaxed italic">
                  "{currentQ.question}"
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 ml-16">
              {currentQ.responses.map((r) => {
                const isSelected = answers[currentQ.id] === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => handleAnswer(r.id)}
                    disabled={hasAnswered}
                    className={cn(
                      "p-4 rounded-xl text-left transition-all",
                      isSelected
                        ? "bg-primary-500/20 ring-2 ring-primary-500/50"
                        : hasAnswered
                          ? "bg-muted/50 opacity-40"
                          : "bg-card hover:bg-accent border border-border",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={isSelected ? "primary" : "neutral"}
                        size="sm"
                      >
                        {r.tone}
                      </Badge>
                    </div>
                    <p
                      className={cn(
                        "text-sm",
                        isSelected ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      "{r.text}"
                    </p>
                  </button>
                );
              })}
            </div>

            {hasAnswered && (
              <div className="flex justify-end mt-6 ml-16">
                <button
                  onClick={handleNext}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 rounded-xl font-heading font-bold uppercase tracking-wider text-sm text-white shadow-lg shadow-primary-500/20 transition-all"
                >
                  {submitting
                    ? t("match.submitting")
                    : isLastQuestion
                      ? t("match.leaveConference")
                      : t("match.nextQuestion")}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="bg-card border-t border-border px-6 py-3">
        <div className="max-w-3xl mx-auto flex justify-end">
          <button
            onClick={onFinish}
            className="text-xs font-heading uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("match.skipConference")}
          </button>
        </div>
      </footer>
    </div>
  );
}
