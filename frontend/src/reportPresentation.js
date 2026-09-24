// Presentation-only helpers. Never sort or slice the saved report in place:
// exports and other pages must keep the complete original result.
export function prepareFindings(errors = []) {
  return errors.map((error, index) => {
    const testName = error.testName || error.question?.split(": Вопрос ")[0] || "Без названия теста";
    const questionId = error.questionId || error.question?.split(": Вопрос ").slice(1).join(": Вопрос ") || "";
    const number = questionId.match(/_(\d+)$/)?.[1];
    const title = number ? `Вопрос ${Number(number)}` : error.question || "Вопрос без названия";
    const rawRate = error.failRate ?? error.val;
    const rate = Number.parseFloat(String(rawRate ?? "").replace(",", "."));
    const parts = testName.split(" — ");
    const description = error.errorDescription || error.text || "";
    const counts = description.match(/^Ошиблись (\d+) из (\d+) студентов \(([\d.,]+)%\)\.$/);
    return {
      ...error,
      key: `${testName}:${questionId}:${index}`,
      index,
      testName,
      testLabel: parts.length > 1 ? parts.slice(1).join(" — ") : testName,
      source: parts.length > 1 ? parts[0] : "",
      questionId,
      title,
      rate: Number.isFinite(rate) ? rate : null,
      description: counts
        ? `Учтено как ошибки: ${counts[1]} из ${counts[2]} записей (${counts[3].replace(".", ",")}%).`
        : description,
    };
  });
}

export function selectFindings(rows, { testName = "", query = "", sort = "rate-desc", page = 1, pageSize = 10 } = {}) {
  const search = query.trim().toLocaleLowerCase("ru");
  const filtered = rows.filter(row =>
    (!testName || row.testName === testName) &&
    (!search || [row.testName, row.title, row.questionId, row.question, row.text]
      .join(" ").toLocaleLowerCase("ru").includes(search))
  );
  filtered.sort((a, b) => {
    if (sort === "source") return a.index - b.index;
    if (a.rate === null || b.rate === null) {
      return a.rate === b.rate ? a.index - b.index : a.rate === null ? 1 : -1;
    }
    return (sort === "rate-asc" ? a.rate - b.rate : b.rate - a.rate) || a.index - b.index;
  });
  const size = [10, 20, 50].includes(Number(pageSize)) ? Number(pageSize) : 10;
  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const currentPage = Math.max(1, Math.min(pageCount, Math.floor(Number(page)) || 1));
  const offset = (currentPage - 1) * size;
  return {
    items: filtered.slice(offset, offset + size),
    total: filtered.length,
    page: currentPage,
    pageCount,
    from: filtered.length ? offset + 1 : 0,
    to: Math.min(offset + size, filtered.length),
  };
}

export function elapsedTime(createdAt, now = Date.now()) {
  const start = typeof createdAt === "number" ? createdAt : Date.parse(createdAt);
  if (!Number.isFinite(start)) return "—";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${String(hours).padStart(2, "0")}:${minutes}:${rest}` : `${minutes}:${rest}`;
}
