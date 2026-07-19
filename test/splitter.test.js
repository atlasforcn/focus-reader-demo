import test from "node:test";
import assert from "node:assert/strict";
import { splitIntoSentences } from "../src/splitter.js";

test("splits Traditional Chinese sentences and keeps punctuation", () => {
  assert.deepEqual(splitIntoSentences("你好嗎？我很好！一起閱讀。"), ["你好嗎？", "我很好！", "一起閱讀。"]);
});

test("keeps closing quotation marks with the sentence", () => {
  assert.deepEqual(splitIntoSentences("他說：「慢慢來。」接著坐下。"), ["他說：「慢慢來。」", "接著坐下。"]);
});

test("uses line breaks as boundaries and removes blank lines", () => {
  assert.deepEqual(splitIntoSentences("第一行沒有句號\n\n第二行。"), ["第一行沒有句號", "第二行。"]);
});

test("does not split decimal numbers", () => {
  assert.deepEqual(splitIntoSentences("版本是 2.5。下一句。"), ["版本是 2.5。", "下一句。"]);
});

test("returns an empty list for whitespace", () => {
  assert.deepEqual(splitIntoSentences("  \n "), []);
});
