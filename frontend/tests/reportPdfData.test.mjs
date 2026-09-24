import { test } from "node:test";
import assert from "node:assert/strict";
import { preparePdfData } from "../src/reportPdfData.js";

test("PDF preserves full attempts including empty attempts and groups only identical reference variants", () => {
  const report = { result: { pdf_data: { tests: [
    { name: "A", attempts: 3, answers: 2, correct: 1, wrong_blank: 1, questions: [{ id: "q_1", text: "Задание", references: ["A"], wrong_patterns: [], number: 1 }] },
    { name: "B", attempts: 4, answers: 4, correct: 2, wrong_blank: 0, questions: [{ id: "q_1", text: "Задание", references: ["Б"], wrong_patterns: [], number: 1 }] },
  ] }, test_summaries: ["A", "B"].map(test_name => ({ test_name, critical_mass_errors: [{ question_id: "q_1", fail_rate_percent: 50 }] })) } };
  const original = JSON.stringify(report);
  const data = preparePdfData(report);
  assert.equal(data.totals.attempts, 7);
  assert.equal(data.totals.answers, 6);
  assert.equal(data.totals.success, 50);
  assert.equal(data.cards.length, 2);
  assert.equal(JSON.stringify(report), original);
});

test("legacy partial output never produces invented per-test success rates", () => {
  const data = preparePdfData({ result: { global_course_summary: "Проанализировано попыток: 4; ответов: 12. Правильных ответов: 3 (25%).", student_detailed_analyses: [
    { test_name: "A", student_id: "x", question_id: "q_1", ai_score_percent: 75 },
  ] } });
  assert.equal(data.totals.answers, 12);
  assert.equal(data.totals.success, 25);
  assert.equal(data.tests[0].correct, null);
  assert.equal(data.tests[0].attempts, null);
});
