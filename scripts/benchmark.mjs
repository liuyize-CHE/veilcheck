import { readFile } from "node:fs/promises";
import { detectSensitiveText } from "../src/detectors.js";

const fixtureUrl = new URL("../tests/fixtures/synthetic-pii.json", import.meta.url);
const samples = JSON.parse(await readFile(fixtureUrl, "utf8"));
const labels = ["PHONE", "EMAIL", "CN_ID", "CARD", "IP", "JWT", "SECRET", "NAME", "STUDENT_ID", "ACCOUNT_ID", "ADDRESS", "ACADEMIC"];
const metrics = Object.fromEntries(labels.map((label) => [label, { tp: 0, fp: 0, fn: 0 }]));

for (const sample of samples) {
  const expected = [...sample.expected];
  const actual = detectSensitiveText(sample.text).map((item) => item.label);
  for (const label of labels) {
    const expectedCount = expected.filter((item) => item === label).length;
    const actualCount = actual.filter((item) => item === label).length;
    metrics[label].tp += Math.min(expectedCount, actualCount);
    metrics[label].fp += Math.max(0, actualCount - expectedCount);
    metrics[label].fn += Math.max(0, expectedCount - actualCount);
  }
}

const rows = labels.map((label) => {
  const { tp, fp, fn } = metrics[label];
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const recall = tp + fn ? tp / (tp + fn) : 1;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return { label, samples: tp + fn, precision: precision.toFixed(3), recall: recall.toFixed(3), f1: f1.toFixed(3) };
});

console.log(`VeilCheck synthetic benchmark · ${samples.length} cases`);
console.table(rows);
