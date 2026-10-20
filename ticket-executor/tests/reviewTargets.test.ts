import test from "node:test";
import assert from "node:assert/strict";

import { automatedFindingCount } from "../lib/reviewFindings";
import {
  localRepoForPr,
  pickReviewPr,
  prNumberFromUrl,
  repoNameFromPrUrl,
  reviewTargets,
} from "../lib/execution/reviewTargets";

const RIS = "https://dev.azure.com/Org/RIS/_git/RIS/pullrequest/11244";
const RS = "https://dev.azure.com/Org/Reporting%20Service/_git/Reporting%20Service/pullrequest/11245";

test("an automated review with tagged findings counts each finding once, ignoring the repeated full review", () => {
  const text =
    "> 🤖 **Automated review — approved with 2 findings allowed by this repository's rule.**\n\n" +
    "- **[Minor]** first\n- **[Minor]** second\n\n<details><summary>Full review</summary>\n\n" +
    "**[Minor]** `a.cs:1`\n\n**[Minor]** `b.cs:2`\n\n</details>";
  assert.equal(automatedFindingCount(text), 2);
});

test("findings that only appear inside the details block are still counted", () => {
  const text = "Automated review — posted by Mergeon Auto Reviews.\n\n<details>\n**[Major]** x\n**[Nit]** y\n</details>";
  assert.equal(automatedFindingCount(text), 2);
});

test("the started notice, a walkthrough and a human comment carry no findings", () => {
  assert.equal(automatedFindingCount("> 🤖 **Automated review started** — triggered by Slack"), 0);
  assert.equal(automatedFindingCount("<!-- walkthrough_start --> 📝 Walkthrough"), 0);
  assert.equal(automatedFindingCount("please rename [Minor] to something"), 0);
});

test("pull request urls give their number and repository name", () => {
  assert.equal(prNumberFromUrl(RS), "11245");
  assert.equal(repoNameFromPrUrl(RS), "Reporting Service");
  assert.equal(repoNameFromPrUrl("https://github.com/acme/widgets/pull/7"), "widgets");
  assert.equal(prNumberFromUrl("https://github.com/acme/widgets/pull/7"), "7");
});

test("review targets list the primary first and drop blanks and duplicates", () => {
  assert.deepEqual(reviewTargets({ prUrl: RIS, companionPrUrls: [RS, RIS, ""] }), [RIS, RS]);
  assert.deepEqual(reviewTargets({ prUrl: RIS, companionPrUrls: [] }), [RIS]);
});

test("a companion pull request maps to the clone whose folder name matches its repository", () => {
  const companions = [{ name: "ReportingService", path: "C:/src/ReportingService" }];
  assert.equal(localRepoForPr(RS, "C:/src/RIS", companions), "C:/src/ReportingService");
  assert.equal(localRepoForPr(RIS, "C:/src/RIS", companions), "C:/src/RIS");
  assert.equal(localRepoForPr("https://dev.azure.com/Org/P/_git/Other/pullrequest/1", "C:/src/RIS", companions), "");
});

test("the pull request to fix is the primary while it has open threads, then the first companion with some", () => {
  const tracked = [{ prUrl: RS, openComments: 1 }];
  assert.equal(pickReviewPr({ prUrl: RIS, openComments: 3 }, tracked), RIS);
  assert.equal(pickReviewPr({ prUrl: RIS, openComments: 1 }, tracked), RS);
  assert.equal(pickReviewPr({ prUrl: RIS, openComments: 0 }, []), RIS);
});
