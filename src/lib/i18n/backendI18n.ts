import i18n from '../../i18n';
import { formatDate } from '../formatting/dateFormatting';
import type {
  MessageActionOption,
  MessageData,
  MessageAction,
  NewsArticle,
  BoardObjective,
} from '../../store/gameStore';
import {
  inferLegacyDelegatedRenewalsParams,
  normalizeNewsParams,
  resolveLegacyDelegatedRenewalsMessage,
} from './backendI18n.legacy';
import {
  inferPlayerEventActionLabelKey,
  inferPlayerEventOptionBaseKey,
} from './backendI18nPlayerEvents.ts';

/**
 * Resolve a backend i18n key with params, falling back to the raw string.
 */
function resolve(key: string | undefined, fallback: string, params?: Record<string, string>): string {
  if (!key) return fallback;
  // i18next picks a singular/plural form only for a numeric `count`; backend params are strings.
  const options: Record<string, string | number> = { ...params };
  if (/^\d+$/.test(params?.count ?? '')) options.count = Number(params?.count);
  const resolved = i18n.t(key, options);
  // i18next returns the key itself if not found — fall back to raw string
  if (resolved === key) return fallback;
  return resolved;
}

export function resolveBackendText(
  key: string | undefined,
  fallback: string,
  params?: Record<string, string>,
): string {
  return resolve(key, fallback, params);
}

function boardObjectiveFallback(objective: BoardObjective): string {
  switch (objective.objective_type) {
    case 'LeaguePosition':
      return `Finish in the top ${objective.target}`;
    case 'Wins':
      return `Win at least ${objective.target} series`;
    case 'GoalsScored':
      return `Win at least ${objective.target} maps`;
    default:
      return objective.description;
  }
}

const ISO_DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Pre-resolve param values before interpolation:
 * - an ISO date (YYYY-MM-DD) is formatted for the active language, so the backend
 *   never has to format a date for a locale;
 * - a value that is itself an i18n key (e.g. "common.moods.excellent") is translated.
 *   A value is treated as a key if it contains a dot and i18next resolves it to something different.
 */
function resolveParamValues(params?: Record<string, string>): Record<string, string> | undefined {
  if (!params) return params;
  const resolved = { ...params };
  for (const [key, value] of Object.entries(resolved)) {
    if (ISO_DATE_PARAM.test(value)) {
      resolved[key] = formatDate(value, i18n.language);
    } else if (value.includes('.')) {
      const attempted = i18n.t(value);
      if (attempted !== value) {
        resolved[key] = attempted;
      }
    }
  }
  return resolved;
}

/**
 * Resolve all translatable fields on a message, returning a copy with resolved strings.
 */
export function resolveMessage(msg: MessageData): MessageData {
  const inferredParams = msg.i18n_params ?? inferLegacyDelegatedRenewalsParams(msg);
  const p = resolveParamValues(inferredParams);
  const resolved = {
    ...msg,
    i18n_params: inferredParams,
    subject: resolve(msg.subject_key, msg.subject, p),
    body: resolve(msg.body_key, msg.body, p),
    sender: resolve(msg.sender_key, msg.sender, p),
    sender_role: resolve(msg.sender_role_key, msg.sender_role, p),
    actions: msg.actions.map((action) => resolveAction(action, msg.id, p)),
  };

  return resolveLegacyDelegatedRenewalsMessage(resolved, resolve, p);
}

/**
 * Resolve the label on a message action.
 */
export function resolveAction(
  action: MessageAction,
  messageId?: string,
  params?: Record<string, string>,
): MessageAction {
  const labelKey = action.label_key ?? inferPlayerEventActionLabelKey(messageId ?? '', action.id);

  if (typeof action.action_type === 'object' && 'ChooseOption' in action.action_type) {
    return {
      ...action,
      label: resolve(labelKey, action.label, params),
      action_type: {
        ChooseOption: {
          options: action.action_type.ChooseOption.options.map((option) =>
            resolveActionOption(option, messageId, params),
          ),
        },
      },
    };
  }

  return {
    ...action,
    label: resolve(labelKey, action.label, params),
  };
}

function resolveActionOption(
  option: MessageActionOption,
  messageId?: string,
  params?: Record<string, string>,
): MessageActionOption {
  const baseKey = inferPlayerEventOptionBaseKey(messageId ?? '', option.id);
  const labelKey = option.label_key ?? (baseKey ? `${baseKey}.label` : undefined);
  const descriptionKey = option.description_key ?? (baseKey ? `${baseKey}.description` : undefined);

  return {
    ...option,
    label: resolve(labelKey, option.label, params),
    description: resolve(descriptionKey, option.description, params),
  };
}

/**
 * Resolve all translatable fields on a news article, returning a copy with resolved strings.
 */
export function resolveNewsArticle(article: NewsArticle): NewsArticle {
  const p = normalizeNewsParams(article);
  return {
    ...article,
    i18n_params: p,
    headline: resolve(article.headline_key, article.headline, p),
    body: resolve(article.body_key, article.body, p),
    source: resolve(article.source_key, article.source, p),
  };
}

/**
 * Resolve a board objective description from its structured type and target.
 */
export function resolveBoardObjective(objective: BoardObjective): BoardObjective {
  const descriptionKey = `boardObjectives.objective.${objective.objective_type}`;
  const params = { target: String(objective.target) };

  return {
    ...objective,
    description: resolve(descriptionKey, boardObjectiveFallback(objective), params),
  };
}

