export interface RequestStepValidation {
  fieldErrors: Record<string, string>;
  firstInvalidSelector?: string;
}

export interface RequestStepValues {
  title: string;
  category: string;
  lines: Array<{ description: string; quantity: string }>;
  needDescription: string;
}

export function validateRequestStep(
  step: 1 | 2 | 3,
  values: RequestStepValues,
): RequestStepValidation {
  const fieldErrors: Record<string, string> = {};
  if (step === 1) {
    if (!values.category) fieldErrors.category = "Pick a purchase category.";
    if (!values.title.trim()) fieldErrors.title = "Enter a request title.";
    if (!values.lines.some((line) => line.description.trim())) {
      fieldErrors.lines = "Describe at least one line item.";
    }
    const firstInvalidSelector = fieldErrors.category
      ? '[name="category"]'
      : fieldErrors.title
        ? "#title"
        : fieldErrors.lines
          ? '[data-request-line-description="true"]'
          : undefined;
    return { fieldErrors, firstInvalidSelector };
  }
  if (step === 2 && !values.needDescription.trim()) {
    fieldErrors.needDescription = "Describe the business need.";
    return { fieldErrors, firstInvalidSelector: "#need-description" };
  }
  return { fieldErrors };
}
