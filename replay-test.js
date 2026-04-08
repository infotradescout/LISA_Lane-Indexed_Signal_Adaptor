import fs from "node:fs";
import path from "node:path";
import { deriveSignalFromSseMessage, shouldAlert } from "./interpreter.js";

const FIXTURE_PATH =
  process.argv[2] || path.join(process.cwd(), "fixtures", "replay-events.json");

function loadFixtures(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      "Fixture file not found at " +
        filePath +
        ". Create it from fixtures/replay-events.sample.json first."
    );
  }

  const content = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error("Fixture file must be an array.");
  }
  return parsed;
}

function normalizeInput(input) {
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

function percent(num, den) {
  if (!den) return 0;
  return (num / den) * 100;
}

function runReplay(fixtures) {
  let laneExpected = 0;
  let laneCorrect = 0;
  let expectedNoAlert = 0;
  let falsePositives = 0;
  let unclassifiedCount = 0;
  let ambiguousCount = 0;

  const failures = [];

  for (const item of fixtures) {
    const signal = deriveSignalFromSseMessage(normalizeInput(item.input));
    const expected = item.expected || {};

    if (expected.lane) {
      laneExpected += 1;
      if (signal.lane === expected.lane) laneCorrect += 1;
      else failures.push(`${item.id || "(no-id)"} lane expected=${expected.lane} got=${signal.lane}`);
    }

    if (typeof expected.min_confidence === "number" && signal.confidence < expected.min_confidence) {
      failures.push(
        `${item.id || "(no-id)"} confidence expected>=${expected.min_confidence} got=${signal.confidence}`
      );
    }

    if (typeof expected.entity === "string" && signal.entity !== expected.entity) {
      failures.push(
        `${item.id || "(no-id)"} entity expected=${expected.entity} got=${signal.entity}`
      );
    }

    if (typeof expected.change === "string" && signal.change !== expected.change) {
      failures.push(
        `${item.id || "(no-id)"} change expected=${expected.change} got=${signal.change}`
      );
    }

    if (typeof expected.should_alert === "boolean") {
      const predictedAlert = shouldAlert(signal);
      if (!expected.should_alert) {
        expectedNoAlert += 1;
        if (predictedAlert) falsePositives += 1;
      }
      if (expected.should_alert !== predictedAlert) {
        failures.push(
          `${item.id || "(no-id)"} should_alert expected=${expected.should_alert} got=${predictedAlert}`
        );
      }
    }

    if (signal.lane === "unclassified") unclassifiedCount += 1;
    if (signal.ambiguous) ambiguousCount += 1;
  }

  return {
    total: fixtures.length,
    lane_accuracy: percent(laneCorrect, laneExpected),
    false_positive_rate: percent(falsePositives, expectedNoAlert),
    unclassified_rate: percent(unclassifiedCount, fixtures.length),
    ambiguity_rate: percent(ambiguousCount, fixtures.length),
    lane_expected_count: laneExpected,
    lane_correct_count: laneCorrect,
    expected_no_alert_count: expectedNoAlert,
    false_positive_count: falsePositives,
    failures,
  };
}

function main() {
  const fixtures = loadFixtures(FIXTURE_PATH);
  const report = runReplay(fixtures);

  console.log("[replay] file:", FIXTURE_PATH);
  console.log("[replay] total fixtures:", report.total);
  console.log("[replay] lane_accuracy:", report.lane_accuracy.toFixed(2) + "%");
  console.log("[replay] false_positive_rate:", report.false_positive_rate.toFixed(2) + "%");
  console.log("[replay] unclassified_rate:", report.unclassified_rate.toFixed(2) + "%");
  console.log("[replay] ambiguity_rate:", report.ambiguity_rate.toFixed(2) + "%");

  if (report.failures.length) {
    console.log("[replay] failures:");
    for (const f of report.failures) console.log("  -", f);
    process.exitCode = 1;
  } else {
    console.log("[replay] all checks passed");
  }
}

main();
