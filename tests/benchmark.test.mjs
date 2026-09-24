import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { detectSensitiveText, redactText } from "../src/detectors.js";

const fixtureUrl = new URL("./fixtures/synthetic-pii.json", import.meta.url);
const cases = JSON.parse(await readFile(fixtureUrl, "utf8"));

test("synthetic PII benchmark has perfect label precision and recall", () => {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;

  for (const sample of cases) {
    const actual = detectSensitiveText(sample.text).map((item) => item.label);
    assert.deepEqual(actual, sample.expected, sample.id);
    truePositive += actual.filter((label) => sample.expected.includes(label)).length;
    falsePositive += actual.filter((label) => !sample.expected.includes(label)).length;
    falseNegative += sample.expected.filter((label) => !actual.includes(label)).length;
  }

  const precision = truePositive / (truePositive + falsePositive);
  const recall = truePositive / (truePositive + falseNegative);
  assert.equal(precision, 1);
  assert.equal(recall, 1);
});

test("every detected fixture value is removed from redacted output", () => {
  for (const sample of cases) {
    const findings = detectSensitiveText(sample.text);
    const safe = redactText(sample.text, findings);
    for (const finding of findings) {
      assert.equal(safe.includes(finding.value), false, `${sample.id}: ${finding.label}`);
    }
  }
});
