# September 7 Merchandise: Live Transaction Verification

Target: https://mwell-intra-uat.vercel.app, frontend `a377d6fff79f7a8eb8d85e079b01c14ec513d3ee`, Supabase `kkoitlvydytdhlpxhuah`. Production was not changed. This is an automated browser transaction using UAT accounts and explicitly synthetic evidence, not a physical-goods or human-pilot certification.

## Completed Journey

The Operations Associate received 1,000 nonserialized tumblers against isolated `UAT-SEP08-VERIFY-PO-0006`; Operations Lead independently inspected them, then the Associate put away the accepted stock. Marketing requested ten; Operations Lead approved the request. Operations Associate picked and packed; Operations Lead released. Desktop and mobile screenshots were captured during the steps. Browser actions, rather than SQL updates, advanced the transaction.

Independent database readback confirmed:

| Check | Persisted result |
| --- | --- |
| Receipt | `rcpt-5a38ca58137a4cc1b84a05792c0e008d`, 1,000 units |
| Quality inspection | `119d9e52-ca46-4337-9a7b-0911595ff7d7`, accepted, 1,000 units |
| Putaway | 1,000 transferred from the general area into `uat-sep08-verify-storage` (`S8V-STOCK`) |
| Request / fulfillment | `6cc42382-362f-4f04-a37f-a5183d847b74`, department request, released |
| Pick | Ten units, recorded `pickBinId=uat-sep08-verify-storage`, no per-unit serials |
| Separation | Picker/packer and releaser have different actor IDs |
| Release movement | One `fulfillment_release` for ten from the recorded picked bin |
| Remaining stock | 990 in that bin; zero left in the general area |

## Defect Found and Fixed

The installed bulk release selector could ignore the confirmed line bin and consume a different bin, including falling back when the picked bin was held. Reproduced against the installed function snapshot: two failing tests. The narrow forward migration now constrains nonserialized release to its recorded active bin, retaining existing holds, locks, source constraints and actor separation. Thirteen migration tests passed independently before UAT application. Installed-function readback confirmed the new selector; the live transaction then released from the actual picked bin.

See [regression detail](2026-09-08-FULFILLMENT-PICKED-BIN-REGRESSION.md).

## Untouched Tester Capacity

All six POs below were independently checked after release and still have zero received quantities. Each pair contains Jacket S/M/L, 100 each, and Tumbler, 300. Total untouched receiving capacity: 900 jackets and 900 tumblers. They remain synthetic issued receiving fixtures, not evidence of an actual procurement approval or supplier accreditation.

| Set | Jackets | Tumblers |
| --- | --- | --- |
| Original | `UAT-SEP07-PO-0005` | `UAT-SEP07-PO-0006` |
| Repeat 1 | `UAT-SEP08-TESTER1-PO-0005` | `UAT-SEP08-TESTER1-PO-0006` |
| Repeat 2 | `UAT-SEP08-TESTER2-PO-0005` | `UAT-SEP08-TESTER2-PO-0006` |

Use these sets for tester receiving, QC, putaway and release. Do not reset or consume another tester's records, or reuse `VERIFY` records as fresh scenarios. Existing records were preserved by ownership guards and before/after fingerprint assertions in the additive seed. Twelve independent seed tests and actual-UAT rollback verification passed before application.

## Evidence and Limits

See the [stage report and screenshot paths](../../outputs/sep08-transactions/REPORT.md) and [verified readback](../../outputs/sep08-transactions/verified-readback.json). Selected screenshots were opened for visual review. Earlier receipt attempts blocked by the test request guard are retained as harness failures, not counted as successful transactions. Stale post-submit UI assertions for receipt and putaway are also preserved; database readback established their committed success and neither command was retried. No duplicated receipt was created. The test used manual barcode input, not a physical camera/device. The actual selected synthetic PNG was persisted as a data URI; object-storage upload is not certified.

Open follow-ups: the cross-user request review displays **Name unavailable** although the requester profile exists; use a request-scoped display-name projection, not broad profile access. The final mobile product view clips long synthetic seed purpose/cost labels; move internal test metadata out of primary product badges or wrap it accessibly. The governed PO form and command lack actual-delivery-date capture, and the recorded receipt has a null date; this is a confirmed gap, not an omitted test input. These limitations do not change the verified 1,000-in / ten-out / 990 balance, and are not being presented as fully resolved UI coverage. Jacket variant transactions, event allocations and every negative scenario were not executed end-to-end by this focused tumbler run.
