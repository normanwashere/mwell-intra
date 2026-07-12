-- Pin API wrapper search paths to satisfy the function security contract.
alter function legal.record_instrument_signature(jsonb) set search_path = '';
alter function legal.sign_instrument(jsonb) set search_path = '';
alter function legal.submit_vendor_application(jsonb) set search_path = '';
alter function procurement.activate_doa_matrix(jsonb) set search_path = '';
alter function procurement.approve_purchase_order(jsonb) set search_path = '';
alter function procurement.confirm_route_decision(jsonb) set search_path = '';
alter function procurement.issue_purchase_order(jsonb) set search_path = '';
alter function procurement.prepare_payment_readiness(jsonb) set search_path = '';
alter function procurement.record_acceptance_pack(jsonb) set search_path = '';
alter function procurement.review_payment_readiness(jsonb) set search_path = '';
alter function procurement.save_doa_matrix(jsonb) set search_path = '';
alter function procurement.submit_request(jsonb) set search_path = '';
