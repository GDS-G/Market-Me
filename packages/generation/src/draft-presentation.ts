import type { DraftFormat } from "@market-me/domain";

/** Version of new copy presentation snapshots, independent of saved generation history. */
export const GROUNDED_COPY_VERSION = "grounded-copy-v2";
export const DRAFT_FORMAT_CHARACTER_LIMITS: Readonly<Record<DraftFormat, number | undefined>> = {
  channel_neutral: undefined,
  social_short: 280,
  social_standard: 1000,
  email: 4000,
  article_intro: 5000,
  community_reply: 2000,
  direct_message: 1000,
};

/** Preserve reviewed text/punctuation; append a sentence stop only when absent. */
export function renderGroundedFact(claim: string): string {
  const text = claim.trim();
  if (!text) throw new Error("An approved factual claim must contain text.");
  return /[.!?。！？؟…।]["'”’»\)\]]*$/u.test(text) ? text : `${text}.`;
}

/** Base-copy UTF-16 units, not a final provider/URL/hashtag/destination count. */
export function draftCopyCharacterCount(body: string, callToAction?: string): number {
  return [body.trim(), callToAction?.trim()].filter(Boolean).join("\n\n").length;
}

export function draftCopyPresentation(body: string, callToAction: string | undefined, format: DraftFormat) {
  const limit = DRAFT_FORMAT_CHARACTER_LIMITS[format];
  return {
    groundedCopyVersion: GROUNDED_COPY_VERSION,
    format,
    ...(limit === undefined ? {} : { characterLimit: limit }),
    characterCount: draftCopyCharacterCount(body, callToAction),
    characterCountUnit: "utf16_code_units" as const,
    characterCountScope: "body_and_cta" as const,
  };
}
