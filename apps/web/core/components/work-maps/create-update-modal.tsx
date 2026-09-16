/**
 * Copyright (c) 2026-present Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Input, InputGroup } from "@makeplane/propel/components/input";
import { useTranslation } from "@plane/i18n";
import { Button } from "@plane/propel/button";
import { GlobeIcon, LockIcon } from "@plane/propel/icons";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { TWorkMap } from "@plane/types";
import { EModalPosition, EModalWidth, ModalCore } from "@plane/ui";
import { AccessField } from "@/components/common/access-field";
import { useAppRouter } from "@/hooks/use-app-router";
import { useWorkMap } from "@/hooks/store/use-work-map";

const ACCESS_OPTIONS = [
  { key: 0, i18n_label: "common.access.public", icon: GlobeIcon },
  { key: 1, i18n_label: "common.access.private", icon: LockIcon },
];

type Props = {
  canChangeAccess?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onCompleted?: () => Promise<unknown>;
  projectId: string;
  workMap?: TWorkMap;
  workspaceSlug: string;
};

export function CreateUpdateWorkMapModal({
  canChangeAccess = true,
  isOpen,
  onClose,
  onCompleted,
  projectId,
  workMap,
  workspaceSlug,
}: Props) {
  const { t } = useTranslation();
  const router = useAppRouter();
  const store = useWorkMap();
  const [name, setName] = useState("");
  const [access, setAccess] = useState<TWorkMap["access"]>(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(workMap?.name ?? "");
    setAccess(workMap?.access ?? 0);
  }, [isOpen, workMap]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName.length > 255) return;
    setSubmitting(true);
    try {
      if (workMap) {
        await store.update(workspaceSlug, projectId, workMap.id, {
          name: nextName,
          ...(canChangeAccess ? { access } : {}),
        });
        await onCompleted?.();
        onClose();
      } else {
        const created = await store.create(workspaceSlug, projectId, { name: nextName, access });
        onClose();
        router.push(`/${workspaceSlug}/projects/${projectId}/work-maps/${created.id}`);
      }
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: `Work map could not be ${workMap ? "updated" : "created"}` });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalCore isOpen={isOpen} handleClose={onClose} position={EModalPosition.TOP} width={EModalWidth.XXL}>
      <form onSubmit={submit}>
        <div className="space-y-5 p-5">
          <h3 className="text-18 font-medium text-secondary">{workMap ? "Edit Work map" : "Create Work map"}</h3>
          <div className="space-y-1">
            <InputGroup size="2xl">
              <Input
                id="work-map-name"
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name"
                required
                size="2xl"
                type="text"
                value={name}
              />
            </InputGroup>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t-[0.5px] border-subtle px-5 py-4">
          {canChangeAccess ? (
            <div className="flex items-center gap-2">
              <AccessField
                accessSpecifiers={ACCESS_OPTIONS}
                onChange={(value) => setAccess(value === 1 ? 1 : 0)}
                value={access}
              />
              <span className="text-11 font-medium">{t(ACCESS_OPTIONS[access]?.i18n_label ?? "")}</span>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="lg" loading={submitting} disabled={!name.trim()}>
              {workMap ? "Save changes" : "Create Work map"}
            </Button>
          </div>
        </div>
      </form>
    </ModalCore>
  );
}
