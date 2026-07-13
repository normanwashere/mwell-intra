-- Governed public RPCs call private policy functions whose EXECUTE privilege is
-- intentionally not exposed to authenticated clients. Execute only the public
-- wrappers as their owner; every private function still enforces auth.uid(),
-- capability, state-transition, and evidence requirements.

alter function legal.submit_vendor_application(jsonb) security definer;
alter function legal.submit_vendor_application(jsonb) set search_path = '';
alter function legal.record_instrument_signature(jsonb) security definer;
alter function legal.record_instrument_signature(jsonb) set search_path = '';
alter function legal.sign_instrument(jsonb) security definer;
alter function legal.sign_instrument(jsonb) set search_path = '';

alter function procurement.confirm_route_decision(jsonb) security definer;
alter function procurement.confirm_route_decision(jsonb) set search_path = '';
alter function procurement.submit_request(jsonb) security definer;
alter function procurement.submit_request(jsonb) set search_path = '';
alter function procurement.approve_purchase_order(jsonb) security definer;
alter function procurement.approve_purchase_order(jsonb) set search_path = '';
alter function procurement.issue_purchase_order(jsonb) security definer;
alter function procurement.issue_purchase_order(jsonb) set search_path = '';
alter function procurement.record_acceptance_pack(jsonb) security definer;
alter function procurement.record_acceptance_pack(jsonb) set search_path = '';
alter function procurement.prepare_payment_readiness(jsonb) security definer;
alter function procurement.prepare_payment_readiness(jsonb) set search_path = '';
alter function procurement.review_payment_readiness(jsonb) security definer;
alter function procurement.review_payment_readiness(jsonb) set search_path = '';
alter function procurement.save_doa_matrix(jsonb) security definer;
alter function procurement.save_doa_matrix(jsonb) set search_path = '';
alter function procurement.activate_doa_matrix(jsonb) security definer;
alter function procurement.activate_doa_matrix(jsonb) set search_path = '';

revoke all on function legal.submit_vendor_application(jsonb) from public, anon;
revoke all on function legal.record_instrument_signature(jsonb) from public, anon;
revoke all on function legal.sign_instrument(jsonb) from public, anon;
revoke all on function procurement.confirm_route_decision(jsonb) from public, anon;
revoke all on function procurement.submit_request(jsonb) from public, anon;
revoke all on function procurement.approve_purchase_order(jsonb) from public, anon;
revoke all on function procurement.issue_purchase_order(jsonb) from public, anon;
revoke all on function procurement.record_acceptance_pack(jsonb) from public, anon;
revoke all on function procurement.prepare_payment_readiness(jsonb) from public, anon;
revoke all on function procurement.review_payment_readiness(jsonb) from public, anon;
revoke all on function procurement.save_doa_matrix(jsonb) from public, anon;
revoke all on function procurement.activate_doa_matrix(jsonb) from public, anon;

grant execute on function legal.submit_vendor_application(jsonb) to authenticated, service_role;
grant execute on function legal.record_instrument_signature(jsonb) to authenticated, service_role;
grant execute on function legal.sign_instrument(jsonb) to authenticated, service_role;
grant execute on function procurement.confirm_route_decision(jsonb) to authenticated, service_role;
grant execute on function procurement.submit_request(jsonb) to authenticated, service_role;
grant execute on function procurement.approve_purchase_order(jsonb) to authenticated, service_role;
grant execute on function procurement.issue_purchase_order(jsonb) to authenticated, service_role;
grant execute on function procurement.record_acceptance_pack(jsonb) to authenticated, service_role;
grant execute on function procurement.prepare_payment_readiness(jsonb) to authenticated, service_role;
grant execute on function procurement.review_payment_readiness(jsonb) to authenticated, service_role;
grant execute on function procurement.save_doa_matrix(jsonb) to authenticated, service_role;
grant execute on function procurement.activate_doa_matrix(jsonb) to authenticated, service_role;
