/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { Dialog } from "@headlessui/react";
import { ChevronRight, Loader, X } from "lucide-react";
import useSWR from "swr";
import { useTranslation } from "@plane/i18n";
import { InfoIcon } from "@plane/propel/icons";
import { Button } from "@plane/propel/button";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import type { TAgentProfileModelResponse, TAgentProfileResponse } from "@/services/agent-profile.service";
import agentProfileService from "@/services/agent-profile.service";
import { AgentProfileDescriptionEditor } from "./agent-profile-description-editor";
import { AgentProfileModelEditor } from "./agent-profile-model-editor";
import { AgentProfileSkillEditor } from "./agent-profile-skill-editor";

type AgentProfileModalProps = {
  agentName: string | null;
  isAdmin: boolean;
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  workspaceSlug: string;
};

export function AgentProfileModal(props: AgentProfileModalProps) {
  const { agentName, isAdmin, isOpen, onClose, userId, workspaceSlug } = props;
  const { t } = useTranslation();
  const profileKey = isOpen ? ["AGENT_PROFILE", workspaceSlug, userId] : null;
  const modelKey = isOpen ? ["AGENT_PROFILE_MODEL", workspaceSlug, userId] : null;
  const profileIdentity = `${workspaceSlug}:${userId}`;
  const {
    data: profileData,
    error: profileError,
    isLoading: isProfileLoading,
    mutate: mutateProfile,
  } = useSWR<TAgentProfileResponse>(profileKey, () => agentProfileService.getAgentProfile(workspaceSlug, userId));
  const {
    data: modelData,
    error: modelError,
    isLoading: isModelLoading,
    mutate: mutateModel,
  } = useSWR<TAgentProfileModelResponse>(modelKey, () =>
    agentProfileService.getAgentProfileModel(workspaceSlug, userId)
  );
  const [isSaving, setIsSaving] = useState(false);
  const handleClose = () => {
    if (!isSaving) onClose();
  };
  const isLoading = isProfileLoading || isModelLoading;

  return (
    <ModalCore
      isOpen={isOpen}
      handleClose={isSaving ? undefined : handleClose}
      position={EModalPosition.CENTER}
      width={EModalWidth.LG}
    >
      <div className="relative px-5 py-4">
        <Dialog.Title as="h2" className="pr-8 text-18 font-medium text-primary">
          {agentName || t("workspace_settings.settings.members.agent_profile.title")}
        </Dialog.Title>
        <button
          type="button"
          className="focus:ring-focus absolute top-4 right-4 rounded p-1 text-secondary hover:bg-layer-1 hover:text-primary focus:ring-2 focus:outline-none disabled:pointer-events-none disabled:opacity-50"
          aria-label={t("workspace_settings.settings.members.agent_profile.close")}
          onClick={handleClose}
          disabled={isSaving}
        >
          <X className="size-4" aria-hidden="true" />
        </button>

        {isLoading && !profileData ? (
          <output className="flex min-h-32 items-center justify-center" aria-live="polite">
            <Loader className="size-5 animate-spin text-secondary" aria-hidden="true" />
            <span className="sr-only">{t("workspace_settings.settings.members.agent_profile.loading")}</span>
          </output>
        ) : !profileData && profileError ? (
          <div className="py-6">
            <p className="text-13 text-secondary">{t("workspace_settings.settings.members.agent_profile.error")}</p>
            <Button className="mt-4" variant="secondary" size="lg" onClick={() => mutateProfile()}>
              {t("workspace_settings.settings.members.agent_profile.retry")}
            </Button>
          </div>
        ) : profileData ? (
          <div className="mt-5 max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-13">
            <div>
              <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.label")}</p>
              <p className="mt-1 text-primary">{profileData.label}</p>
            </div>
            <AgentProfileDescriptionEditor
              data={profileData}
              identity={profileIdentity}
              isAdmin={isAdmin}
              isOpen={isOpen}
              mutate={mutateProfile}
              onPendingChange={setIsSaving}
              userId={userId}
              workspaceSlug={workspaceSlug}
            />
            {isModelLoading ? (
              <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.loading")}</p>
            ) : modelData ? (
              <AgentProfileModelEditor
                data={modelData}
                identity={profileIdentity}
                isAdmin={isAdmin}
                isOpen={isOpen}
                mutate={mutateModel}
                onPendingChange={setIsSaving}
                userId={userId}
                workspaceSlug={workspaceSlug}
              />
            ) : modelError ? (
              <div>
                <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.model_error")}</p>
                <Button className="mt-3" variant="secondary" size="lg" onClick={() => mutateModel()}>
                  {t("workspace_settings.settings.members.agent_profile.retry")}
                </Button>
              </div>
            ) : null}
            <section aria-labelledby={`agent-profile-instructions-heading-${userId}`}>
              {!profileData.instructions.exists ? (
                <div>
                  <p id={`agent-profile-instructions-heading-${userId}`} className="text-secondary">
                    {t("workspace_settings.settings.members.agent_profile.instructions")}
                  </p>
                  <p className="mt-1 text-secondary">
                    {t("workspace_settings.settings.members.agent_profile.instructions_missing")}
                  </p>
                </div>
              ) : profileData.instructions.content ? (
                <details className="group rounded-md bg-layer-1">
                  <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-2.5 text-left text-primary">
                    <ChevronRight
                      className="mt-0.5 size-4 shrink-0 text-secondary transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span id={`agent-profile-instructions-heading-${userId}`} className="block text-secondary">
                        {t("workspace_settings.settings.members.agent_profile.instructions")}
                      </span>
                      <span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-primary group-open:hidden">
                        {profileData.instructions.content}
                      </span>
                      {profileData.instructions.truncated && (
                        <span className="mt-1 block text-secondary">
                          {t("workspace_settings.settings.members.agent_profile.instructions_truncated")}
                        </span>
                      )}
                    </span>
                  </summary>
                  <div className="border-t border-subtle px-3 py-3">
                    <div className="max-h-64 overflow-auto text-13 break-words whitespace-pre-wrap text-primary">
                      {profileData.instructions.content}
                    </div>
                  </div>
                </details>
              ) : (
                <div>
                  <p id={`agent-profile-instructions-heading-${userId}`} className="text-secondary">
                    {t("workspace_settings.settings.members.agent_profile.instructions")}
                  </p>
                  <p className="mt-1 text-secondary">
                    {profileData.instructions.truncated
                      ? t("workspace_settings.settings.members.agent_profile.instructions_truncated")
                      : t("workspace_settings.settings.members.agent_profile.instructions_empty")}
                  </p>
                </div>
              )}
            </section>
            <AgentProfileSkillEditor
              key={profileIdentity}
              data={profileData.skills}
              identity={profileIdentity}
              isAdmin={isAdmin}
              isOpen={isOpen}
              mutateProfile={mutateProfile}
              onPendingChange={setIsSaving}
              userId={userId}
              workspaceSlug={workspaceSlug}
            />
            <div className="flex gap-2 rounded-md bg-layer-1 p-3 text-secondary">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{t("workspace_settings.settings.members.agent_profile.source_description")}</p>
            </div>
          </div>
        ) : null}
      </div>
    </ModalCore>
  );
}
