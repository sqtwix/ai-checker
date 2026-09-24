import verdanaBoldUrl from "./assets/fonts/Verdana-Bold.ttf?url";
import verdanaUrl from "./assets/fonts/Verdana.ttf?url";

const PDF_FONT = "Verdana";

const formatExportDate = () =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

const safeFileName = (value, extension) => {
  const baseName = (value || "neuroexpert-report")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
  return `${baseName || "neuroexpert-report"}.${extension}`;
};

const normalizeRows = (report) => ({
  errors: Array.isArray(report.errors) ? report.errors : [],
  recommendations: Array.isArray(report.recommendations) ? report.recommendations : [],
});

const reportNotes = (report) => [
  ...(report.result?.data_notes || []).map((text) => ["Учёт данных", text]),
  ...(report.result?.limitations || []).map((text) => ["Ограничение", text]),
];

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const loadFontBase64 = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to load PDF font");
  return arrayBufferToBase64(await response.arrayBuffer());
};

const registerPdfFonts = async (doc) => {
  const [regularFont, boldFont] = await Promise.all([
    loadFontBase64(verdanaUrl),
    loadFontBase64(verdanaBoldUrl),
  ]);
  doc.addFileToVFS("Verdana.ttf", regularFont);
  doc.addFont("Verdana.ttf", PDF_FONT, "normal");
  doc.addFileToVFS("Verdana-Bold.ttf", boldFont);
  doc.addFont("Verdana-Bold.ttf", PDF_FONT, "bold");
};

export async function exportReportToPdf(report) {
  const [{ jsPDF }, { default: autoTable }, { drawReportPdf }] = await Promise.all([
    import("jspdf"), import("jspdf-autotable"), import("./reportPdf.js"),
  ]);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  await registerPdfFonts(doc);
  drawReportPdf(doc, autoTable, report);
  doc.save(safeFileName(report.course, "pdf"));
}
const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const escapeCsvCell = (value) => {
  const cell = String(value ?? "");
  return `"${cell.replace(/"/g, '""')}"`;
};

const toCsvRow = (values) => values.map(escapeCsvCell).join(",");

const styleWorksheetHeader = (worksheet) => {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2F6F65" },
  };
  headerRow.alignment = { vertical: "middle", wrapText: true };
};

export async function exportReportToXlsx(report) {
  const ExcelJS = (await import("exceljs")).default;
  const { errors, recommendations } = normalizeRows(report);
  const exportDate = formatExportDate();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "НейроЭксперт";
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Поле", key: "field", width: 22 },
    { header: "Значение", key: "value", width: 70 },
  ];
  summarySheet.addRows([
    { field: "Сервис", value: "НейроЭксперт" },
    { field: "Курс", value: report.course || "Электронный курс" },
    { field: "Заголовок отчета", value: report.title || "Отчет без названия" },
    { field: "Статус", value: report.status || "Completed" },
    { field: "Дата экспорта", value: exportDate },
    ...reportNotes(report).map(([field, value]) => ({ field, value })),
  ]);

  const errorsSheet = workbook.addWorksheet("Errors");
  errorsSheet.columns = [
    { header: "Приоритет", key: "priority", width: 14 },
    { header: "Процент", key: "val", width: 12 },
    { header: "Вопрос", key: "question", width: 36 },
    { header: "Описание", key: "text", width: 96 },
  ];
  errorsSheet.addRows(
    errors.length
      ? errors.map((error) => ({
          priority: error.priority || "",
          val: error.val || "",
          question: error.question || "",
          text: error.text || "",
        }))
      : [{ priority: "", val: "", question: "", text: "Критичные массовые ошибки не указаны." }]
  );

  const recommendationsSheet = workbook.addWorksheet("Recommendations");
  recommendationsSheet.columns = [
    { header: "Номер", key: "index", width: 10 },
    { header: "Рекомендация", key: "recommendation", width: 110 },
  ];
  recommendationsSheet.addRows(
    recommendations.length
      ? recommendations.map((recommendation, index) => ({
          index: index + 1,
          recommendation,
        }))
      : [{ index: "", recommendation: "Рекомендации не указаны." }]
  );

  [summarySheet, errorsSheet, recommendationsSheet].forEach((worksheet) => {
    styleWorksheetHeader(worksheet);
    worksheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    safeFileName(report.course, "xlsx")
  );
}

export function exportReportToCsv(report) {
  const { errors, recommendations } = normalizeRows(report);
  const exportDate = formatExportDate();
  const rows = [
    ["Summary"],
    ["Field", "Value"],
    ["Service", "НейроЭксперт"],
    ["Course", report.course || "Электронный курс"],
    ["Report title", report.title || "Отчет без названия"],
    ["Status", report.status || "Completed"],
    ["Export date", exportDate],
    ...reportNotes(report),
    [],
    ["Errors"],
    ["Priority", "Percent", "Question", "Description"],
    ...(errors.length
      ? errors.map((error) => [
          error.priority || "",
          error.val || "",
          error.question || "",
          error.text || "",
        ])
      : [["", "", "", "Критичные массовые ошибки не указаны."]]),
    [],
    ["Recommendations"],
    ["#", "Recommendation"],
    ...(recommendations.length
      ? recommendations.map((recommendation, index) => [index + 1, recommendation])
      : [["", "Рекомендации не указаны."]]),
  ];

  const csv = `\uFEFF${rows.map(toCsvRow).join("\n")}`;
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), safeFileName(report.course, "csv"));
}

export function exportReportToJson(report) {
  downloadBlob(
    new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" }),
    safeFileName(report.course, "json")
  );
}
