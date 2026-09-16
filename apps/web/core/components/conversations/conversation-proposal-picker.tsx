/**
 * Copyright (c) 2026-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { LoaderCircle, X } from "lucide-react";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { MemberDropdown } from "@/components/dropdowns/member/dropdown";
import type { TConversationProposal } from "./conversation-sidebar-state";

type TConversationProposalPickerProps = {
  proposal: TConversationProposal;
  agentIds: string[];
  onSelectAgent: (agentUserId: string) => void;
  onCancel: () => void;
};

export function ConversationProposalPicker({
  agentIds,
  onCancel,
  onSelectAgent,
  proposal,
}: TConversationProposalPickerProps) {
  const { t } = useTranslation();
  const isSubmitting =
    proposal.status === "submitting" || proposal.status === "processing" || proposal.status === "uncertain";
  const availableAgentIds = agentIds;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-1 px-3 py-2 text-11 text-secondary">
      <div className="flex items-center justify-between gap-2">
        <span>{t("sidebar.chat.choose_agent")}</span>
        <Button
          aria-label={t("common.cancel")}
          className="size-6 p-1"
          disabled={isSubmitting}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <MemberDropdown
        buttonClassName="w-full justify-between"
        buttonVariant="border-with-text"
        disabled={proposal.status !== "selecting" || availableAgentIds.length === 0}
        memberIds={availableAgentIds}
        multiple={false}
        onChange={(agentUserId) => {
          if (agentUserId) onSelectAgent(agentUserId);
        }}
        placeholder={
          availableAgentIds.length > 0 ? t("sidebar.chat.select_agent") : t("sidebar.chat.no_agents_available")
        }
        showUserDetails
        value={proposal.agentUserId}
      />
      {isSubmitting && (
        <div className="flex items-center gap-1.5 text-tertiary">
          <LoaderCircle className="size-3 animate-spin" />
          <span>
            {t(proposal.status === "uncertain" ? "sidebar.chat.proposal_uncertain" : "sidebar.chat.proposal_loading")}
          </span>
        </div>
      )}
      {proposal.error && <p className="text-danger-secondary">{proposal.error}</p>}
    </div>
  );
}
