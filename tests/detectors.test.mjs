import test from "node:test";
import assert from "node:assert/strict";
import { detectOcrWords, detectSensitiveText, redactText } from "../src/detectors.js";

test("detects common Chinese personal information", () => {
  const source = "联系 13800138000，邮箱 alice@example.com，身份证 11010519491231002X";
  const findings = detectSensitiveText(source);
  assert.deepEqual(findings.map((item) => item.label), ["PHONE", "EMAIL", "CN_ID"]);
});

test("validates bank cards with Luhn", () => {
  const findings = detectSensitiveText("测试卡号 4111 1111 1111 1111，无效 4111 1111 1111 1112");
  assert.equal(findings.filter((item) => item.label === "CARD").length, 1);
});

test("replaces findings without leaking the original value", () => {
  const source = "发到 alice@example.com 或 13800138000";
  const safe = redactText(source, detectSensitiveText(source));
  assert.equal(safe, "发到 [EMAIL] 或 [PHONE]");
});

test("rejects invalid Chinese ID dates and checksums", () => {
  assert.equal(detectSensitiveText("110105199902310024").length, 0);
  assert.equal(detectSensitiveText("110105194912310021").length, 0);
});

test("detects sensitive values split into multiple OCR words", () => {
  const words = [
    { text: "138", bbox: { x0: 10, y0: 10, x1: 55, y1: 35 }, confidence: 91, line_num: 1 },
    { text: "0013", bbox: { x0: 58, y0: 10, x1: 112, y1: 35 }, confidence: 90, line_num: 1 },
    { text: "8000", bbox: { x0: 115, y0: 10, x1: 170, y1: 35 }, confidence: 92, line_num: 1 },
    { text: "demo", bbox: { x0: 10, y0: 50, x1: 65, y1: 75 }, confidence: 94, line_num: 2 },
    { text: "@", bbox: { x0: 67, y0: 50, x1: 80, y1: 75 }, confidence: 95, line_num: 2 },
    { text: "example.com", bbox: { x0: 82, y0: 50, x1: 210, y1: 75 }, confidence: 93, line_num: 2 }
  ];
  const regions = detectOcrWords(words);
  assert.deepEqual(regions.map((item) => item.label), ["PHONE", "EMAIL"]);
  assert.equal(regions[0].x0, 10);
  assert.equal(regions[0].x1, 170);
});

test("detects values associated with sensitive field labels", () => {
  const source = "姓名：张三 学号：2023123456 专业：计算机科学与技术";
  const findings = detectSensitiveText(source);
  assert.deepEqual(findings.map((item) => item.label), ["NAME", "STUDENT_ID", "ACADEMIC"]);
  assert.deepEqual(findings.map((item) => item.value), ["张三", "2023123456", "计算机科学与技术"]);
});

test("finds a student ID placed below its OCR field label", () => {
  const words = [
    { text: "学号", bbox: { x0: 10, y0: 10, x1: 60, y1: 34 }, confidence: 95, line_num: 1 },
    { text: "2023123456", bbox: { x0: 12, y0: 48, x1: 175, y1: 76 }, confidence: 93, line_num: 2 }
  ];
  const regions = detectOcrWords(words);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].label, "STUDENT_ID");
  assert.equal(regions[0].value, "2023123456");
  assert.equal(regions[0].y0, 48);
});

test("tolerates a common OCR substitution in the student ID label", () => {
  const words = [
    { text: "学", bbox: { x0: 10, y0: 10, x1: 32, y1: 34 }, confidence: 95, line_num: 1 },
    { text: "叶", bbox: { x0: 34, y0: 10, x1: 58, y1: 34 }, confidence: 80, line_num: 1 },
    { text: ":", bbox: { x0: 60, y0: 10, x1: 66, y1: 34 }, confidence: 92, line_num: 1 },
    { text: "2023123456", bbox: { x0: 90, y0: 10, x1: 245, y1: 34 }, confidence: 93, line_num: 1 }
  ];
  const regions = detectOcrWords(words);
  assert.equal(regions.some((item) => item.label === "STUDENT_ID" && item.value === "2023123456"), true);
});

test("supports user-provided sensitive field keywords", () => {
  const words = [
    { text: "导师", bbox: { x0: 10, y0: 10, x1: 55, y1: 35 }, confidence: 92, line_num: 1 },
    { text: "李老师", bbox: { x0: 80, y0: 10, x1: 145, y1: 35 }, confidence: 91, line_num: 1 }
  ];
  const regions = detectOcrWords(words, { customKeywords: ["导师"] });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].label, "CUSTOM");
  assert.equal(regions[0].value, "李老师");
});
