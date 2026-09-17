/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { Schema } from "effect";

export const PdfExportRequestBody = Schema.Struct({
  pageId: Schema.Trimmed.check(Schema.isNonEmpty()),
  workspaceSlug: Schema.Trimmed.check(Schema.isNonEmpty()),
  projectId: Schema.optional(Schema.Trimmed.check(Schema.isNonEmpty())),
  title: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  subject: Schema.optional(Schema.String),
  pageSize: Schema.optional(Schema.Literals(["A4", "A3", "A2", "LETTER", "LEGAL", "TABLOID"])),
  pageOrientation: Schema.optional(Schema.Literals(["portrait", "landscape"])),
  fileName: Schema.optional(Schema.String),
  noAssets: Schema.optional(Schema.Boolean),
});

export type TPdfExportRequestBody = Schema.Schema.Type<typeof PdfExportRequestBody>;

export class PdfValidationError extends Schema.TaggedError<PdfValidationError>()("PdfValidationError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PdfAuthenticationError extends Schema.TaggedError<PdfAuthenticationError>()("PdfAuthenticationError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
}) {}

export class PdfContentFetchError extends Schema.TaggedError<PdfContentFetchError>()("PdfContentFetchError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PdfMetadataFetchError extends Schema.TaggedError<PdfMetadataFetchError>()("PdfMetadataFetchError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
  source: Schema.Literal("user-mentions"),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PdfImageProcessingError extends Schema.TaggedError<PdfImageProcessingError>()("PdfImageProcessingError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
  assetId: Schema.Trimmed.check(Schema.isNonEmpty()),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PdfGenerationError extends Schema.TaggedError<PdfGenerationError>()("PdfGenerationError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
  cause: Schema.optional(Schema.Unknown),
}) {}

export class PdfTimeoutError extends Schema.TaggedError<PdfTimeoutError>()("PdfTimeoutError", {
  message: Schema.Trimmed.check(Schema.isNonEmpty()),
  operation: Schema.Trimmed.check(Schema.isNonEmpty()),
}) {}

export type PdfExportError =
  | PdfValidationError
  | PdfAuthenticationError
  | PdfContentFetchError
  | PdfMetadataFetchError
  | PdfImageProcessingError
  | PdfGenerationError
  | PdfTimeoutError;
