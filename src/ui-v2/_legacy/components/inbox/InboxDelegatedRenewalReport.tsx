import type { JSX } from "react";

import type { MessageData } from "@/store/gameStore";
import { resolveBackendText } from "@/lib/i18n/backendI18n";
import { formatCurrencyAmount } from "@/lib/formatting/valueFormatting";
import { formatDelegatedNoteParams } from "@/lib/i18n/delegatedRenewalNotes";
import { renderMessageBodyLine } from "@/ui-v2/_legacy/components/inbox/inboxHelpers";

interface InboxDelegatedRenewalReportProps {
  message: MessageData;
}

export default function InboxDelegatedRenewalReport({
  message,
}: InboxDelegatedRenewalReportProps): JSX.Element | null {
  const report = message.context?.delegated_renewal_report;

  if (!report || report.cases.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-6 rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-navy-600 dark:bg-navy-700"
      data-testid="delegated-renewal-report"
    >
      <div className="space-y-2">
        {report.cases.map((renewalCase, index) => {
          const detail = resolveBackendText(
            renewalCase.note_key,
            "",
            formatDelegatedNoteParams(renewalCase.note_params),
          );

          const line =
            renewalCase.status === "successful"
              ? resolveBackendText(
                  "be.msg.delegatedRenewals.case.successful",
                  renewalCase.player_name,
                  {
                    player: renewalCase.player_name,
                    years: String(renewalCase.agreed_years ?? 0),
                    wage: formatCurrencyAmount(renewalCase.agreed_wage ?? 0),
                  },
                )
              : renewalCase.status === "stalled"
                ? resolveBackendText(
                    "be.msg.delegatedRenewals.case.stalled",
                    `${renewalCase.player_name} — ${detail}`,
                    {
                      player: renewalCase.player_name,
                      detail,
                    },
                  )
                : resolveBackendText(
                    "be.msg.delegatedRenewals.case.failed",
                    `${renewalCase.player_name} — ${detail}`,
                    {
                      player: renewalCase.player_name,
                      detail,
                    },
                  );

          return renderMessageBodyLine(`• ${line}`, index);
        })}
      </div>
    </div>
  );
}

