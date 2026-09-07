// Exact published vendor UI protocol; no live legal actions are part of these cases.
export const VENDOR_CASES = [
  { role:'vendor_representative',email:'intra.test.vendor@mwell.com.ph',route:'/vendor/onboarding',
    requirementId:'vendor.vendor_representative.evidence-and-acknowledgments.v1',simulationId:'vendor-evidence-review-v1',protocol:'attestation' },
  { role:'vendor_representative',email:'intra.test.vendor@mwell.com.ph',route:'/vendor/onboarding',
    requirementId:'vendor.vendor_representative.evidence-backed-submission-practice.v1',simulationId:'vendor-accreditation-submission-v1',protocol:'choice' },
];
export const VENDOR_SIMULATIONS = [
  { id:'vendor-evidence-review-v1',title:'Vendor evidence and acknowledgments',embeddedSteps:[
    {checkpointId:'review-evidence',title:'Review evidence responsibilities',outcomeId:'reviewed'},
    {checkpointId:'complete',title:'Keep legal declarations separate',outcomeId:'reviewed'},
  ] },
  { id:'vendor-accreditation-submission-v1',title:'Prepare a complete accreditation submission',embeddedSteps:[
    {checkpointId:'prepare-accreditation-evidence',title:'Prepare accreditation evidence',choices:[
      {id:'submit-old',label:'Submit now and promise replacements by email'},
      {id:'replace-and-align',label:'Upload the current registration and align the authorized signatory evidence'},
      {id:'change-review-status',label:'Mark the application reviewed so Legal sees it faster'},
    ]},
    {checkpointId:'confirm-vendor-submission',title:'Confirm the vendor submission',choices:[
      {id:'leave-blank',label:'Submit with the declaration blank'},
      {id:'ask-legal-answer',label:'Ask Legal to complete the declaration for you'},
      {id:'answer-declaration',label:'Answer the declaration truthfully, review the pack, and submit'},
    ]},
  ] },
];
export const VENDOR_RULES = {
  'vendor-accreditation-submission-v1:prepare-accreditation-evidence':{acceptedChoiceId:'replace-and-align'},
  'vendor-accreditation-submission-v1:confirm-vendor-submission':{acceptedChoiceId:'answer-declaration'},
};
