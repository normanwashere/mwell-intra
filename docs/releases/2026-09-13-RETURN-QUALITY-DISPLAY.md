# Return And Quality Display Update

## For Testers

The return summary now separates the customer case from physical intake. A case awaiting a decision no longer implies the item is still waiting to arrive. The intake message also makes clear that a recorded return is not proof of Quality clearance. Check the current inspection and holds before proceeding.

Quality counts now match the tab and search you are viewing. For example, **1 of 3** means one matching record in a list of three. Clear search to see the full list.

Your process has not changed. The same permissions, quarantine, evidence and independent-review steps apply.

## Release Evidence

September 14 replenishment follow-up: UAT database migration `20260913175711_align_replenishment_action_authority_and_snapshot` aligns the nested recommendation check with the existing action-specific effective capability. It also rejects stale changes after Procurement acceptance or handoff, retaining the existing draft-request handoff and audit. No role grants, read policies or workflow stages were added. Twelve isolated SQL tests passed independently; the ordinary Operations test now reaches zero-quantity validation instead of the old Procurement authorization error. No successful recommendation is claimed from that probe. The inventory entry and inbound KB corrections are still application candidates; their release and full live journey will be recorded separately.

The follow-up KB correction separates page access from export preparation in the Dashboard, Data & Reports and Inventory Reports guides. It removes the old instruction that analytics/Finance viewing alone enables exports, explains the existing Warehouse-or-Insights preparation permission in plain language, and keeps required training and source-record checks. Feature links, controls, route grants and screenshot evidence status are unchanged. This corrects the export reference, not the older flow-owner issues recorded in the September 14 audit.

The September 14 application release `10cb74545c0bbdf67bf2dd082ca4661d1b2d78d0` corrects export and replenishment action controls to use the corresponding command permissions rather than general viewing permissions. Read-only information stays visible. Replenishment recommendations still pass to Procurement for its separate decision; an export still uses the governed export service. Losing permission while a dialog is open prevents the next command. Operations Associates with export authority can open the same export dialog from the floor dashboard without access to broader reporting routes.

September 14 authority follow-up: the source role catalogue was missing 12 database grant entries introduced by the July 21 and August 13 migrations. The release adds only those existing entries and their mutation classifications, preserving the Warehouse Administrator's exact 26-grant boundary. No database grant or workflow changes are included. Role guides and the standalone manual distinguish Operations from Warehouse Operator, Business Unit requests from allocation, and read-only Pricing from Product price decisions. Export preparation, Finance review and Procurement replenishment/cancellation retain their existing training and approval controls.

The application release passed 1,053 warehouse tests, 737 shell tests (one browser-specific skip), the production build and independent review. Live readback completed 341 permission decisions for 11 accounts with no discrepancies; ten ordinary accounts could not inspect the full role catalogue, and the report retains that limit. Desktop/mobile review opened and closed the floor export dialog without submitting an export. These checks do not certify all transactions. Operations-only replenishment still needs its own accessible entry, and older KB flow-owner labels need a separate semantic review.

The status/count changes and matching documentation shipped to UAT as `c285863112ff43531980a79b22c358dd2bb959a9`, deployment `dpl_AkhWXDirAikptQTqsViNT1TJfw81`. Direct desktop and narrow-screen checks confirmed the new count and submitted-case wording. The September 14 follow-up prevents the outer dialog from scrolling when a lower field is brought into view; its release verification is recorded separately. This adjustment leaves form-body scrolling, required fields, Close and Escape behavior intact.

- Initial application candidate: `c8af48f`, included in the verified `c285863` UAT release above.
- 249 focused warehouse tests and warehouse typecheck passed.
- 33 server-free desktop/mobile screenshots captured; 12 visually reviewed. Mocked stores and fallback fonts were used, not a live signed-in session.
- KB and standalone manual sources updated with matching instructions.
- Isolated-role setup: 71 offline checks passed; live execution and those role journeys remain open.
- Full WMS certification and actual hardware/user acceptance remain open. SMTP is excluded.

Follow-up local checks: 24 shared-dialog browser cases across four layouts, three viewport sizes and two motion settings; 51 warehouse form/accessibility tests; 33 component screenshots with the focus-scroll regression. Four shared-dialog screenshots and two return screenshots were visually reviewed. These do not establish actual-device acceptance or every app dialog's content layout.

Do not treat this focused display update as certification of every return disposition or warehouse role.
