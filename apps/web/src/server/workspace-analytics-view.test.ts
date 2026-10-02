import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENT_SECTIONS, analyticsCount, analyticsDecimal, analyticsEventSection, analyticsLabel, workspaceAnalyticsPath, workspaceAnalyticsQuery } from "./workspace-analytics-view";
const workspaceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", campaignId = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
describe("Analytics display and scope helpers", () => {
  it("only accepts an optional Campaign and a matching current-workspace hint", () => {
    expect(workspaceAnalyticsQuery({}, workspaceId)).toBeUndefined();
    expect(workspaceAnalyticsQuery({ campaignId, workspaceId: workspaceId.toLowerCase() }, workspaceId)).toBe(campaignId.toLowerCase());
    expect(workspaceAnalyticsPath(workspaceId, campaignId)).toBe(`/analytics?workspaceId=${workspaceId.toLowerCase()}&campaignId=${campaignId.toLowerCase()}`);
    expect(workspaceAnalyticsPath(workspaceId)).toBe(`/analytics?workspaceId=${workspaceId.toLowerCase()}`);
  });
  it.each([{ campaignId: "" }, { campaignId: [campaignId, campaignId] }, { workspaceId: [workspaceId] }, { workspaceId: campaignId }, { period: "30d" }, { actor: "owner" }, { campaignId: "../../other" }])("rejects unsupported filters %j", query => {
    expect(() => workspaceAnalyticsQuery(query, workspaceId)).toThrow();
  });
  it.each([
    ["199999999999999.999997", "199,999,999,999,999.999997"], ["-0.000001", "-0.000001"], ["-1234567.123456", "-1,234,567.123456"], ["0.000000", "0.000000"], ["0", "0"], ["18014398509481982", "18,014,398,509,481,982"], ["2.500000", "2.500000"],
  ])("renders exact %s without numeric coercion", (input, expected) => { expect(analyticsDecimal(input)).toBe(expected); });
  it.each(["", "NaN", "Infinity", "1e9", "01", "0.1234567", " 1", "1,000", "1.", "+1", "9".repeat(129)])("rejects malformed numeric text %s", value => {
    expect(() => analyticsDecimal(value)).toThrow();
  });
  it("keeps counts integral/nonnegative while allowing signed measured values", () => {
    expect(analyticsCount("9007199254740993")).toBe("9,007,199,254,740,993");
    for (const value of ["-1", "0.1", "1.000000", "NaN"]) expect(() => analyticsCount(value)).toThrow();
  });
  it("separates outcomes, engagement, feedback and unknown/custom events", () => {
    expect(ANALYTICS_EVENT_SECTIONS.map(s => s.key)).toEqual(["outcome", "engagement", "feedback", "custom"]);
    for (const key of ["purchase", "lead", "revenue", "registration", "donation"]) expect(analyticsEventSection(key)).toBe("outcome");
    for (const key of ["view", "reach", "destination_visit", "outbound_click"]) expect(analyticsEventSection(key)).toBe("engagement");
    for (const key of ["unsubscribe", "complaint"]) expect(analyticsEventSection(key)).toBe("feedback");
    for (const key of ["custom", "unknown", "toString"]) expect(analyticsEventSection(key)).toBe("custom");
    expect(analyticsLabel("completed")).toBe("Marked completed"); expect(analyticsLabel("succeeded")).toBe("Recorded success");
    expect(analyticsLabel("email_unique_click")).toBe("Unique clicks per email campaign"); expect(analyticsLabel("toString")).toBe("toString");
  });
});
