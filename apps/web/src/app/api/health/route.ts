import packageMetadata from "../../../../package.json";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    service: "market-me-web",
    status: "ok",
    version: packageMetadata.version,
    checkedAt: new Date().toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
