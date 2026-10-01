import { presetErrorMessage, presetPayloadData, readPresetResponse } from "./preparation-preset-contract";
import { isScopedSourcePreparationBinding, type SourcePreparationBindingScope, type SourcePreparationBindingView } from "./source-preparation-binding-request";

export type SourcePreparationSaveResult =
  | { kind: "saved"; binding: SourcePreparationBindingView }
  | { kind: "rejected" | "uncertain"; message: string };

/** Invalid/oversized success responses and server failures are not proof of rollback. */
export async function readSourcePreparationSaveResult(response: Response, scope: SourcePreparationBindingScope): Promise<SourcePreparationSaveResult> {
  try {
    const payload = await readPresetResponse(response);
    if (!response.ok) {
      return { kind: response.status >= 500 ? "uncertain" : "rejected",
        message: presetErrorMessage(payload, "The preparation binding save was not confirmed. Load current settings before retrying.") };
    }
    const binding = presetPayloadData(payload);
    if (isScopedSourcePreparationBinding(binding, scope)) return { kind: "saved", binding };
  } catch { /* Invalid transport or body must freeze writes until current state is loaded. */ }
  return { kind: "uncertain", message: "No valid saved binding was confirmed. Load the current source before continuing; an earlier save may have succeeded." };
}
