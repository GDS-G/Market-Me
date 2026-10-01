import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseScopedSourceSample, readSourceSampleResponse, SOURCE_SAMPLE_RESPONSE_LIMIT, sourceSampleRequestSchema } from "./source-sample-contract";
import { SourceSamplePanel, SourceSampleResult } from "./source-sample-panel";
import { sampleView, sampleRequest } from "./source-sample.test-fixture";

const scope = { workspaceId: sampleRequest.workspaceId, smartSourceId: sampleRequest.smartSourceId, sourceVersion: sampleRequest.expectedSourceVersion, locationIndex: 0 };
describe("source dry-test response and rendering", () => {
  it("accepts only a minimized result for the exact saved source/location/version", () => {
    expect(parseScopedSourceSample(sampleView, scope)).toEqual(sampleView);
    for (const patch of [{ workspaceId: sampleRequest.smartSourceId }, { smartSourceId: sampleRequest.workspaceId }, { sourceVersion: 4 }, { locationIndex: 1 }]) {
      expect(() => parseScopedSourceSample(sampleView, { ...scope, ...patch })).toThrow();
    }
    for (const patch of [{ fingerprint: "authority" }, { token: "secret" }, { source: { ...sampleView.source, version: 4 } }]) expect(() => parseScopedSourceSample({ ...sampleView, ...patch }, scope)).toThrow();
  });
  it("rejects inconsistent item counts, relationships and claimed costs", () => {
    const samples = [
      { ...sampleView.simulation, aiRequests: 1 }, { ...sampleView.simulation, futureProcessingCost: 0 },
      { ...sampleView.simulation, partial: false }, { ...sampleView.simulation, counts: { ...sampleView.simulation.counts, inspected: 5 } },
      { ...sampleView.simulation, items: sampleView.simulation.items.map((item) => ({ ...item, relatedItemIndexes: [199] })) },
      { ...sampleView.simulation, items: sampleView.simulation.items.map((item) => ({ ...item, relatedItemIndexes: [0, 0] })) },
    ];
    for (const simulation of samples) expect(() => parseScopedSourceSample({ ...sampleView, simulation }, scope)).toThrow();
  });
  it("rejects transport authority and ambiguous request scope", () => {
    const request = { workspaceId: scope.workspaceId, expectedSourceVersion: 3, locationIndex: 0 };
    expect(sourceSampleRequestSchema.safeParse(request).success).toBe(true);
    for (const patch of [{ actorUserId: scope.smartSourceId }, { locationIndex: 20 }, { expectedSourceVersion: 0 }, { providerLocationId: "https://outside.invalid" }]) {
      expect(sourceSampleRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false);
    }
  });
  it("bounds response bytes with or without declared length, and rejects malformed JSON", async () => {
    expect(await readSourceSampleResponse(Response.json({ data: sampleView }))).toEqual({ data: sampleView });
    await expect(readSourceSampleResponse(new Response("{}", { headers: { "content-length": String(SOURCE_SAMPLE_RESPONSE_LIMIT + 1) } }))).rejects.toThrow();
    await expect(readSourceSampleResponse(new Response("x".repeat(SOURCE_SAMPLE_RESPONSE_LIMIT + 1)))).rejects.toThrow();
    await expect(readSourceSampleResponse(new Response("not-json"))).rejects.toThrow();
  });
  it("explains historical coverage, per-root packages, context conflict and nonactivation", () => {
    const html = renderToStaticMarkup(createElement(SourceSampleResult, { sample: sampleView }));
    for (const text of ["source remains paused", "Historical index only", "launch.txt", "Ignored", "Candidate for analysis", "launch_date", "Sources disagree", "Future processing cost: not estimated", "do not merge", "No package was created"]) expect(html).toContain(text);
    expect(html).not.toContain(sampleRequest.smartSourceId);
  });
  it("renders partial-cloud and enabled-preparation limits without promising execution", () => {
    const html = renderToStaticMarkup(createElement(SourceSampleResult, { sample: { ...sampleView, preparation: { enabled: true, revision: 2 },
      coverage: { kind: "cloud_folder_page", partial: true, truncated: true } } }));
    expect(html).toContain("Partial folder sample"); expect(html).toContain("More entries exist"); expect(html).toContain("may queue draft-only preparation");
  });
  it("does not offer a dry-test write button to a viewer and distinguishes unsaved edits", () => {
    const html = renderToStaticMarkup(createElement(SourceSamplePanel, { ...scope, provider: "local", canWrite: false, locations: [{ displayPath: "Approved folder" }] }));
    expect(html).toContain("disabled"); expect(html).toContain("current owner"); expect(html).toContain("Unsaved edits above are not included");
  });
});
