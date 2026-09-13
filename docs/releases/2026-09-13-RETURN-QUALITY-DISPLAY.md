# Return And Quality Display Update

## For Testers

The return summary now separates the customer case from physical intake. A case awaiting a decision no longer implies the item is still waiting to arrive. The intake message also makes clear that a recorded return is not proof of Quality clearance. Check the current inspection and holds before proceeding.

Quality counts now match the tab and search you are viewing. For example, **1 of 3** means one matching record in a list of three. Clear search to see the full list.

Your process has not changed. The same permissions, quarantine, evidence and independent-review steps apply.

## Release Evidence

The status/count changes and matching documentation shipped to UAT as `c285863112ff43531980a79b22c358dd2bb959a9`, deployment `dpl_AkhWXDirAikptQTqsViNT1TJfw81`. Direct desktop and narrow-screen checks confirmed the new count and submitted-case wording. The September 14 follow-up prevents the outer dialog from scrolling when a lower field is brought into view; its release verification is recorded separately. This adjustment leaves form-body scrolling, required fields, Close and Escape behavior intact.

- Initial application candidate: `c8af48f`, included in the verified `c285863` UAT release above.
- 249 focused warehouse tests and warehouse typecheck passed.
- 33 server-free desktop/mobile screenshots captured; 12 visually reviewed. Mocked stores and fallback fonts were used, not a live signed-in session.
- KB and standalone manual sources updated with matching instructions.
- Isolated-role setup: 71 offline checks passed; live execution and those role journeys remain open.
- Full WMS certification and actual hardware/user acceptance remain open. SMTP is excluded.

Follow-up local checks: 24 shared-dialog browser cases across four layouts, three viewport sizes and two motion settings; 51 warehouse form/accessibility tests; 33 component screenshots with the focus-scroll regression. Four shared-dialog screenshots and two return screenshots were visually reviewed. These do not establish actual-device acceptance or every app dialog's content layout.

Do not treat this focused display update as certification of every return disposition or warehouse role.
