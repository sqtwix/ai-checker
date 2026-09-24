const list = value => Array.isArray(value) ? value : [];
const finite = value => typeof value === "number" && Number.isFinite(value);
export const pdfTestLabel = name => String(name || "Без названия теста").split(" — ").slice(-1)[0];
export const pdfNumber = value => finite(value) ? value.toLocaleString("ru-RU").replaceAll("\u00a0", " ") : "—";
export const pdfPercent = value => finite(value) ? `${value.toFixed(1).replace(".", ",")}%` : "—";

// All transformations are local to the export. Never mutate the saved report.
export function preparePdfData(report) {
  const result = report.result || {};
  const details = list(result.student_detailed_analyses);
  const rawTests = list(result.pdf_data?.tests);
  const summary = result.global_course_summary || report.title || "";
  const summaryAnswers = summary.match(/ответов:\s*(\d+)[.;]/i)?.[1];
  const summaryAttempts = summary.match(/попыток:\s*(\d+)/i)?.[1];
  const summaryCorrect = summary.match(/Правильных ответов:\s*(\d+)/i)?.[1];
  const completeDetails = details.length > 0 && details.every(d => [0, 100].includes(d.ai_score_percent))
    && (summaryAnswers === undefined || Number(summaryAnswers) === details.length);
  const names = [...new Set([...list(result.test_summaries).map(t => t.test_name), ...details.map(d => d.test_name)])];
  const tests = rawTests.length ? rawTests.map(test => ({ ...test, questions: list(test.questions).map(q => ({ ...q })) })) : names.map(name => {
    const rows = details.filter(d => d.test_name === name);
    const ids = [...new Set(rows.map(d => d.question_id))];
    return {
      name,
      attempts: rows.every(row => row.attempt_id) ? new Set(rows.map(row => JSON.stringify([row.student_id, row.attempt_id]))).size : null,
      answers: completeDetails ? rows.length : null,
      correct: completeDetails ? rows.filter(row => row.ai_score_percent === 100).length : null,
      questions: ids.map((id, index) => {
        const answers = rows.filter(row => row.question_id === id);
        const wrong = answers.filter(row => row.ai_score_percent === 0).length;
        return { id, number: Number(id.match(/_(\d+)$/)?.[1] || index + 1), text: "", references: [], wrong_patterns: [],
          answers: completeDetails ? answers.length : null, wrong: completeDetails ? wrong : null,
          fail_rate: completeDetails && answers.length ? wrong * 100 / answers.length : null };
      }),
    };
  });
  const errors = list(result.test_summaries).flatMap(test => list(test.critical_mass_errors).map(error => ({ ...error, test_name: test.test_name })));
  if (!errors.length && !result.test_summaries) {
    errors.push(...list(report.errors).map((error, index) => ({
      test_name: error.testName || report.course || "Тест", question_id: error.questionId || `q_${index + 1}`,
      question_text: error.question || "", fail_rate_percent: error.failRate ?? Number.parseFloat(error.val),
      error_pattern_description: error.errorDescription || error.text || "", methodological_reason: error.methodologicalReason || "",
    })));
  }
  const grouped = new Map();
  errors.forEach(error => {
    const question = tests.find(test => test.name === error.test_name)?.questions.find(q => q.id === error.question_id);
    const entry = { ...error, ...question, test_name: error.test_name, id: error.question_id,
      number: question?.number || Number(error.question_id.match(/_(\d+)$/)?.[1]) || null,
      text: question?.text || error.question_text || "", references: list(question?.references),
      fail_rate: error.fail_rate_percent, wrong_patterns: list(question?.wrong_patterns) };
    const key = entry.text && entry.references.length
      ? JSON.stringify([entry.text, [...entry.references].sort()]) : JSON.stringify([entry.test_name, entry.id]);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });
  const cards = [...grouped.values()].sort((a, b) => Math.max(...b.map(q => q.fail_rate)) - Math.max(...a.map(q => q.fail_rate)));
  const sum = field => tests.every(test => finite(test[field])) ? tests.reduce((n, test) => n + test[field], 0) : null;
  const answers = rawTests.length ? sum("answers") : summaryAnswers !== undefined ? Number(summaryAnswers) : completeDetails ? details.length : null;
  const correct = rawTests.length ? sum("correct") : summaryCorrect !== undefined ? Number(summaryCorrect) : completeDetails ? details.filter(d => d.ai_score_percent === 100).length : null;
  const attempts = rawTests.length ? sum("attempts") : summaryAttempts !== undefined ? Number(summaryAttempts) : null;
  const recommendations = list(result.course_recommendations).map(r => {
    const match = r.target?.match(/^(.*): вопрос q_.*_(\d+)$/);
    return { target: match ? `${pdfTestLabel(match[1])}, вопрос ${match[2]}` : r.target, text: r.action_item, priority: r.priority };
  });
  if (!recommendations.length) recommendations.push(...list(report.recommendations).map(text => ({ target: "", text })));
  return {
    course: report.course || "Электронный курс", summary, tests, cards, errors, recommendations,
    limitations: list(result.limitations), notes: list(result.data_notes), anomalies: list(result.anomalies),
    complete: Boolean(rawTests.length), generationMode: result.generation_mode,
    totals: { answers, correct, attempts, wrong: finite(answers) && finite(correct) ? answers - correct : null,
      success: answers > 0 && finite(correct) ? correct * 100 / answers : null,
      questions: rawTests.length || completeDetails ? tests.reduce((n, t) => n + t.questions.length, 0) : null,
      critical: errors.length, high: errors.filter(e => e.fail_rate_percent >= 60).length,
      wrongBlank: rawTests.length ? sum("wrong_blank") : null },
  };
}
