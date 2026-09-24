import { preparePdfData, pdfNumber as n, pdfPercent as pc, pdfTestLabel as label } from "./reportPdfData.js";

const C = { ink: "#203334", teal: "#2d7169", muted: "#637877", line: "#dce7e3", paper: "#f6f9f7", mint: "#e7f1ec", rust: "#b94c37", peach: "#f7e9e1" };
const FONT = "Verdana";
const clean = value => String(value ?? "").replace(/[\u2011\u2013\u2014]/g, "-").replaceAll("\u00a0", " ");
const answerLabel = value => ({ ":": "двоеточие (:)", ",": "запятая (,)", "-": "тире (-)" })[value] || value;

// Vector PDF layout, shared by the browser download and the rendering smoke test.
export function drawReportPdf(doc, autoTable, report, { exportedAt = new Date() } = {}) {
  const data = preparePdfData(report);
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 46, CW = W - 2 * M, TOP = 65, BOTTOM = H - 51;
  let y = TOP;
  const font = (size = 10, bold = false, color = C.ink) => {
    doc.setFont(FONT, bold ? "bold" : "normal"); doc.setFontSize(size); doc.setTextColor(color);
  };
  const lines = (text, width = CW, size = 10, bold = false) => {
    font(size, bold); return doc.splitTextToSize(clean(text), width);
  };
  const page = () => { doc.addPage(); y = TOP; };
  const ensure = height => { if (y + height > BOTTOM) page(); };
  const paragraph = (text, { size = 10, leading = 14.3, color = C.ink, bold = false, gap = 7 } = {}) => {
    for (const line of lines(text, CW, size, bold)) {
      ensure(leading); font(size, bold, color); doc.text(line, M, y + size); y += leading;
    }
    y += gap;
  };
  const heading = (text, level = 2) => {
    const size = level === 1 ? 21 : 13;
    ensure(lines(text, CW, size, true).length * (size + 5) + 38);
    if (level === 2) y += 6;
    paragraph(text, { size, leading: size + 5, bold: true, gap: 8 });
  };
  const tag = text => { ensure(24); paragraph(text.toUpperCase(), { size: 8.4, bold: true, color: C.teal, leading: 12, gap: 10 }); };
  const section = (tagText, title) => { page(); tag(tagText); heading(title, 1); };
  const rule = () => { ensure(14); doc.setDrawColor(C.line); doc.setLineWidth(.7); doc.line(M, y + 5, W - M, y + 5); y += 14; };
  const table = (headers, rows, widths) => {
    ensure(60);
    autoTable(doc, {
      startY: y, head: [headers.map(clean)], body: rows.map(row => row.map(clean)),
      theme: "plain", margin: { left: M, right: M, top: TOP, bottom: 51 },
      styles: { font: FONT, fontSize: 9, textColor: C.ink, cellPadding: { top: 6, bottom: 6, left: 8, right: 8 }, overflow: "linebreak", valign: "top" },
      headStyles: { fillColor: C.teal, textColor: "#ffffff", fontStyle: "bold", fontSize: 8.6 },
      alternateRowStyles: { fillColor: C.paper },
      columnStyles: Object.fromEntries(widths.map((width, i) => [i, { cellWidth: width * CW, halign: i ? "right" : "left" }])),
      rowPageBreak: "avoid", showHead: "everyPage",
    });
    y = doc.lastAutoTable.finalY + 12;
  };

  // Split overlong cards only between lines; every continuation keeps its frame.
  const framed = (title, blocks, { fill = "#ffffff", accent = C.teal, border = true } = {}) => {
    const width = CW - 28;
    const items = [];
    const addText = (text, { size = 9.4, bold = false, color = C.ink, gap = 6 } = {}) => {
      const prefix = text.match(/^(Эталон:|Частый неверный ответ:|Что проверить и разобрать:)/)?.[1];
      lines(text, width - (prefix ? 5 : 0), size, bold).forEach((line, index) => items.push({ text: line, prefix: index === 0 ? prefix : null, size, bold, color, height: size * 1.39 }));
      items.push({ height: gap });
    };
    for (const block of blocks) {
      if (block.band) {
        const parts = lines(block.band[0], width * .52 - 14, 9.4);
        items.push({ band: block.band, parts, height: Math.max(25, parts.length * 13 + 10) });
        items.push({ height: 6 });
      } else addText(block.text, block);
    }
    let first = true;
    while (items.length) {
      const titleLines = lines(title + (first ? "" : " (продолжение)"), width, 11.5, true);
      const titleHeight = titleLines.length * 15 + 8;
      const height = 28 + titleHeight + items.reduce((sum, item) => sum + item.height, 0);
      if (height <= BOTTOM - TOP) ensure(height + 10);
      else ensure(28 + titleHeight + 55);
      const chunk = []; let used = 28 + titleHeight;
      while (items.length && used + items[0].height <= BOTTOM - y) { const item = items.shift(); chunk.push(item); used += item.height; }
      if (!chunk.length) { page(); continue; }
      doc.setFillColor(fill); doc.setDrawColor(C.line); doc.setLineWidth(.65);
      doc.roundedRect(M, y, CW, used, 9, 9, border ? "FD" : "F");
      if (border) { doc.setDrawColor(accent); doc.setLineWidth(3); doc.line(M + 1, y + 15, M + 1, y + Math.min(45, used - 10)); }
      let cursor = y + 14;
      font(11.5, true); titleLines.forEach(line => { doc.text(line, M + 14, cursor + 11.5); cursor += 15; }); cursor += 8;
      for (const item of chunk) {
        if (item.band) {
          doc.setFillColor(C.mint); doc.rect(M + 14, cursor, width, item.height, "F"); font(9.4);
          item.parts.forEach((line, i) => doc.text(line, M + 21, cursor + 15 + i * 13));
          doc.text(clean(item.band[1]), M + 14 + width * .79 - 7, cursor + 15, { align: "right" });
          doc.text(clean(item.band[2]), W - M - 21, cursor + 15, { align: "right" });
        } else if (item.text !== undefined) {
          font(item.size, item.bold, item.color);
          if (item.prefix) {
            font(item.size, true, item.color); doc.text(item.prefix, M + 14, cursor + item.size);
            const offset = doc.getTextWidth(item.prefix); font(item.size, false, item.color);
            doc.text(item.text.slice(item.prefix.length), M + 14 + offset, cursor + item.size);
          } else doc.text(item.text, M + 14, cursor + item.size);
        }
        cursor += item.height;
      }
      y += used + 10; first = false;
      if (items.length) page();
    }
  };
  const note = (title, text, peach = false) => framed(title, [{ text, size: 10, gap: 0 }], { fill: peach ? C.peach : C.mint, border: false });
  const recommendations = () => {
    heading("Рекомендации");
    if (!data.recommendations.length) paragraph("В сохранённом отчёте рекомендации не указаны.", { color: C.muted });
    data.recommendations.forEach((r, i) => {
      const priority = { High: "Высокий приоритет", Medium: "Приоритет разбора", Low: "Наблюдение" }[r.priority] || "";
      paragraph(`${i + 1}. ${r.target ? r.target + ". " : ""}${r.text}${priority ? " (" + priority + ")" : ""}`);
    });
  };
  const t = data.totals;
  tag("Электронный курс / Кейс 1");
  paragraph("Отчёт по результатам\nтестирования", { size: 27, leading: 32, bold: true, gap: 12 });
  paragraph(data.course);
  const stats = [[pc(t.success), "верных ответов", "по отметкам LMS"], [n(t.answers), "оценённых ответов", "во всех тестах"], [n(t.critical), "проблемных вопросов", "доля ошибок от 40%"]];
  ensure(100);
  stats.forEach(([value, title, caption], i) => {
    const gap = 10, width = (CW - 2 * gap) / 3, x = M + i * (width + gap);
    doc.setFillColor(i ? C.paper : C.mint); doc.roundedRect(x, y, width, 88, 9, 9, "F");
    font(25, true, i ? C.ink : C.teal); doc.text(value, x + 13, y + 32);
    font(9.3, true, i ? C.ink : C.teal); doc.text(title, x + 13, y + 53);
    font(8.4, false, C.muted); doc.text(caption, x + 13, y + 70);
  });
  y += 104;
  if (t.answers !== null && t.correct !== null) paragraph(`Из ${n(t.answers)} оценённых ответов ${n(t.correct)} отмечены как верные, ${n(t.wrong)} - как неверные. Доля верных ответов - ${pc(t.success)}. Вопросов с долей ошибок от 40%: ${n(t.critical)}; из них от 60%: ${n(t.high)}.`);
  else paragraph(data.summary || "Числовая сводка отсутствует в сохранённом результате.");
  heading("Доля верных ответов по тестам");
  if (!data.tests.length) paragraph("В сохранённом отчёте нет разбивки по тестам.", { color: C.muted });
  data.tests.forEach(test => {
    const nameLines = lines(label(test.name), 166, 9.2);
    const height = Math.max(25, nameLines.length * 13 + 8); ensure(height);
    font(9.2); nameLines.forEach((line, i) => doc.text(line, M, y + 10 + i * 13));
    const ratio = test.answers > 0 && test.correct !== null ? test.correct * 100 / test.answers : null;
    const x = M + 172, width = CW - 228;
    doc.setFillColor(C.mint); doc.roundedRect(x, y + 2, width, 10, 4, 4, "F");
    if (ratio > 0) { doc.setFillColor(C.teal); doc.roundedRect(x, y + 2, width * Math.min(100, ratio) / 100, 10, Math.min(4, width * ratio / 200), 4, "F"); }
    font(10, true, C.teal); doc.text(pc(ratio), W - M, y + 11, { align: "right" }); y += height;
  });
  y += 5;
  note("Главное для преподавателя", data.recommendations[0]?.text || (t.critical ? "Рассмотрите вопросы с высокой долей ошибок и сопоставьте выводы с исходными ответами. Высокая доля ошибок сама по себе не устанавливает причину затруднения." : "Результат сохранён. Сопоставьте рекомендации и отмеченные случаи с исходными данными."));
  recommendations();
  rule(); paragraph("Расчёт включает ответы с явной оценкой LMS. Пустые позиции без результата не считаются ошибками. Подробности расчёта и замечания к данным - на следующих страницах.", { size: 8.7, leading: 12.1, color: C.muted });

  section("Сводка по тестам", "Объём и результаты");
  table(["Тест", data.complete ? "Попытки" : "Попытки\nс оценкой", "Оценено\nответов", "Верно", "Неверно", "Верно, %"], [
    ...data.tests.map(test => [label(test.name), n(test.attempts), n(test.answers), n(test.correct), n(test.answers !== null && test.correct !== null ? test.answers - test.correct : null), pc(test.answers > 0 && test.correct !== null ? test.correct * 100 / test.answers : null)]),
    ["Всего", n(t.attempts), n(t.answers), n(t.correct), n(t.wrong), pc(t.success)],
  ], [.30, .135, .145, .13, .14, .15]);
  heading("Вопросы, требующие разбора");
  table(["Тест", "Вопросов", "Ошибки от 40%", "Из них от 60%"], [
    ...data.tests.map(test => { const errors = data.errors.filter(e => e.test_name === test.name); return [label(test.name), n(test.questions.length), n(errors.length), n(errors.filter(e => e.fail_rate_percent >= 60).length)]; }),
    ["Всего", n(t.questions), n(t.critical), n(t.high)],
  ], [.38, .16, .23, .23]);
  heading("Как читать показатели");
  paragraph(`Доля верных: ${n(t.correct)} / ${n(t.answers)} × 100 = ${pc(t.success)}.\nДоля ошибок в вопросе: неверные ответы / все оценённые ответы на этот вопрос × 100.`);
  paragraph("Общая доля рассчитана по всем ответам, а не как среднее процентов тестов. «Попытки» - прохождения тестов, а не число разных людей. Порог применяется до округления; проценты показаны с одним десятичным знаком.", { size: 8.7, leading: 12.1, color: C.muted });
  heading("Учёт пустых данных");
  data.notes.forEach(text => paragraph(text));
  if (t.wrongBlank !== null) paragraph(`Пустых текстовых ответов с явной отметкой «неверно»: ${n(t.wrongBlank)}. Они включены в ошибки.`);
  if (!data.complete) paragraph("Этот сохранённый отчёт не содержит полного набора исходных полей для PDF. Недоступные значения обозначены прочерком. Попытки по тестам отражают только сохранённые оценённые ответы.", { size: 8.7, leading: 12.1, color: C.muted });

  section("Случаи для проверки", "Проверка исходных оценок");
  paragraph("Замечания ниже приведены из сохранённого результата анализа. Они не меняют исходные отметки LMS в расчёте.");
  if (data.generationMode === "fallback") note("Резервный расчёт без ИИ", "Этот отчёт сформирован резервным алгоритмом. ИИ-пояснения отсутствуют.", true);
  if (data.limitations.length) data.limitations.forEach((text, i) => { heading(`${String(i + 1).padStart(2, "0")}. Замечание к результату`); paragraph(text); });
  else paragraph("В сохранённом отчёте ограничения качества не указаны.");
  note("Действие перед выводами о знаниях", "Сверьте отмеченные задания и правила допуска ответа с исходными файлами. Изменять оценки следует после подтверждённой проверки преподавателем.", true);

  section("Случаи для проверки", "Повторяющиеся ответы");
  note("Совпадение требует контекста", "Совпадающий неверный ответ может отражать распространённую ошибку или выбор одного и того же варианта. Эти данные сами по себе не доказывают списывание.");
  const ignored = new Set(["", "неверный ответ", "неправильный ответ", "ошибка", "incorrect"]);
  const repeats = data.tests.flatMap(test => test.questions.flatMap(q => q.wrong_patterns?.filter(p => p.students >= 2 && !ignored.has(p.text.trim().toLocaleLowerCase("ru"))).map(p => ({ test, q, p })) || []));
  repeats.sort((a, b) => b.p.count - a.p.count);
  if (repeats.length) {
    const groups = data.tests.reduce((sum, test) => sum + test.questions.reduce((count, q) => count + (q.repeated_groups || 0), 0), 0);
    paragraph(`Групп повторяющихся непустых неверных ответов: ${n(groups)}. Одна группа - одинаковый ответ на вопрос одного теста у двух и более участников.`);
    heading("Примеры с наибольшим числом совпадений");
    repeats.slice(0, 4).forEach(({ test, q, p }) => {
      heading(`${label(test.name)}, вопрос ${q.number}: ${n(p.count)} записей`);
      paragraph(`Неверный ответ по LMS: «${p.text}». Эталон: «${q.references.join(" / ")}».`);
    });
  } else paragraph(`Случаев для дополнительной проверки в отчёте: ${n(data.anomalies.length)}.`);
  const groupedAnomalies = new Map();
  data.anomalies.filter(a => !data.complete || a.anomaly_type !== "SuspiciousMatch").forEach(a => { const key = JSON.stringify([a.anomaly_type, a.description]); if (!groupedAnomalies.has(key)) groupedAnomalies.set(key, { ...a, count: 0 }); groupedAnomalies.get(key).count++; });
  if (groupedAnomalies.size) {
    heading("Отмеченные случаи");
    table(["Тип", "Записей", "Описание"], [...groupedAnomalies.values()].map(a => [({ SuspiciousMatch: "Совпадение ответов", SpeedCheating: "Необычно быстрое прохождение", ExtremeStruggling: "Длительное затруднение" })[a.anomaly_type] || a.anomaly_type, n(a.count), a.description]), [.24, .13, .63]);
  }
  rule(); heading("Проверки времени прохождения");
  paragraph(data.anomalies.some(a => ["SpeedCheating", "ExtremeStruggling"].includes(a.anomaly_type)) ? "Отмеченные системой случаи приведены выше. Проверьте исходные данные о времени перед выводами." : "В сохранённом отчёте нет отмеченных случаев необычного времени прохождения. Отсутствие отметок не означает, что длительность была доступна для проверки.");

  section("Массовые ошибки", "Подробный разбор вопросов");
  paragraph(`Вопросов с долей ошибок от 40%: ${n(t.critical)}. Карточек: ${n(data.cards.length)}. Одинаковые задания с одинаковым набором эталонов объединены; показатели каждого теста приведены отдельно.`);
  paragraph("В зелёных строках: тест и номер вопроса, неверные ответы из оценённых, доля ошибок. Карточки упорядочены по наибольшей доле ошибок. Высокий приоритет означает долю ошибок от 60%.", { size: 8.7, leading: 12.1, color: C.muted });
  if (!data.cards.length) note("Массовые ошибки не указаны", "В сохранённом результате нет вопросов, отмеченных как массовые ошибки.");
  data.cards.forEach((group, index) => {
    const high = group.some(q => q.fail_rate >= 60), first = group[0];
    const blocks = [{ text: first.text || `Вопрос ${first.number || first.id}` }];
    group.forEach(q => blocks.push({ band: [`${label(q.test_name)}, вопрос ${q.number || q.id}`, q.answers != null ? `${n(q.wrong)} из ${n(q.answers)}` : "Нет числа ответов", pc(q.fail_rate)] }));
    if (first.references.length) blocks.push({ text: "Эталон: " + first.references.map(answerLabel).join(" / ") });
    const patterns = new Map();
    group.forEach(q => q.wrong_patterns.forEach(p => { const key = p.text.trim().toLocaleLowerCase("ru"); if (!patterns.has(key)) patterns.set(key, { text: p.text || "[Пустой ответ]", count: 0 }); patterns.get(key).count += p.count; }));
    const top = [...patterns.values()].sort((a, b) => b.count - a.count)[0];
    if (top) blocks.push({ text: `Частый неверный ответ: «${answerLabel(top.text)}» (${n(top.count)} записей).` });
    [...new Set(group.map(q => q.methodological_reason).filter(Boolean))].forEach(text => blocks.push({ text: "Что проверить и разобрать: " + text }));
    if (!first.references.length && first.error_pattern_description) blocks.push({ text: first.error_pattern_description });
    blocks.push({ text: "Источники: " + group.map(q => `${label(q.test_name)}, вопрос ${q.number || q.id}`).join("; ") + ".", size: 8, color: C.muted, gap: 0 });
    framed(`${String(index + 1).padStart(2, "0")}. ${high ? "Высокий приоритет" : "Приоритет разбора"}`, blocks, { accent: high ? C.rust : C.teal });
  });
  rule(); heading("Источники и обозначения");
  paragraph("Отчёт сформирован из сохранённого результата анализа загруженных файлов. Номер вопроса соответствует позиции в тесте. Числовые показатели и пояснения перенесены в PDF без переоценки ответов.", { size: 8.7, leading: 12.1, color: C.muted });
  const pages = doc.getNumberOfPages();
  const date = exportedAt.toLocaleDateString("ru-RU");
  for (let number = 1; number <= pages; number++) {
    doc.setPage(number); font(9, true, C.teal); doc.text("ИИМПУЛЬС", 40, 29);
    font(8, false, C.muted); doc.text("Анализ результатов тестирования", W - 40, 29, { align: "right" });
    doc.setDrawColor(C.line); doc.setLineWidth(.5); doc.line(40, 39, W - 40, 39); doc.line(40, H - 37, W - 40, H - 37);
    font(7.8, false, C.muted); doc.text(`Кейс 1   /   По отметкам LMS   /   ${date}`, 40, H - 23);
    doc.text(`${number} / ${pages}`, W - 40, H - 23, { align: "right" });
  }
  doc.setProperties({ title: "Отчёт по результатам тестирования", author: "ИИМПУЛЬС", subject: clean(data.course) });
  return doc;
}
