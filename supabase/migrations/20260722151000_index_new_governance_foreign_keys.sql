-- Cover foreign-key joins introduced by Legal dual control and Product governance.

create index if not exists legal_accreditation_reviews_proposed_by_idx
  on legal.accreditation_decision_reviews(proposed_by);
create index if not exists legal_accreditation_reviews_confirmed_by_idx
  on legal.accreditation_decision_reviews(confirmed_by);

create index if not exists product_readiness_prepared_by_idx
  on product.readiness_packages(prepared_by);
create index if not exists product_readiness_submitted_by_idx
  on product.readiness_packages(submitted_by);
create index if not exists product_readiness_decided_by_idx
  on product.readiness_packages(decided_by);
create index if not exists product_readiness_acknowledged_by_idx
  on product.readiness_packages(operations_acknowledged_by);
create index if not exists product_readiness_events_readiness_idx
  on product.readiness_events(readiness_id);
create index if not exists product_readiness_events_actor_idx
  on product.readiness_events(actor);

create index if not exists product_price_proposals_proposed_by_idx
  on product.price_proposals(proposed_by);
create index if not exists product_price_proposals_decided_by_idx
  on product.price_proposals(decided_by);
create index if not exists product_price_events_proposal_idx
  on product.price_events(proposal_id);
create index if not exists product_price_events_actor_idx
  on product.price_events(actor);
