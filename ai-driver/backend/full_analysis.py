"""Complete local analysis in bounded requests, without sampling source answers."""

from collections import Counter
import json
import logging
import os

from backend.agent_client import AgentSemanticError
from backend.checkpoints import Checkpoints
from backend.cancellation import check_cancelled

logger = logging.getLogger(__name__)

ANSWER_PROMPT = (
    "Ты анализируешь ответы студентов. Для КАЖДОГО id верни одно краткое пояснение "
    "на русском, до 25 слов. Сравни answer с reference с учётом question. "
    "correct — факт из LMS, не меняй его и не придумывай частичные баллы. "
    "Для неверного ответа объясни конкретное отличие от эталона; для верного — "
    "кратко подтверди правильность. Не придумывай причины поведения студента. "
    "Верни JSON-объект: ключи — все переданные id, значения — непустые пояснения. "
    "Никаких других ключей и текста вне JSON."
)
ANOMALY_PROMPT = (
    "Ты описываешь подтверждённые факты из учебного тестирования. Для КАЖДОГО id "
    "верни краткое описание на русском до 25 слов, используя только evidence. "
    "Совпадение ответов или необычное время не доказывает списывание и требует "
    "экспертной проверки. Не добавляй новых фактов или обвинений. "
    "Верни JSON-объект: ключи — переданные id, значения — непустые описания. "
    "Если список пуст, верни {}. Никакого текста вне JSON."
)
SUMMARY_PROMPT = (
    "Ты итоговый аналитик. Получены проверенные показатели всего набора и "
    "часть уже выполненных пояснений. Дай краткую качественную сводку этой части "
    "на русском до 40 слов и 1–3 рекомендации, основанные только на этих данных. "
    "Не пересчитывай показатели всей группы по этой части и не придумывай числа "
    "или аномалии. Верни только JSON: global_course_summary — строка, "
    "course_recommendations — массив объектов target, action_item, priority "
    "(Low, Medium или High)."
)
SUMMARY_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "global_course_summary": {"type": "string", "minLength": 1},
        "course_recommendations": {
            "type": "array", "minItems": 1, "maxItems": 3,
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "target": {"type": "string"},
                    "action_item": {"type": "string"},
                    "priority": {"type": "string", "enum": ["Low", "Medium", "High"]},
                },
                "required": ["target", "action_item", "priority"],
            },
        },
    },
    "required": ["global_course_summary", "course_recommendations"],
}


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def russian_text(value):
    return isinstance(value, str) and bool(value.strip()) and any(
        "а" <= char.casefold() <= "я" or char.casefold() == "ё" for char in value
    )


class FullAnalysisPipeline:
    def __init__(self, factory):
        self.factory = factory
        self.max_chars = max(2000, min(200000, int(os.getenv("AI_MAX_INPUT_CHARS", "4000"))))

    def batches(self, items, key, metadata=None, max_items=4):
        """Pack whole items. An oversized item is rejected, never truncated or omitted."""
        metadata = metadata or {}
        batch = []
        for item in items:
            if len(compact({**metadata, key: [item]})) > self.max_chars:
                raise ValueError(
                    "Один ответ с вопросом и эталоном превышает AI_MAX_INPUT_CHARS. "
                    "Увеличьте этот лимит вместе с контекстом локальной модели."
                )
            candidate = batch + [item]
            if batch and (len(candidate) > max_items or len(compact({**metadata, key: candidate})) > self.max_chars):
                yield batch
                batch = []
            batch.append(item)
        if batch:
            yield batch

    def describe(self, agent, prompt, items, key, phase):
        descriptions = {}
        failed = []
        batches = list(self.batches(items, key)) or [[]]

        def run_batch(batch, retry_single=True):
            check_cancelled()
            ids = {item["id"] for item in batch}
            schema = {
                "type": "object", "additionalProperties": False,
                "properties": {item["id"]: {"type": "string", "minLength": 1} for item in batch},
                "required": [item["id"] for item in batch],
            }
            try:
                payload = compact({key: batch})
                cache_key = self.checkpoints.request_key(prompt, payload, schema)
                result = self.checkpoints.get(cache_key)
                if result is None:
                    result = json.loads(agent.execute(prompt, payload, response_schema=schema))
                if not isinstance(result, dict) or set(result) != ids or not all(russian_text(text) for text in result.values()):
                    raise AgentSemanticError("missing, extra or unusable descriptions")
                self.checkpoints.put(cache_key, result)
                descriptions.update(result)
            except (AgentSemanticError, ValueError, TypeError):
                # Retry a rejected group as smaller requests instead of repeatedly
                # sending the same oversized output contract. Never discard a row.
                if len(batch) > 1:
                    middle = len(batch) // 2
                    run_batch(batch[:middle])
                    run_batch(batch[middle:])
                elif batch and retry_single:
                    run_batch(batch, retry_single=False)
                else:
                    failed.extend(ids)
                    logger.warning("%s: could not validate %s", phase, sorted(ids))

        for index, batch in enumerate(batches, 1):
            logger.info("Full analysis %s: part %s/%s (%s items)", phase, index, len(batches), len(batch))
            run_batch(batch)
        return descriptions, failed

    @staticmethod
    def source_cases(source):
        cases = []
        members = {}
        duplicates = {}
        total = 0
        correct = 0
        attempts = 0
        for test_index, test in enumerate(source.get("tests", [])):
            questions = {item["question_id"]: item for item in test["questions"]}
            for index, attempt in enumerate(test["student_attempts"]):
                attempts += 1
                attempt_id = attempt.get("attempt_id") or f"attempt_{index + 1}"
                for answer in attempt["answers"]:
                    total += 1
                    correct += bool(answer["is_correct_by_lms"])
                    question = questions[answer["question_id"]]
                    # Exact text, question and correctness must all match. Similar
                    # answers and answers to different questions remain separate.
                    reference = answer.get("reference_answer") or question["reference_answer"]
                    marker = (test_index, answer["question_id"], answer["user_answer"], answer["is_correct_by_lms"], reference)
                    case_id = duplicates.get(marker)
                    if case_id is None:
                        case_id = f"a{len(cases) + 1}"
                        duplicates[marker] = case_id
                        cases.append({
                            "id": case_id, "question": question["question_text"],
                            "reference": reference, "answer": answer["user_answer"],
                            "correct": bool(answer["is_correct_by_lms"]),
                        })
                        members[case_id] = []
                    members[case_id].append((attempt["student_id"], test["test_name"], attempt_id, answer["question_id"]))
        return cases, members, {"attempts": attempts, "answers": total, "correct": correct}

    @staticmethod
    def source_events(source):
        events = []
        members = {}

        def add(kind, evidence, student_ids):
            event_id = f"e{len(events) + 1}"
            events.append({"id": event_id, "type": kind, "evidence": evidence})
            members[event_id] = student_ids

        ignored = {"", "неверный ответ", "неправильный ответ", "ошибка", "incorrect"}
        for test in source.get("tests", []):
            values = {}
            for attempt in test["student_attempts"]:
                answers = attempt["answers"]
                timed = [answer["time_spent_seconds"] for answer in answers if answer.get("time_spent_seconds") is not None]
                if timed and answers:
                    average = sum(timed) / len(timed)
                    success = sum(answer["is_correct_by_lms"] for answer in answers) * 100 / len(answers)
                    kind = "SpeedCheating" if average < 10 and success >= 80 else (
                        "ExtremeStruggling" if average > 300 and success < 50 else None
                    )
                    if kind:
                        add(kind, {"average_seconds": average, "success_percent": success}, [attempt["student_id"]])
                for answer in answers:
                    value = answer["user_answer"].strip().casefold()
                    if not answer["is_correct_by_lms"] and value not in ignored:
                        values.setdefault((answer["question_id"], value), []).append(attempt["student_id"])
            for (question_id, value), students in values.items():
                if len(set(students)) >= 2:
                    add("SuspiciousMatch", {
                        "test": test["test_name"], "question_id": question_id,
                        "same_incorrect_answer": value, "student_count": len(set(students)),
                    }, list(dict.fromkeys(students)))
        return events, members

    def run(self, source, model_type):
        with Checkpoints(source, model_type) as checkpoints:
            self.checkpoints = checkpoints
            return self._run(source, model_type)

    def _run(self, source, model_type):
        cases, members, metrics = self.source_cases(source)
        events, event_members = self.source_events(source)
        agents = self.factory.create_queue(model_type)
        logger.info("Full analysis: %s answers, %s distinct cases, %s evidence groups", metrics["answers"], len(cases), len(events))
        explanations, failed_cases = self.describe(agents[0], ANSWER_PROMPT, cases, "answers", "answers")
        event_text, failed_events = self.describe(agents[1], ANOMALY_PROMPT, events, "events", "anomalies")

        details = []
        for case in cases:
            if case["id"] not in explanations:
                continue
            for student_id, test_name, attempt_id, question_id in members[case["id"]]:
                details.append({
                    "student_id": student_id, "test_name": test_name, "attempt_id": attempt_id, "question_id": question_id,
                    "ai_score_percent": 100.0 if case["correct"] else 0.0,
                    "uniqueness_status": "Normal", "error_explanation": explanations[case["id"]],
                })
        anomalies = []
        for event in events:
            if event["id"] in event_text:
                for student_id in event_members[event["id"]]:
                    anomalies.append({
                        "student_id": student_id, "anomaly_type": event["type"],
                        "severity": "Medium", "description": event_text[event["id"]],
                    })

        notes = [{
            "case": case["id"], "correct": case["correct"], "answer_count": len(members[case["id"]]),
            "explanation": explanations.get(case["id"], "Пояснение недоступно; требуется экспертный просмотр."),
        } for case in cases]
        metadata = {"whole_dataset": metrics, "confirmed_evidence_groups": dict(Counter(event["type"] for event in events))}
        summaries = []
        recommendations = []
        failed_summaries = 0
        batches = list(self.batches(notes, "reviewed_answers", metadata, max_items=20)) or [[]]
        for index, batch in enumerate(batches, 1):
            logger.info("Full analysis summary: part %s/%s", index, len(batches))
            check_cancelled()
            try:
                payload = compact({**metadata, "reviewed_answers": batch})
                cache_key = self.checkpoints.request_key(SUMMARY_PROMPT, payload, SUMMARY_SCHEMA)
                result = self.checkpoints.get(cache_key)
                if result is None:
                    result = json.loads(agents[2].execute(
                        SUMMARY_PROMPT, payload, response_schema=SUMMARY_SCHEMA,
                    ))
                if not isinstance(result, dict) or not russian_text(result.get("global_course_summary")) or not isinstance(result.get("course_recommendations"), list) or not 1 <= len(result["course_recommendations"]) <= 3:
                    raise AgentSemanticError("invalid summary")
                for item in result["course_recommendations"]:
                    if not isinstance(item, dict) or not isinstance(item.get("target"), str) or not russian_text(item.get("action_item")) or item.get("priority") not in {"Low", "Medium", "High"}:
                        raise AgentSemanticError("invalid recommendation")
                self.checkpoints.put(cache_key, result)
                summaries.append(result["global_course_summary"])
                recommendations.extend(result["course_recommendations"])
            except (AgentSemanticError, ValueError, TypeError):
                failed_summaries += 1

        limitations = []
        if failed_cases:
            missed = sum(len(members[case_id]) for case_id in failed_cases)
            limitations.append(f"Не удалось проверить ИИ-пояснения для {missed} из {metrics['answers']} ответов после повторной обработки отдельных частей.")
        if failed_events:
            limitations.append(f"Не удалось проверить ИИ-описания для {len(failed_events)} групп аномалий.")
        if failed_summaries:
            limitations.append(f"Не удалось проверить итоговую ИИ-формулировку для {failed_summaries} частей.")
        logger.info("Full analysis complete: %s/%s answers have validated explanations; %s limitations", len(details), metrics["answers"], len(limitations))
        return compact({
            "batch_id": source["batch_id"], "global_course_summary": "\n".join(summaries),
            "test_summaries": [], "student_detailed_analyses": details,
            "anomalies": anomalies, "course_recommendations": recommendations,
            "generation_mode": "llm", "quality_status": "degraded" if limitations else "verified",
            "limitations": limitations,
        })
