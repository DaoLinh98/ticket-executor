import test from "node:test";
import assert from "node:assert/strict";

import { SLACK_SEND_TOOLS, readSendOutcome, slackHookSettings, slackMessage, slackSendPrompt } from "../lib/slack";

const CH = "C0TEST";
const toolUse = (channel_id: string) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: SLACK_SEND_TOOLS[0], input: { channel_id, message: "x" } }] } });
const toolResult = (is_error: boolean, content: string) =>
  JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", is_error, content }] } });
const result = (is_error: boolean, text = "") => JSON.stringify({ type: "result", is_error, result: text });

test("readSendOutcome: a successful call to the configured channel", () => {
  const o = readSendOutcome([toolUse(CH), toolResult(false, "ok"), result(false)]);
  assert.deepEqual(o, { called: true, toolError: "", resultError: "" });
});

test("slackMessage wraps the whole report in one code block", () => {
  assert.equal(slackMessage("a\n - b"), "```\na\n - b\n```");
});

test("readSendOutcome: a tool error is reported", () => {
  assert.equal(readSendOutcome([toolUse(CH), toolResult(true, "not_in_channel"), result(false)]).toolError, "not_in_channel");
});

test("readSendOutcome: no tool call and a failed turn", () => {
  const o = readSendOutcome(["not json", result(true, "limit reached")]);
  assert.equal(o.called, false);
  assert.equal(o.resultError, "limit reached");
});

test("slackSendPrompt carries the channel and the text verbatim", () => {
  const p = slackSendPrompt(CH, "Report 24/09/2026 of Linh\n 1. Today");
  assert.ok(p.includes(`"${CH}"`));
  assert.ok(p.includes("<message>\nReport 24/09/2026 of Linh\n 1. Today\n</message>"));
});

test("slackHookSettings rewrites every slack_send_message call through the hook", () => {
  const cfg = JSON.parse(slackHookSettings("C:\\t\\hook.mjs", "C:\\t\\payload.json"));
  const entry = cfg.hooks.PreToolUse[0];
  assert.ok(new RegExp(entry.matcher).test(SLACK_SEND_TOOLS[1]));
  assert.ok(entry.hooks[0].command.endsWith('"C:/t/hook.mjs" "C:/t/payload.json"'));
});
