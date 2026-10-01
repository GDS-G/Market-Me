import { z } from "zod";
import { presetSettingsSchema, presetVersionSchema } from "./preparation-preset-contract";
import type { SourcePreparationBindingScope, SourcePreparationBindingValues } from "./source-preparation-binding-request";

const uuid = z.uuid();
const revision = z.number().int().min(1).max(2_147_483_647);
export const sourcePresetChoiceSchema = z.strictObject({
  id: uuid,
  revision,
  versionNumber: revision,
  title: z.string().min(1).max(120),
  archived: z.boolean(),
});
export const sourcePresetChoicesSchema = z.strictObject({
  workspaceId: uuid,
  page: z.number().int().min(1).max(2_000),
  more: z.boolean(),
  items: z.array(sourcePresetChoiceSchema).max(50)
    .refine(items => new Set(items.map(item => item.id)).size === items.length, "Duplicate preset choices."),
});
export type SourcePresetChoice = z.infer<typeof sourcePresetChoiceSchema>;
export type SourcePresetChoices = z.infer<typeof sourcePresetChoicesSchema>;

/** Selection consent is specific to this editor and this exact observed version. */
export function sourcePresetSelectionKey(scope: SourcePreparationBindingScope, selected: SourcePresetChoice): string {
  return JSON.stringify({ workspaceId: uuid.parse(scope.workspaceId), smartSourceId: uuid.parse(scope.smartSourceId),
    selected: sourcePresetChoiceSchema.parse(selected) });
}

export function parseSourcePresetChoices(value: unknown, workspaceId: string, page: number): SourcePresetChoices {
  const parsed = sourcePresetChoicesSchema.parse(value);
  if (parsed.workspaceId !== workspaceId || parsed.page !== page) throw new Error("Preset choices belong to another request.");
  return parsed;
}

/** No enabled flag, source identity or binding revision can come from a preset. */
export function copySourcePresetValues(current: SourcePreparationBindingValues, configuration: unknown): SourcePreparationBindingValues {
  const settings = presetSettingsSchema.parse(configuration);
  return {
    workspaceId: uuid.parse(current.workspaceId),
    ...(current.expectedRevision === undefined ? {} : { expectedRevision: revision.parse(current.expectedRevision) }),
    enabled: z.boolean().parse(current.enabled),
    ...settings,
  };
}

export function parseSourcePresetVersion(value: unknown, workspaceId: string, selected: SourcePresetChoice) {
  const saved = presetVersionSchema.parse(value);
  if (selected.archived || saved.workspaceId !== workspaceId || saved.presetId !== selected.id
    || saved.versionNumber !== selected.versionNumber) throw new Error("Preset copy does not match the selected saved version.");
  return saved;
}
