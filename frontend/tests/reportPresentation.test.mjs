import { test } from "node:test";
import assert from "node:assert/strict";
import { elapsedTime, prepareFindings, selectFindings } from "../src/reportPresentation.js";

test("sorting uses precise percentages and leaves the full export data intact", () => {
  const errors = [
    { testName: "Группа — Тест 1", questionId: "q_test_1", val: "64%", failRate: 64.3, text: "original A" },
    { testName: "Группа — Тест 1", questionId: "q_test_2", val: "64%", failRate: 64.4, text: "original B" },
    { testName: "Группа — Тест 2", questionId: "q_test_1", val: "64%", failRate: 64.3, text: "original C" },
  ];
  const before = JSON.stringify(errors);
  const rows = prepareFindings(errors);
  const descending = selectFindings(rows).items;
  assert.deepEqual(descending.map(row => row.index), [1, 0, 2]);
  assert.deepEqual(selectFindings(rows, { sort: "source" }).items.map(row => row.index), [0, 1, 2]);
  assert.equal(JSON.stringify(errors), before);
  assert.deepEqual(rows.map(row => row.index), [0, 1, 2]);
  assert.equal(new Set(rows.map(row => row.key)).size, 3);
});

test("all 242 questions remain reachable; filters precede pagination and pages clamp", () => {
  const rows = prepareFindings(Array.from({ length: 242 }, (_, i) => ({
    testName: i < 42 ? "Первый тест" : "Итоговый тест",
    questionId: `q_test_${i + 1}`,
    val: "50%",
  })));
  const visited = new Set();
  for (let page = 1; page <= 25; page++) {
    const result = selectFindings(rows, { page });
    result.items.forEach(row => visited.add(row.key));
    assert.equal(result.pageCount, 25);
  }
  assert.equal(visited.size, 242);
  const filtered = selectFindings(rows, { testName: "Первый тест", page: 25 });
  assert.equal(filtered.page, 5);
  assert.equal(filtered.from, 41);
  assert.equal(filtered.to, 42);
  assert.equal(filtered.items.length, 2);
  assert.equal(selectFindings(rows, { pageSize: 50 }).pageCount, 5);
  const none = selectFindings(rows, { query: "Несуществующий", page: 25 });
  assert.deepEqual([none.page, none.from, none.to, none.total], [1, 0, 0, 0]);
});

test("legacy reports stay searchable and unknown rates never outrank numeric rates", () => {
  const rows = prepareFindings([
    { question: "Группа: Вопрос q_2", val: "64,3%", text: "Проверить формулировку" },
    { question: "Вопрос без кода", val: "—", text: "Нужен просмотр" },
  ]);
  assert.equal(rows[0].title, "Вопрос 2");
  assert.equal(rows[0].rate, 64.3);
  assert.equal(selectFindings(rows, { query: "ПРОВЕРИТЬ" }).total, 1);
  assert.equal(selectFindings(rows, { sort: "rate-asc" }).items[0].index, 0);
  assert.equal(rows[1].title, "Вопрос без кода");
});

test("readable descriptions preserve counts and keep the original available", () => {
  const original = "Ошиблись 9 из 14 студентов (64.3%).";
  const [row] = prepareFindings([{ errorDescription: original, text: original, testName: "Файл — Тест 1 — блок 2", questionId: "q_1" }]);
  assert.equal(row.description, "Учтено как ошибки: 9 из 14 записей (64,3%).");
  assert.equal(row.text, original);
  assert.equal(row.testLabel, "Тест 1 — блок 2");
  assert.equal(row.source, "Файл");
});

test("timer resumes from the server timestamp across page loads and supports long jobs", () => {
  const submitted = "2026-09-23T10:00:00Z";
  assert.equal(elapsedTime(submitted, Date.parse("2026-09-23T10:15:09Z")), "15:09");
  assert.equal(elapsedTime(submitted, Date.parse("2026-09-23T11:02:03Z")), "01:02:03");
  assert.equal(elapsedTime(submitted, Date.parse("2026-09-23T09:59:59Z")), "00:00");
  assert.equal(elapsedTime(undefined), "—");
});
