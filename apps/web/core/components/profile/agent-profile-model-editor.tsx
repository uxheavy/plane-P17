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
import type { TAgentProfileModelResponse } from "@/services/agent-profile.service";
import agentProfileService from "@/services/agent-profile.service";

type AgentProfileModelEditorProps = {
  data: TAgentProfileModelResponse;
  identity: string;
  isAdmin: boolean;
  isOpen: boolean;
  mutate: KeyedMutator<TAgentProfileModelResponse>;
  onPendingChange: (isPending: boolean) => void;
  userId: string;
  workspaceSlug: string;
};

type TModelSaveStatus = "conflict" | "forbidden" | "invalid" | "invalid-input" | "uncertain" | "refresh-error" | null;

type TModelEditorState = {
  identity: string;
  provider: string;
  model: string;
  revision: string;
};

const getErrorStatus = (error: { response?: { status?: number } | null; status?: number | null } | null) =>
  error?.response?.status ?? error?.status;

export function AgentProfileModelEditor(props: AgentProfileModelEditorProps) {
  const { data, identity, isAdmin, isOpen, mutate, onPendingChange, userId, workspaceSlug } = props;
  const { t } = useTranslation();
  const [editor, setEditor] = useState<TModelEditorState | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<TModelSaveStatus>(null);

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
      setEditor({
        identity,
        provider: data.provider ?? "",
        model: data.model ?? "",
        revision: data.revision,
      });
      setIsEditing(false);
      setSaveStatus(null);
    }
  }, [data, editor?.identity, identity, isOpen]);

  const handleEdit = () => {
    setEditor({
      identity,
      provider: data.provider ?? "",
      model: data.model ?? "",
      revision: data.revision,
    });
    setIsEditing(true);
    setSaveStatus(null);
  };

  const handleCancel = () => {
    setEditor({
      identity,
      provider: data.provider ?? "",
      model: data.model ?? "",
      revision: data.revision,
    });
    setIsEditing(false);
    setSaveStatus(null);
  };

  const handleReload = async () => {
    setIsRefreshing(true);
    onPendingChange(true);
    try {
      const latest = await mutate();
      if (!latest) throw new Error("Agent profile model refresh returned no data");
      setEditor({
        identity,
        provider: latest.provider ?? "",
        model: latest.model ?? "",
        revision: latest.revision,
      });
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
      const saved = await agentProfileService.updateAgentProfileModel(workspaceSlug, userId, {
        provider: editor.provider.trim() || null,
        model: editor.model.trim() || null,
        expected_revision: editor.revision,
      });

      setEditor((current) =>
        current && current.identity === identity
          ? {
              ...current,
              provider: saved.provider ?? "",
              model: saved.model ?? "",
              revision: saved.revision,
            }
          : current
      );
      await mutate(saved, { revalidate: false });
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

  const provider = editor?.identity === identity ? editor.provider : (data.provider ?? "");
  const model = editor?.identity === identity ? editor.model : (data.model ?? "");
  const isBusy = isSaving || isRefreshing;

  return (
    <div>
      <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.model")}</p>
      {isAdmin && isEditing ? (
        <form className="mt-2 space-y-3" onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-12 text-secondary">
              <span>{t("workspace_settings.settings.members.agent_profile.provider")}</span>
              <input
                aria-label={t("workspace_settings.settings.members.agent_profile.provider")}
                className="focus:ring-focus w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:ring-2"
                disabled={isBusy}
                value={provider}
                onChange={(event) => {
                  setEditor((current) =>
                    current && current.identity === identity ? { ...current, provider: event.target.value } : current
                  );
                  setSaveStatus(null);
                }}
              />
            </label>
            <label className="space-y-1 text-12 text-secondary">
              <span>{t("workspace_settings.settings.members.agent_profile.model")}</span>
              <input
                aria-label={t("workspace_settings.settings.members.agent_profile.model")}
                className="focus:ring-focus w-full rounded-md border border-subtle bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:ring-2"
                disabled={isBusy}
                value={model}
                onChange={(event) => {
                  setEditor((current) =>
                    current && current.identity === identity ? { ...current, model: event.target.value } : current
                  );
                  setSaveStatus(null);
                }}
              />
            </label>
          </div>
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
        <div className="mt-1 grid grid-cols-2 gap-3">
          <div>
            <p className="text-12 text-secondary">{t("workspace_settings.settings.members.agent_profile.provider")}</p>
            <p className="mt-1 text-primary">
              {provider || t("workspace_settings.settings.members.agent_profile.provider_not_configured")}
            </p>
          </div>
          <div>
            <p className="text-12 text-secondary">{t("workspace_settings.settings.members.agent_profile.model")}</p>
            <p className="mt-1 text-primary">
              {model || t("workspace_settings.settings.members.agent_profile.model_not_configured")}
            </p>
          </div>
        </div>
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
                ? t("workspace_settings.settings.members.agent_profile.model_conflict")
                : saveStatus === "forbidden"
                  ? t("workspace_settings.settings.members.agent_profile.model_forbidden")
                  : saveStatus === "invalid"
                    ? t("workspace_settings.settings.members.agent_profile.model_invalid")
                    : saveStatus === "invalid-input"
                      ? t("workspace_settings.settings.members.agent_profile.model_invalid_input")
                      : saveStatus === "refresh-error"
                        ? t("workspace_settings.settings.members.agent_profile.model_refresh_error")
                        : t("workspace_settings.settings.members.agent_profile.model_uncertain")}
            </p>
            {(saveStatus === "conflict" || saveStatus === "uncertain" || saveStatus === "refresh-error") && (
              <Button type="button" variant="secondary" size="lg" loading={isRefreshing} onClick={handleReload}>
                {t("workspace_settings.settings.members.agent_profile.model_load_saved_version")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
