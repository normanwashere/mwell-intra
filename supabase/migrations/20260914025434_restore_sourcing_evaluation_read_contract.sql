-- Sourcing owners read their evaluation evidence here. The separate
-- evaluation_workspace remains exclusively for current variance reviewers.
create or replace function procurement.sourcing_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_request procurement.requests;
  v_event procurement.sourcing_events;
  v_profile procurement.policy_profiles;
  v_responses jsonb;
  v_comms jsonb;
  v_tabulations jsonb;
  v_evaluations jsonb;
  v_recommendation_row procurement.award_recommendations;
  v_recommendation jsonb := null;
  v_variances jsonb;
  v_eligibility jsonb := jsonb_build_object('canReview', false);
  v_history_visible boolean;
  v_evidence jsonb;
begin
  if not (
    core.has_live_cap('procurement', 'view_dashboard')
    or private.policy_sourcing_can_manage()
    or private.policy_sourcing_can_review()
  ) then
    raise exception 'No procurement sourcing access is assigned to this account.';
  end if;
  select * into v_request from procurement.requests where id::text = payload->>'request_id';
  if not found then raise exception 'Request not found'; end if;
  v_profile := private.policy_sourcing_profile(v_request.id::text);
  select * into v_event from procurement.sourcing_events where request_id = v_request.id and status <> 'cancelled' order by created_at desc limit 1;
  if not found then return jsonb_build_object('requestId', v_request.id, 'event', null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', response.id, 'vendorId', response.vendor_id, 'vendorName', vendor.legal_name, 'accredited', vendor.accreditation_status = 'approved' and (vendor.accreditation_expires_at is null or vendor.accreditation_expires_at > statement_timestamp()), 'invitedAt', response.invited_at, 'receivedAt', response.received_at, 'deadlineCompliant', response.deadline_compliant, 'proposalReference', response.proposal_storage_path, 'commercial', response.commercial, 'technical', response.technical) order by vendor.legal_name), '[]'::jsonb) into v_responses from procurement.sourcing_responses response join core.vendors vendor on vendor.id = response.vendor_id where response.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', communication.id,
    'communicationType', communication.communication_type,
    'notificationGroupId', communication.detail->>'notificationGroupId',
    'packageVersion', communication.detail->>'packageVersion',
    'packageHash', communication.detail->>'packageHash',
    'sentAt', communication.detail->>'sentAt',
    'deliveredAt', communication.detail->>'deliveredAt',
    'acknowledgedAt', acknowledgement.detail->>'acknowledgedAt',
    'acknowledgementState', case
      when communication.communication_type not in ('invitation', 'requote') then null
      when response.current_invitation_communication_id is distinct from communication.id then 'superseded'
      when acknowledgement.id is not null then 'acknowledged'
      when communication.sent_at + make_interval(hours => v_profile.vendor_acknowledgement_hours) < statement_timestamp() then 'overdue'
      else 'pending'
    end,
    'clarificationState', case when communication.communication_type = 'clarification' and communication.sent_at + make_interval(hours => v_profile.clarification_hours) < statement_timestamp() then 'overdue' when communication.communication_type = 'clarification' then 'answered' else null end
  ) order by communication.sent_at desc), '[]'::jsonb) into v_comms
  from procurement.solicitation_communications communication
  left join procurement.sourcing_responses response on response.sourcing_event_id = v_event.id and response.vendor_id::text = communication.detail->>'recipientVendorId'
  left join lateral (
    select acknowledgement.* from procurement.solicitation_communications acknowledgement
    where acknowledgement.communication_type = 'invitation_acknowledgement'
      and acknowledgement.detail->>'acknowledgedCommunicationId' = communication.id::text
      and acknowledgement.detail->>'recipientVendorId' = communication.detail->>'recipientVendorId'
    order by acknowledgement.sent_at desc limit 1
  ) acknowledgement on true
  where communication.request_id = v_request.id and communication.communication_type <> 'invitation_acknowledgement';

  -- These three collections have the same read authority as sourcing_workspace.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', tabulation.id, 'sourcingEventId', tabulation.sourcing_event_id, 'version', tabulation.version,
    'responseClosedAt', tabulation.response_closed_at, 'dueAt', tabulation.due_at,
    'submittedAt', tabulation.submitted_at, 'submittedByName', coalesce(submitter.full_name, tabulation.submitted_by::text),
    'entries', tabulation.entries, 'evidenceReference', tabulation.evidence_reference, 'comments', tabulation.comments,
    'status', tabulation.status, 'escalationStatus', tabulation.escalation_status
  ) order by tabulation.version desc), '[]'::jsonb) into v_tabulations
  from procurement.commercial_tabulations tabulation left join core.profiles submitter on submitter.id = tabulation.submitted_by
  where tabulation.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', evaluation.id, 'sourcingEventId', evaluation.sourcing_event_id, 'vendorId', evaluation.vendor_id,
    'version', evaluation.version, 'dueAt', evaluation.due_at, 'submittedAt', evaluation.submitted_at,
    'reviewerName', coalesce(reviewer.full_name, evaluation.reviewer_id::text), 'criteria', evaluation.criteria,
    'totalScore', evaluation.total_score, 'evidenceReference', evaluation.evidence_reference, 'comments', evaluation.comments,
    'status', evaluation.status, 'escalationStatus', evaluation.escalation_status
  ) order by evaluation.vendor_id, evaluation.version desc), '[]'::jsonb) into v_evaluations
  from procurement.technical_evaluations evaluation left join core.profiles reviewer on reviewer.id = evaluation.reviewer_id
  where evaluation.sourcing_event_id = v_event.id;
  select * into v_recommendation_row from procurement.award_recommendations recommendation
  where recommendation.sourcing_event_id = v_event.id and recommendation.status <> 'superseded'
  order by recommendation.created_at desc limit 1;
  if found then
    v_recommendation := jsonb_build_object(
      'id', v_recommendation_row.id, 'sourcingEventId', v_recommendation_row.sourcing_event_id,
      'evaluatedVendorId', v_recommendation_row.evaluated_vendor_id, 'recommendedVendorId', v_recommendation_row.recommended_vendor_id,
      'rationale', v_recommendation_row.rationale, 'commercialTabulationId', v_recommendation_row.commercial_tabulation_id,
      'technicalEvaluationId', v_recommendation_row.technical_evaluation_id, 'riskEvidenceReference', v_recommendation_row.risk_evidence_reference,
      'varianceJustification', v_recommendation_row.variance_justification, 'status', v_recommendation_row.status,
      'version', v_recommendation_row.revision, 'createdAt', v_recommendation_row.created_at
    );
  end if;
  -- Match the narrower variance-decision table policy, within sourcing admission.
  v_history_visible := coalesce(private.policy_sourcing_can_manage() or private.policy_sourcing_can_review()
    or core.has_live_cap('procurement', 'view_finance'), false);
  if v_history_visible then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', decision.id, 'awardRecommendationId', decision.award_recommendation_id,
      'decisionType', decision.decision_type, 'decision', decision.decision, 'rationale', decision.rationale,
      'decidedByName', coalesce(decider.full_name, decision.decided_by::text), 'decidedAt', decision.decided_at,
      'doaMatrixId', decision.doa_matrix_id, 'doaMatrixVersion', matrix.version, 'doaAssignmentId', decision.doa_assignment_id
    ) order by decision.decided_at), '[]'::jsonb) into v_variances
    from procurement.award_recommendation_variance_decisions decision
    left join core.profiles decider on decider.id = decision.decided_by
    left join procurement.doa_matrices matrix on matrix.id = decision.doa_matrix_id
    where decision.award_recommendation_id = v_recommendation_row.id;
    if v_recommendation_row.id is not null then
      v_eligibility := private.policy_variance_review_eligibility(v_request, v_recommendation_row);
    end if;
  end if;
  v_evidence := jsonb_build_object('commercialTabulations', v_tabulations, 'technicalEvaluations', v_evaluations,
    'awardRecommendation', v_recommendation, 'varianceDecisionsVisible', v_history_visible, 'varianceEligibility', v_eligibility);
  if v_history_visible then v_evidence := v_evidence || jsonb_build_object('varianceDecisions', v_variances); end if;
  return jsonb_build_object('requestId', v_request.id, 'event', jsonb_build_object('id', v_event.id, 'status', v_event.status, 'submissionDeadline', v_event.submission_deadline, 'originalSubmissionDeadline', v_event.original_submission_deadline, 'intendedResponses', v_event.intended_responses, 'packageVersion', v_event.package_version, 'packageHash', v_event.package_hash, 'failedBidReason', v_event.failed_bid_reason, 'selectedVendorId', v_event.selected_vendor_id, 'closureNote', v_event.closure_note, 'responses', v_responses, 'communications', v_comms, 'policyControlSources', coalesce(v_profile.control_sources,'{}'::jsonb), 'policyControls', jsonb_build_object('formalBidAmount', v_profile.formal_bid_amount, 'inviteTargetMin', v_profile.invite_target_min, 'inviteTargetMax', v_profile.invite_target_max, 'sealedBidMinimumResponses', v_profile.sealed_bid_minimum_responses, 'bidWindowWorkingDays', v_profile.bid_window_working_days, 'maxExtensionCalendarDays', v_profile.max_extension_calendar_days, 'vendorAcknowledgementHours', v_profile.vendor_acknowledgement_hours, 'clarificationHours', v_profile.clarification_hours, 'tabulationHours', v_profile.tabulation_hours, 'technicalEvaluationWorkingDays', v_profile.technical_evaluation_working_days, 'poAcknowledgementHours', v_profile.po_acknowledgement_hours, 'repeatOrderMaxAmount', v_profile.repeat_order_max_amount, 'repeatOrderMaxAgeDays', v_profile.repeat_order_max_age_days, 'pettyCashMaxAmount', v_profile.petty_cash_max_amount, 'poInvoiceThreshold', v_profile.po_invoice_threshold, 'vendorProbationMonths', v_profile.vendor_probation_months)) || v_evidence);
end;
$$;

-- CREATE OR REPLACE preserves the existing owner and EXECUTE ACL. No grants,
-- table policies, write functions or variance-only RPC are changed here.
