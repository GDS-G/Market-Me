import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftPackageApproval } from "./draft-package-approval";
import { reviewTestScope, reviewTestUuid } from "./content-package-review.test-fixture";
describe("draft original source approval", () => {
  it("links the generation pin without substituting current package approval", () => {
    const html = renderToStaticMarkup(createElement(DraftPackageApproval, { ...reviewTestScope, approvalId: reviewTestUuid(9) }));
    expect(html).toContain(`/content-packages/${reviewTestScope.packageId}/approvals/${reviewTestUuid(9)}?workspaceId=${reviewTestScope.workspaceId}`);
    expect(html).toContain("current package changes do not replace it");
  });
  it.each([undefined, null, "bad"])("keeps legacy or invalid proof %s visibly unavailable", (approvalId) => {
    const html = renderToStaticMarkup(createElement(DraftPackageApproval, { ...reviewTestScope, approvalId }));
    expect(html).toContain("Historical source-review approval unavailable"); expect(html).not.toContain("href=");
  });
});
