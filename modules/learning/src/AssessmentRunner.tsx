"use client";

import { useMemo, useRef, useState } from "react";
import { Badge, Button, Textarea } from "@intra/ui";
import { useLearning } from "./LearningProvider";
import type {
  AssessmentResult,
  RequirementDefinition,
  RequirementProgress,
} from "./types";

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  options: readonly { id: string; label: string }[];
  explanation?: string;
}

export function AssessmentRunner({
  requirement,
  progress,
  questions,
}: {
  requirement: RequirementDefinition;
  progress: RequirementProgress;
  questions: readonly AssessmentQuestion[];
}) {
  const { submitAssessment, requestSupport, closeActivity, resume } = useLearning();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [supportReason, setSupportReason] = useState("");
  const [supportSent, setSupportSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const question = questions[index];
  const answered = question ? Boolean(answers[question.id]) : false;
  const isLast = index === questions.length - 1;
  const explanations = useMemo(
    () => questions.flatMap((item) => (item.explanation ? [item.explanation] : [])),
    [questions],
  );

  if (progress.state === "needs_support") {
    return (
      <section aria-labelledby="assessment-support-title" className="space-y-5">
        <div>
          <Badge tone="rose">Support required</Badge>
          <h2 id="assessment-support-title" className="mt-2 font-display text-xl font-bold text-ink">
            Attempts exhausted
          </h2>
          <p className="mt-1 text-sm text-muted">
            Ask for coaching before another governed attempt is assigned.
          </p>
        </div>
        <div className="max-w-2xl">
          <label htmlFor="assessment-support-reason" className="block text-sm font-semibold text-ink">
            What support do you need?
          </label>
          <Textarea
            id="assessment-support-reason"
            className="mt-2"
            maxLength={1000}
            value={supportReason}
            onChange={(event) => setSupportReason(event.target.value)}
          />
          <span className="mt-1 block text-right text-xs font-normal text-muted">
            {supportReason.length} / 1000
          </span>
        </div>
        <Button
          disabled={pending || supportSent || !supportReason.trim()}
          onClick={async () => {
            if (inFlight.current) return;
            inFlight.current = true;
            setPending(true);
            setError(null);
            try {
              await requestSupport({
                assignmentRequirementId: progress.assignmentRequirementId,
                reason: supportReason.trim(),
              });
              setSupportSent(true);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Support request could not be sent.");
            } finally {
              inFlight.current = false;
              setPending(false);
            }
          }}
        >
          {supportSent ? "Support requested" : "Request support"}
        </Button>
        {error && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
      </section>
    );
  }

  if (result) {
    return (
      <section aria-live="polite" className="space-y-5">
        <div>
          <Badge tone={result.passed ? "emerald" : "rose"}>
            Score {result.score}%
          </Badge>
          <h2 className="mt-2 font-display text-xl font-bold text-ink">
            {result.passed ? "Assessment passed" : "Review and try again"}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {result.passed
              ? "Your result was confirmed by the learning service."
              : "Review the guidance below before starting another attempt."}
          </p>
        </div>
        {explanations.length > 0 && (
          <ul className="space-y-2 border-t border-line pt-4 text-sm text-muted">
            {explanations.map((explanation) => <li key={explanation}>{explanation}</li>)}
          </ul>
        )}
        {!result.passed && result.state === "failed_retryable" && (
          <Button
            onClick={() => {
              closeActivity();
              void resume(requirement.id);
            }}
          >
            Start another attempt
          </Button>
        )}
      </section>
    );
  }

  if (!question || !progress.activeAttempt) {
    return <p role="alert" className="text-sm text-muted">This assessment attempt is not available.</p>;
  }

  return (
    <section aria-labelledby="assessment-title" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs font-semibold uppercase text-brand-700 dark:text-brand-300">Knowledge check</p>
          <h2 id="assessment-title" className="mt-1 font-display text-xl font-bold text-ink">{requirement.title}</h2>
        </div>
        <span className="tnum text-sm font-semibold text-muted">Question {index + 1} of {questions.length}</span>
      </div>
      <fieldset className="space-y-3">
        <legend className="font-display text-lg font-bold text-ink">{question.prompt}</legend>
        {question.options.map((option) => (
          <label key={option.id} className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line px-1 py-3 text-sm text-ink focus-within:bg-inset">
            <input
              type="radio"
              name={question.id}
              value={option.id}
              checked={answers[question.id] === option.id}
              onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))}
              className="h-5 w-5 shrink-0 accent-brand-600"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col-reverse gap-3 border-t border-line pt-4 sm:flex-row sm:justify-between">
        <Button variant="outline" disabled={index === 0 || pending} onClick={() => setIndex((value) => value - 1)}>Previous</Button>
        {!isLast ? (
          <Button disabled={!answered || pending} iconRight="arrowRight" onClick={() => setIndex((value) => value + 1)}>Next question</Button>
        ) : (
          <Button
            disabled={!answered || pending}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setPending(true);
              setError(null);
              try {
                setResult(await submitAssessment({
                  assignmentRequirementId: progress.assignmentRequirementId,
                  attemptId: progress.activeAttempt!.id,
                  answers: questions.map((item) => ({ questionId: item.id, answerId: answers[item.id]! })),
                }));
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Assessment could not be submitted.");
              } finally {
                inFlight.current = false;
                setPending(false);
              }
            }}
          >Submit answers</Button>
        )}
      </div>
      {error && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>}
    </section>
  );
}
