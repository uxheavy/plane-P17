/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import type { KeyedMutator } from "swr";
import { useTranslation } from "@plane/i18n";
import { InfoIcon } from "@plane/propel/icons";
import { Button } from "@plane/propel/button";
import type { TAgentProfileResponse } from "@/services/agent-profile.service";
import agentProfileService from "@/services/agent-profile.service";

type AgentProfileDescriptionEditorProps = {
  data: TAgentProfileResponse;
  identity: string;
  isAdmin: boolean;
  isOpen: boolean;
  mutate: KeyedMutator<TAgentProfileResponse>;
  onPendingChange: (isPending: boolean) => void;
  userId: string;
  workspaceSlug: string;
};

type TSaveStatus = "conflict" | "forbidden" | "invalid" | "invalid-input" | "uncertain" | "refresh-error" | null;

type TEditorState = {
  description: string;
  identity: string;
  revision: string;
};

type TAgentProfileRequestError = {
  response?: { status?: number } | null;
  status?: number | null;
} | null;

const getErrorStatus = (error: TAgentProfileRequestError) => error?.response?.status ?? error?.status;

export function AgentProfileDescriptionEditor(props: AgentProfileDescriptionEditorProps) {
  const { data, identity, isAdmin, isOpen, mutate, onPendingChange, userId, workspaceSlug } = props;
  const { t } = useTranslation();
  const [editor, setEditor] = useState<TEditorState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<TSaveStatus>(null);

  useEffect(() => {
    if (!isOpen) {
      // oxlint-disable-next-line react/set-state-in-effect
      setEditor(null);
      setIsEditing(false);
      setSaveStatus(null);
      return;
    }

    if (editor?.identity !== identity) {
      // oxlint-disable-next-line react/set-state-in-effect
      setEditor({ identity, description: data.description, revision: data.revision });
      setIsEditing(false);
      setSaveStatus(null);
    }
  }, [data, editor?.identity, identity, isOpen]);

  const handleEdit = () => {
    setEditor({ identity, description: data.description, revision: data.revision });
    setIsEditing(true);
    setSaveStatus(null);
  };

  const handleCancel = () => {
    setEditor({ identity, description: data.description, revision: data.revision });
    setIsEditing(false);
    setSaveStatus(null);
  };

  const handleReload = async () => {
    setIsRefreshing(true);
    onPendingChange(true);
    try {
      const latest = await mutate();
      if (!latest) throw new Error("Agent profile refresh returned no data");

      setEditor({ identity, description: latest.description, revision: latest.revision });
      setSaveStatus(null);
      setIsEditing(true);
    } catch {
      setSaveStatus("refresh-error");
    } finally {
      setIsRefreshing(false);
      onPendingChange(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor || editor.identity !== identity || isSaving || isRefreshing) return;

    setIsSaving(true);
    onPendingChange(true);
    setSaveStatus(null);
    try {
      const saved = await agentProfileService.updateAgentProfile(workspaceSlug, userId, {
        description: editor.description,
        expected_revision: editor.revision,
      });

      setEditor((current) =>
        current && current.identity === identity
          ? { ...current, description: saved.description, revision: saved.revision }
          : current
      );
      await mutate(
        (current) => (current ? { ...current, description: saved.description, revision: saved.revision } : current),
        { revalidate: false }
      );
      setIsEditing(false);
    } catch (saveError: unknown) {
      const status = isAxiosError(saveError) ? getErrorStatus(saveError) : undefined;
      if (status === 400) setSaveStatus("invalid-input");
      else if (status === 409) setSaveStatus("conflict");
      else if (status === 403) setSaveStatus("forbidden");
      else if (status === 422) setSaveStatus("invalid");
      else setSaveStatus("uncertain");
    } finally {
      setIsSaving(false);
      onPendingChange(false);
    }
  };

  const description = editor?.identity === identity ? editor.description : data.description;
  const isBusy = isSaving || isRefreshing;

  return (
    <div>
      <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.description")}</p>
      {isAdmin && isEditing ? (
        <form className="mt-1 space-y-3" onSubmit={handleSubmit}>
          <textarea
            className="focus:ring-focus min-h-24 w-full resize-y rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:ring-2"
            aria-label={t("workspace_settings.settings.members.agent_profile.description")}
            value={description}
            onChange={(event) => {
              setEditor((current) =>
                current && current.identity === identity ? { ...current, description: event.target.value } : current
              );
              setSaveStatus(null);
            }}
            disabled={isBusy}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="lg" onClick={handleCancel} disabled={isBusy}>
              {t("workspace_settings.settings.members.agent_profile.cancel")}
            </Button>
            <Button type="submit" size="lg" loading={isSaving} disabled={isRefreshing}>
              {isSaving
                ? t("workspace_settings.settings.members.agent_profile.saving")
                : t("workspace_settings.settings.members.agent_profile.save")}
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-primary">{description}</p>
      )}
      {isAdmin && !isEditing && (
        <Button variant="secondary" size="lg" className="mt-3" onClick={handleEdit} disabled={isBusy}>
          {t("workspace_settings.settings.members.agent_profile.edit")}
        </Button>
      )}
      {saveStatus && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-layer-1 p-3 text-secondary" aria-live="polite">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>
              {saveStatus === "conflict"
                ? t("workspace_settings.settings.members.agent_profile.conflict")
                : saveStatus === "forbidden"
                  ? t("workspace_settings.settings.members.agent_profile.forbidden")
                  : saveStatus === "invalid"
                    ? t("workspace_settings.settings.members.agent_profile.invalid")
                    : saveStatus === "invalid-input"
                      ? t("workspace_settings.settings.members.agent_profile.invalid_input")
                      : saveStatus === "refresh-error"
                        ? t("workspace_settings.settings.members.agent_profile.refresh_error")
                        : t("workspace_settings.settings.members.agent_profile.uncertain")}
            </p>
            {(saveStatus === "conflict" || saveStatus === "uncertain" || saveStatus === "refresh-error") && (
              <Button type="button" variant="secondary" size="lg" loading={isRefreshing} onClick={handleReload}>
                {t("workspace_settings.settings.members.agent_profile.load_saved_version")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
