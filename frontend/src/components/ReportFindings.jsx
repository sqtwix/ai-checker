import { useMemo, useRef, useState } from "react";
import { prepareFindings, selectFindings } from "../reportPresentation";

function Pagination({ result, onChange, position }) {
  if (result.pageCount <= 1) return null;
  return (
    <nav className="findings-pagination" aria-label={`Страницы вопросов — ${position}`}>
      <button type="button" className="secondary-button" disabled={result.page === 1} onClick={() => onChange(result.page - 1)}>Назад</button>
      <label>
        Страница
        <select aria-label={`Номер страницы — ${position}`} value={result.page} onChange={event => onChange(Number(event.target.value))}>
          {Array.from({ length: result.pageCount }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
        </select>
        из {result.pageCount}
      </label>
      <button type="button" className="secondary-button" disabled={result.page === result.pageCount} onClick={() => onChange(result.page + 1)}>Вперёд</button>
    </nav>
  );
}

export function ReportFindings({ errors }) {
  const [testName, setTestName] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("rate-desc");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const heading = useRef(null);
  const rows = useMemo(() => prepareFindings(errors), [errors]);
  const tests = useMemo(() => Array.from(new Set(rows.map(row => row.testName))), [rows]);
  const result = useMemo(() => selectFindings(rows, { testName, query, sort, page, pageSize }), [rows, testName, query, sort, page, pageSize]);
  const updateFilter = (setter, value) => { setter(value); setPage(1); };
  const resetFilters = () => { setTestName(""); setQuery(""); setPage(1); };
  const changePageFromBottom = value => {
    setPage(value);
    heading.current?.scrollIntoView({ block: "start", behavior: "instant" });
    heading.current?.focus({ preventScroll: true });
  };

  return (
    <section className="panel findings-panel" aria-labelledby="findings-heading">
      <div className="section-heading">
        <div>
          <h3 id="findings-heading" ref={heading} tabIndex={-1}>Вопросы для проверки</h3>
          <p className="muted findings-intro">Одна карточка — один вопрос. Проценты взяты из сохранённого отчёта.</p>
        </div>
        <span className="badge" aria-label={`Всего вопросов для проверки: ${rows.length}`}>{rows.length}</span>
      </div>
      {rows.length > 0 ? <>
        <div className="findings-controls">
          <label>Тест<select value={testName} onChange={event => updateFilter(setTestName, event.target.value)}>
            <option value="">Все тесты ({tests.length})</option>
            {tests.map(test => <option key={test} value={test}>{test}</option>)}
          </select></label>
          <label>Сортировка<select value={sort} onChange={event => updateFilter(setSort, event.target.value)}>
            <option value="rate-desc">Сначала больший процент</option>
            <option value="rate-asc">Сначала меньший процент</option>
            <option value="source">В порядке исходного файла</option>
          </select></label>
          <label>Поиск<input type="search" value={query} placeholder="Тест, номер или код вопроса" onChange={event => updateFilter(setQuery, event.target.value)} /></label>
          <label>На странице<select value={pageSize} onChange={event => updateFilter(setPageSize, Number(event.target.value))}>
            {[10, 20, 50].map(size => <option key={size} value={size}>{size}</option>)}
          </select></label>
        </div>
        <div className="findings-results-line">
          <p role="status">Показаны {result.from}–{result.to} из {result.total}{result.total !== rows.length ? ` · Всего в отчёте: ${rows.length}` : ""}</p>
          {(query || testName) && <button type="button" className="ghost-button" onClick={resetFilters}>Сбросить фильтры</button>}
        </div>
        <Pagination result={result} onChange={setPage} position="сверху" />
        <div id="report-errors-container">
          {result.items.map(row => (
            <article key={row.key} className="finding report-finding">
              <span className={`priority ${row.priority}`} aria-label={`Процент по отчёту: ${row.val}`}>{row.val}</span>
              <div className="finding-copy">
                <p className="finding-test">{row.testLabel}</p>
                <h4>{row.title}</h4>
                {row.source && <p className="finding-source">{row.source}</p>}
                <p className="finding-description">{row.description}</p>
                <details className="finding-details">
                  <summary>Подробности вопроса</summary>
                  {row.questionId && <p><b>Код вопроса:</b> <code>{row.questionId}</code></p>}
                  {row.methodologicalReason && <p><b>Рекомендация:</b> {row.methodologicalReason}</p>}
                  <p><b>Исходная запись:</b> {row.text || row.question}</p>
                </details>
              </div>
            </article>
          ))}
        </div>
        {result.total === 0 && <p className="findings-empty">По этим условиям вопросов нет. Измените поиск или выберите другой тест.</p>}
        <Pagination result={result} onChange={changePageFromBottom} position="снизу" />
        <p className="muted findings-footnote">Фильтры меняют только этот список. При экспорте сохраняется полный отчёт.</p>
      </> : <p className="findings-empty">В сохранённом отчёте нет вопросов, выделенных для проверки.</p>}
    </section>
  );
}

export function ReportRecommendations({ recommendations, details, errors }) {
  const rows = useMemo(() => prepareFindings(errors), [errors]);
  const priorities = { High: "Высокий приоритет", Medium: "Средний приоритет", Low: "Низкий приоритет" };
  return (
    <section className="panel report-recommendations">
      <h3>Рекомендации</h3>
      <ul className="recommendations readable-recommendations" id="report-recommendations-list">
        {recommendations.map((text, index) => {
          const recommendation = details?.[index];
          if (!recommendation) return <li key={index}>{text}</li>;
          const finding = rows.find(row => recommendation.target === `${row.testName}: вопрос ${row.questionId}`);
          return <li key={index}>
            <span className="recommendation-priority">{priorities[recommendation.priority] || recommendation.priority}</span>
            <b>{finding ? `${finding.testLabel} · ${finding.title}` : recommendation.target}</b>
            <p>{recommendation.action_item}</p>
            {finding && <details className="finding-details"><summary>Источник рекомендации</summary><p>{recommendation.target}</p></details>}
          </li>;
        })}
      </ul>
    </section>
  );
}
