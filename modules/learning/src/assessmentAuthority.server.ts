import { assessmentQuestionsFor } from "./content";

export interface ServerAssessmentInput {
  requirementId: string;
  answers: readonly { questionId: string; answerId: string }[];
}

const ANSWER_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    "internal.warehouse.receiving-controls-assessment.v1": {
      "receiving-identifiers": "capture-identifiers",
      "receiving-exception": "controlled-quality",
    },
    "internal.warehouse.marketing-reservation-assessment.v1": {
      "reservation-availability": "respect-availability",
      "reservation-custody": "hold-not-issue",
      "reservation-details": "event-product-purpose",
      "reservation-authority": "reservation-only",
      "reservation-uncertain-response": "reconcile-before-retry",
    },
  };

export function scoreServerAssessment(input: ServerAssessmentInput): {
  score: number;
} {
  const answerKey = ANSWER_KEYS[input.requirementId];
  const questions = assessmentQuestionsFor(input.requirementId);
  if (!answerKey || !questions) {
    throw new Error("Assessment is not published for server scoring.");
  }
  const submitted = new Map<string, string>();
  for (const answer of input.answers) {
    if (submitted.has(answer.questionId)) {
      throw new Error(`Duplicate assessment answer ${answer.questionId}.`);
    }
    const question = questions.find((item) => item.id === answer.questionId);
    if (!question?.options.some((option) => option.id === answer.answerId)) {
      throw new Error(
        "Assessment answer is not part of the published question.",
      );
    }
    submitted.set(answer.questionId, answer.answerId);
  }
  if (
    submitted.size !== questions.length ||
    questions.some((question) => !submitted.has(question.id))
  ) {
    throw new Error("Assessment requires the complete published question set.");
  }
  const correct = questions.filter(
    (question) => answerKey[question.id] === submitted.get(question.id),
  ).length;
  return { score: Math.round((correct / questions.length) * 100) };
}
