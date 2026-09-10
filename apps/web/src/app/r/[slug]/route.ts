import { NextResponse } from "next/server";
import { getPublishingRepository } from "@/server/database";

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const repository = getPublishingRepository();
  const link = await repository.getTrackedLink((await context.params).slug);
  if (!link || link.status !== "active" || (link.expiresAt && Date.parse(link.expiresAt) <= Date.now())) return new Response("Tracked link unavailable", { status: 404 });
  try { await repository.recordTrackedVisit(link); } catch { /* Measurement failure must not break a valid destination redirect. */ }
  const destination = new URL(link.canonicalUrl);
  for (const [key, value] of Object.entries(link.utmParameters)) if (/^utm_[a-z_]+$/.test(key)) destination.searchParams.set(key, value);
  return NextResponse.redirect(destination, { status: 302 });
}
