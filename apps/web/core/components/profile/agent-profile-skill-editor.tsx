/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import useSWR, { type KeyedMutator } from "swr";
import { useTranslation } from "@plane/i18n";
import { InfoIcon } from "@plane/propel/icons";
import { Button } from "@plane/propel/button";
import type {
  TAgentProfilePendingSkillsResponse,
  TAgentProfileResponse,
  TAgentProfileSkill,
  TAgentProfileSkillEditResponse,
  TAgentProfileSkillResponse,
} from "@/services/agent-profile.service";
import agentProfileService from "@/services/agent-profile.service";

type AgentProfileSkillEditorProps = {
  data: TAgentProfileResponse["skills"];
  identity: string;
  isAdmin: boolean;
  isOpen: boolean;
  mutateProfile: KeyedMutator<TAgentProfileResponse>;
  onPendingChange: (isPending: boolean) => void;
  userId: string;
  workspaceSlug: string;
};

type TSkillTarget = {
  owner_id: string;
  skill_id: string;
  expected_revision: string;
  name: string;
};

type TSkillStatus = "conflict" | "forbidden" | "invalid" | "saved" | "uncertain" | "refresh-error" | null;

const getErrorStatus = (error: unknown) => {
  if (!isAxiosError(error)) return undefined;
  return error.response?.status;
};

const skillKey = (skill: TAgentProfileSkill) =>
  skill.editable ? `${skill.owner_id}:${skill.skill_id}` : `readonly:${skill.item_id}`;

const editableTarget = (skill: TAgentProfileSkill): TSkillTarget | null =>
  skill.editable
    ? {
        owner_id: skill.owner_id,
        skill_id: skill.skill_id,
        expected_revision: skill.revision,
        name: skill.name,
      }
    : null;

const pendingItems = (value: TAgentProfilePendingSkillsResponse | undefined) =>
  value && "items" in value ? value.items : [];

export function AgentProfileSkillEditor(props: AgentProfileSkillEditorProps) {
  const { data, identity, isAdmin, isOpen, mutateProfile, onPendingChange, userId, workspaceSlug } = props;
  const { t } = useTranslation();
  const [target, setTarget] = useState<TSkillTarget | null>(null);
  const [content, setContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [status, setStatus] = useState<TSkillStatus>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [stateIdentity, setStateIdentity] = useState(identity);

  const readKey =
    isOpen && target
      ? ["AGENT_PROFILE_SKILL", identity, target.owner_id, target.skill_id, target.expected_revision]
      : null;
  const {
    data: skillData,
    error: skillError,
    isLoading: isSkillLoading,
  } = useSWR<TAgentProfileSkillResponse>(readKey, () =>
    agentProfileService.getAgentProfileSkill(
      workspaceSlug,
      userId,
      target?.owner_id ?? "",
      target?.skill_id ?? "",
      target?.expected_revision ?? ""
    )
  );
  const pendingListKey = isOpen && isAdmin ? ["AGENT_PROFILE_SKILL_PENDING", identity] : null;
  const {
    data: pendingData,
    error: pendingError,
    isLoading: isPendingLoading,
    mutate: mutatePending,
  } = useSWR<TAgentProfilePendingSkillsResponse>(pendingListKey, () =>
    agentProfileService.getAgentProfileSkillPending(workspaceSlug, userId)
  );
  const reviewKey = isOpen && pendingId ? ["AGENT_PROFILE_SKILL_REVIEW", identity, pendingId] : null;
  const {
    data: reviewData,
    error: reviewError,
    isLoading: isReviewLoading,
  } = useSWR<TAgentProfilePendingSkillsResponse>(reviewKey, () =>
    agentProfileService.getAgentProfileSkillPending(workspaceSlug, userId, pendingId ?? undefined)
  );

  useEffect(() => {
    if (!isOpen || stateIdentity !== identity) {
      // oxlint-disable-next-line react/set-state-in-effect
      setStateIdentity(identity);
      setTarget(null);
      setContent("");
      setIsEditing(false);
      setPendingId(null);
      setStatus(null);
      return;
    }
    if (skillData && !isEditing && skillData.owner_id === target?.owner_id && skillData.skill_id === target.skill_id) {
      // oxlint-disable-next-line react/set-state-in-effect
      setContent(skillData.content);
    }
  }, [identity, isEditing, isOpen, skillData, stateIdentity, target?.owner_id, target?.skill_id]);

  const selectSkill = (skill: TAgentProfileSkill) => {
    const nextTarget = editableTarget(skill);
    if (!nextTarget) return;
    setTarget(nextTarget);
    setPendingId(null);
    setIsEditing(false);
    setContent("");
    setStatus(null);
  };

  const selectPending = (item: TSkillTarget & { id: string }) => {
    setTarget(item);
    setPendingId(item.id);
    setIsEditing(false);
    setStatus(null);
  };

  const handleReload = async () => {
    setStatus(null);
    onPendingChange(true);
    try {
      const latestProfile = await mutateProfile();
      const latestSkill = latestProfile?.skills.items.find(
        (skill) => skill.editable && skill.owner_id === target?.owner_id && skill.skill_id === target?.skill_id
      );
      if (!latestSkill || !latestSkill.editable) throw new Error("Saved skill target is unavailable");
      const latestTarget = editableTarget(latestSkill);
      if (!latestTarget) throw new Error("Saved skill target is unavailable");
      const latest = await agentProfileService.getAgentProfileSkill(
        workspaceSlug,
        userId,
        latestTarget.owner_id,
        latestTarget.skill_id,
        latestTarget.expected_revision
      );
      setTarget(latestTarget);
      setContent(latest.content);
      setPendingId(null);
      setIsEditing(true);
    } catch {
      setStatus("refresh-error");
    } finally {
      onPendingChange(false);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!target || !skillData || isSaving || isReviewing) return;
    setIsSaving(true);
    onPendingChange(true);
    setStatus(null);
    try {
      const result = await agentProfileService.updateAgentProfileSkill(
        workspaceSlug,
        userId,
        target.owner_id,
        target.skill_id,
        {
          content,
          expected_revision: skillData.revision,
        }
      );
      if (!result.success) throw new Error("Skill edit was not saved");
      if (result.staged && result.pending_id) {
        setTarget((current) =>
          current ? { ...current, expected_revision: result.expected_revision ?? current.expected_revision } : current
        );
        setPendingId(result.pending_id);
        setIsEditing(false);
        await mutatePending();
      } else {
        if (!result.revision || !target) throw new Error("Skill edit result was incomplete");
        await mutateProfile();
        const saved = await agentProfileService.getAgentProfileSkill(
          workspaceSlug,
          userId,
          target.owner_id,
          target.skill_id,
          result.revision
        );
        setTarget((current) => (current ? { ...current, expected_revision: saved.revision } : current));
        setContent(saved.content);
        setIsEditing(false);
        setStatus("saved");
      }
    } catch (error: unknown) {
      const errorStatus = getErrorStatus(error);
      if (errorStatus === 409) setStatus("conflict");
      else if (errorStatus === 403) setStatus("forbidden");
      else if (errorStatus === 422) setStatus("invalid");
      else setStatus("uncertain");
    } finally {
      setIsSaving(false);
      onPendingChange(false);
    }
  };

  const handleReviewAction = async (approve: boolean) => {
    if (!pendingId || !reviewData || !("pending" in reviewData) || isSaving || isReviewing) return;
    const pending = reviewData.pending;
    setIsReviewing(true);
    onPendingChange(true);
    setStatus(null);
    try {
      const result: TAgentProfileSkillEditResponse = approve
        ? await agentProfileService.approveAgentProfileSkill(workspaceSlug, userId, pending.id, {
            owner_id: pending.owner_id,
            skill_id: pending.skill_id,
            expected_revision: pending.expected_revision,
            content_revision: pending.content_revision,
          })
        : await agentProfileService.rejectAgentProfileSkill(workspaceSlug, userId, pending.id, {
            owner_id: pending.owner_id,
            skill_id: pending.skill_id,
            expected_revision: pending.expected_revision,
          });
      if (!result.success) throw new Error("Skill review action failed");
      await Promise.all([mutateProfile(), mutatePending()]);
      setPendingId(null);
      setTarget(null);
      setContent("");
      setIsEditing(false);
    } catch (error: unknown) {
      const errorStatus = getErrorStatus(error);
      if (errorStatus === 409) setStatus("conflict");
      else if (errorStatus === 403) setStatus("forbidden");
      else if (errorStatus === 422) setStatus("invalid");
      else setStatus("uncertain");
    } finally {
      setIsReviewing(false);
      onPendingChange(false);
    }
  };

  const review = reviewData && "pending" in reviewData ? reviewData : null;
  const isBusy = isSaving || isReviewing;

  return (
    <section aria-labelledby={`agent-profile-skills-heading-${identity}`}>
      <p id={`agent-profile-skills-heading-${identity}`} className="text-secondary">
        {t("workspace_settings.settings.members.agent_profile.skills")}
      </p>
      <p className="mt-1 text-primary">{t("workspace_settings.settings.members.agent_profile.skills_explanation")}</p>
      {data.items.length === 0 ? (
        <p className="mt-1 text-secondary">{t("workspace_settings.settings.members.agent_profile.skills_empty")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.items.map((skill) => (
            <li key={skillKey(skill)} className="rounded-md bg-layer-1 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-primary">{skill.name}</p>
                  {skill.description && <p className="mt-1 whitespace-pre-wrap text-secondary">{skill.description}</p>}
                  {skill.category && (
                    <p className="mt-1 text-12 text-secondary">
                      {t("workspace_settings.settings.members.agent_profile.skills_category")}: {skill.category}
                    </p>
                  )}
                </div>
                {skill.editable && (
                  <Button variant="secondary" size="lg" onClick={() => selectSkill(skill)} disabled={isBusy}>
                    {t("workspace_settings.settings.members.agent_profile.skill_inspect")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && (
        <p className="mt-2 text-secondary">{t("workspace_settings.settings.members.agent_profile.skills_truncated")}</p>
      )}

      {isAdmin && pendingError && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-layer-1 p-3 text-secondary" aria-live="polite">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <p>{t("workspace_settings.settings.members.agent_profile.skill_pending_error")}</p>
            <Button variant="secondary" size="lg" loading={isPendingLoading} onClick={() => mutatePending()}>
              {t("workspace_settings.settings.members.agent_profile.retry")}
            </Button>
          </div>
        </div>
      )}
      {isAdmin && !pendingError && pendingItems(pendingData).length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.skill_pending")}</p>
          {pendingItems(pendingData).map((item) => (
            <button
              key={item.id}
              type="button"
              className="focus:ring-focus block w-full rounded-md border border-subtle p-3 text-left text-primary hover:bg-layer-1 focus:ring-2 focus:outline-none"
              onClick={() => selectPending({ ...item, name: item.skill_id })}
              disabled={isBusy}
            >
              <span className="block font-medium">{item.summary}</span>
              <span className="mt-1 block text-12 text-secondary">{item.skill_id}</span>
            </button>
          ))}
        </div>
      )}

      {target && (
        <div className="mt-4 rounded-md border border-subtle p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium text-primary">{target.name}</p>
              <p className="mt-1 text-12 text-secondary">{target.skill_id}</p>
            </div>
            <Button variant="secondary" size="lg" onClick={() => setTarget(null)} disabled={isBusy}>
              {t("workspace_settings.settings.members.agent_profile.skill_close")}
            </Button>
          </div>
          {isSkillLoading ? (
            <p className="mt-3 text-secondary">
              {t("workspace_settings.settings.members.agent_profile.skill_loading")}
            </p>
          ) : skillError ? (
            <div className="mt-3 space-y-2">
              <p className="text-secondary">{t("workspace_settings.settings.members.agent_profile.skill_error")}</p>
              <Button variant="secondary" size="lg" onClick={handleReload}>
                {t("workspace_settings.settings.members.agent_profile.retry")}
              </Button>
            </div>
          ) : skillData ? (
            <>
              {isAdmin && isEditing ? (
                <form className="mt-3 space-y-3" onSubmit={handleSave}>
                  <textarea
                    className="focus:ring-focus font-mono min-h-56 w-full resize-y rounded-md border border-subtle bg-surface-1 px-3 py-2 text-12 text-primary outline-none focus:ring-2"
                    aria-label={t("workspace_settings.settings.members.agent_profile.skill_content")}
                    value={content}
                    onChange={(event) => {
                      setContent(event.target.value);
                      setStatus(null);
                    }}
                    disabled={isBusy}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="lg"
                      onClick={() => setIsEditing(false)}
                      disabled={isBusy}
                    >
                      {t("workspace_settings.settings.members.agent_profile.cancel")}
                    </Button>
                    <Button type="submit" size="lg" loading={isSaving} disabled={isReviewing}>
                      {t("workspace_settings.settings.members.agent_profile.save")}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <pre className="font-mono mt-3 max-h-80 overflow-auto rounded-md bg-surface-1 p-3 text-12 break-words whitespace-pre-wrap text-primary">
                    {skillData.content}
                  </pre>
                  {isAdmin && !pendingId && (
                    <Button
                      variant="secondary"
                      size="lg"
                      className="mt-3"
                      onClick={() => {
                        setContent(skillData.content);
                        setIsEditing(true);
                      }}
                      disabled={isBusy}
                    >
                      {t("workspace_settings.settings.members.agent_profile.skill_edit")}
                    </Button>
                  )}
                </>
              )}
            </>
          ) : null}

          {pendingId && (
            <div className="mt-4 border-t border-subtle pt-3">
              <p className="font-medium text-primary">
                {t("workspace_settings.settings.members.agent_profile.skill_review")}
              </p>
              {isReviewLoading ? (
                <p className="mt-2 text-secondary">
                  {t("workspace_settings.settings.members.agent_profile.skill_loading")}
                </p>
              ) : reviewError ? (
                <p className="mt-2 text-secondary">
                  {t("workspace_settings.settings.members.agent_profile.skill_review_error")}
                </p>
              ) : review ? (
                <>
                  <pre className="font-mono mt-2 max-h-80 overflow-auto rounded-md bg-surface-1 p-3 text-12 break-words whitespace-pre-wrap text-primary">
                    {review.review.diff}
                  </pre>
                  {review.review.truncated && (
                    <p className="mt-2 text-secondary">
                      {t("workspace_settings.settings.members.agent_profile.skill_review_truncated")}
                    </p>
                  )}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="secondary" size="lg" onClick={() => handleReviewAction(false)} disabled={isBusy}>
                      {t("workspace_settings.settings.members.agent_profile.skill_reject")}
                    </Button>
                    <Button
                      size="lg"
                      loading={isReviewing}
                      onClick={() => handleReviewAction(true)}
                      disabled={isSaving || review.review.truncated}
                    >
                      {t("workspace_settings.settings.members.agent_profile.skill_approve")}
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}

      {status && (
        <div className="mt-4 flex items-start gap-2 rounded-md bg-layer-1 p-3 text-secondary" aria-live="polite">
          <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            {status === "saved"
              ? t("workspace_settings.settings.members.agent_profile.skill_saved")
              : status === "conflict"
                ? t("workspace_settings.settings.members.agent_profile.skill_conflict")
                : status === "forbidden"
                  ? t("workspace_settings.settings.members.agent_profile.skill_forbidden")
                  : status === "invalid"
                    ? t("workspace_settings.settings.members.agent_profile.skill_invalid")
                    : status === "refresh-error"
                      ? t("workspace_settings.settings.members.agent_profile.skill_refresh_error")
                      : t("workspace_settings.settings.members.agent_profile.skill_uncertain")}
          </p>
          {(status === "conflict" || status === "uncertain" || status === "refresh-error") && (
            <Button variant="secondary" size="lg" onClick={handleReload}>
              {t("workspace_settings.settings.members.agent_profile.skill_load_saved_version")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
