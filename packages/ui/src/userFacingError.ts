const unconfirmed = 'We cannot confirm whether this action finished. Check your connection, then reopen the record and check its history before submitting again. If you are still stuck, send the record number and a screenshot to your support team.';
const systemProblem = 'An app problem prevented this request from finishing normally. Reopen the record and check its latest status before submitting again. If it continues, send the record number and a screenshot to your support team.';

// Presentation only: keep original errors for business logic and diagnostics.
// These messages must never turn an uncertain response into a claim of no writes.
const rules: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Reservation not confirmed\..*Storage unavailable|^Browser storage unavailable/i,
    'Your draft could not be saved in this browser. Keep this page open and ask your support team for help before submitting again.'],
  [/^Reservation not confirmed\./i,
    'Reservation not confirmed. Use Recover reservation to check the original request before starting another. Keep the existing event and product selection until recovery finishes.'],
  [/Storage policy denied(?: upload)?/i,
    'You cannot upload a file to this record with your current access. Ask your administrator to check your account and the record access.'],
  [/A governed receipt decision already reserves this procurement PO line/i,
    'This PO item already has a receiving issue awaiting a decision. Do not receive the same units again. Ask an independent Warehouse Supervisor to open Receive and inspect > Controlled receipt decisions and review this PO.'],
  [/Pending independent inspection holds cannot be released directly|Awaiting independent quality inspection/i,
    'This stock is waiting for inspection. An authorized person other than the receiver must complete it in Quality Control > Pending. Do not release the hold manually.'],
  [/Held serialized inventory cannot be transferred|held inventory cannot/i,
    'This stock is on a Quality hold. Keep it in its current bin and ask your warehouse supervisor to review the hold in Quality Control. Do not remove the hold just to move or release stock.'],
  [/receiving Operator cannot (approve|decide).*own exception|cannot approve.*own (request|receipt|exception)/i,
    'You recorded this request, so another authorized reviewer must decide it. Ask the responsible supervisor to review the existing record using their own account.'],
  [/releasing operator cannot acknowledge receipt/i,
    'You released these goods, so you cannot confirm their receipt as well. Ask the eligible recipient or an authorized person other than the releaser to record acceptance.'],
  [/second warehouse operator must release/i,
    'A different warehouse operator must release this order. Ask them to review the packed items and complete the release using their own account.'],
  [/Receipt acknowledgment is only available for handovers/i,
    'This is a courier shipment. Use Update delivery and attach proof of delivery. Receipt acknowledgment is for internal, event and third-party handovers.'],
  [/Expected quantity drift|locked PO-line remaining quantity|Concurrent receipt changed/i,
    'The remaining PO quantity has changed. Reopen the PO, check the latest receipts, and review the quantities before confirming. Do not receive units that are already recorded.'],
  [/idempotency|command is already in progress/i,
    'This submission may already be recorded or still processing. Check the record history before submitting again. If the result is unclear, ask your support team to check the original submission.'],
  [/Only issued procurement POs can be received/i,
    'This PO is not ready for receiving. Ask Procurement to check that it has been issued and still has items left to receive.'],
  [/return case is already resolved/i,
    'This return already has a recorded decision. Open the existing return and replacement or refund details. Ask the responsible reviewer about a correction instead of submitting it again.'],
  [/Finance evidence is required for refunds and write-offs/i,
    'Attach the required Finance supporting document before submitting the refund or write-off. Ask Finance which approved document to use if you are unsure.'],
  [/quarantine bin is required before any return resolution/i,
    'Choose the inspection or quarantine bin where the returned item is being kept before recording the return decision.'],
  [/Confirm complete replacement customer and delivery details/i,
    'Complete the replacement customer name, contact number and delivery address. Confirm missing details with the customer before submitting.'],
  [/supplier RMA reference is required/i,
    'Enter the supplier return authorization reference before sending the item back. Ask Procurement or the supplier for this reference.'],
  [/Acknowledgment reference and evidence are required/i,
    'Enter the acceptance reference and attach evidence that the recipient received the goods before confirming.'],
  [/Courier and waybill are required/i,
    'Enter the courier and waybill number before confirming packing.'],
  [/insufficient (available )?stock|not enough (available )?stock/i,
    'There is not enough available stock for this quantity. Check the selected warehouse and bin, including reserved or held units, then reduce the quantity or ask Operations about replenishment.'],
  [/Invalid login credentials/i,
    'The email or password is incorrect. Check both and try again, or use Forgot your password.'],
  [/JWT expired|refresh token.*(invalid|expired|not found)|session.*expired|Authentication (?:is )?required|not authenticated/i,
    'Your session is no longer valid. Sign in again, then reopen the record and check its status before continuing.'],
  [/row.level security|permission denied|Not authorized|insufficient_privilege|^42501$/i,
    'Your account does not have access to this action or record. Ask your administrator to check your role and department access. Do not use another person\'s account.'],
  [/duplicate key|unique constraint|^23505$/i,
    'A record with these details may already exist. Search for the existing record or serial number before adding another. If the details are correct, ask your support team to check the duplicate.'],
  [/foreign key|^23503$/i,
    'This action is blocked by a linked record. The related item, supplier or location may be missing, changed or still in use. Reopen the record and check its links, or ask the team that maintains it for help.'],
  [/rate.?limit|too many requests|^(?:HTTP )?429$|(?:status|code)\s*(?:of\s*)?[:=]?\s*429\b/i,
    'Too many requests were sent in a short time. Wait a moment, check whether the last action completed, then try again.'],
  [/payload too large|file too large|maximum.*file size|^(?:HTTP )?413$|(?:status|code)\s*(?:of\s*)?[:=]?\s*413\b/i,
    'This file is too large to upload. Use a smaller file and try attaching it again.'],
  [/unsupported (file|media) type|invalid mime/i,
    'This file type is not supported. Choose one of the file types listed beside the upload control.'],
  [/quota.*exceeded|QuotaExceededError/i,
    'This browser has run out of space for saved work. Do not clear its data while you have unsent drafts. Ask your support team to help recover pending work first.'],
  [/Invalid page cursor/i,
    'This list has changed since it was loaded. Reopen the list and search for the record again.'],
  [/Return quantity exceeds outstanding allocation custody/i,
    'The return quantity is higher than the quantity still out for this allocation. Open the original allocation and check previous returns before entering the quantity again.'],
  [/Return allocation identity does not match custody|Legacy return allocation lineage needs reconciliation/i,
    'This return does not match a usable allocation record. Ask your warehouse supervisor to check the original issue and any previous returns before continuing.'],
  [/Failed to fetch|NetworkError|network request failed|\bload failed\b|fetch failed|timeout|timed out|connection.*(lost|refused)|status.*5\d\d/i, unconfirmed],
  [/column .* does not exist|relation .* does not exist|schema cache|could not find the function|PGRST\d+|SQLSTATE|\b(jsonb|regprocedure)\b|invalid input syntax|violates.*constraint|Internal Server Error|TypeError:|ReferenceError:|https?:\/\/|[A-Z]:\\|\bat .*\.(tsx?|jsx?):\d+/i, systemProblem],
];

export function userFacingError(error: unknown, context: 'action' | 'sign-in' = 'action'): string {
  const value = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message
    : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
  const message = value.trim();
  const uncertainMessage = context === 'sign-in'
    ? 'We could not confirm your sign-in. Check your connection and try Sign in again. If this keeps happening, contact your support team.'
    : unconfirmed;
  if (!message) return uncertainMessage;
  for (const [pattern, replacement] of rules) {
    if (pattern.test(message)) return replacement === unconfirmed ? uncertainMessage : replacement;
  }
  return message;
}
