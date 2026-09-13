# Warehouse Testing Update - September 13

**Latest:** The return-summary and Quality-count changes are now live in `c285863`, with matching KB and handbook updates. [Read the shorter September 14 update](2026-09-14-WMS-TESTER-UPDATE.md). A mobile dialog-header issue remains open; the dated results below retain their original scope.

We fixed the receipt-photo upload that was stopping Marketing from finishing a department request. The fix is live on UAT.

After Warehouse releases your request, open the request, choose **Acknowledge receipt**, attach your receipt photo, and confirm. Use your own requester account. You do not need to switch to a warehouse account or ask Warehouse to issue the items again.

We tested the full department handover on desktop and mobile with fresh sample records. All 30 recorded checks passed. Picking, packing, independent release and receipt acknowledgment completed, and the stock balance was correct. Confirming receipt did not deduct stock a second time. We also checked that unrelated users and unrelated upload paths remain blocked.

The latest layout fixes are live on UAT in build **63a52fc**. Packing messages no longer cover the next-step guidance. Long order references have an expandable section, and a wrong-bin error stays visible above the scan controls. Receipt capture still uses one dialog, and confirmation stays visible when an order moves out of your selected filter. We checked the changed screens on live desktop and mobile.

We reran ecommerce delivery from start to finish on the latest build, with fresh desktop and mobile orders. All 32 recorded checks passed: create, allocate, pick, pack, release by a different operator, record a failed delivery, retry and confirm delivery with a private photo. Each order deducted two units once. Delivery confirmation and repeated submissions did not deduct more stock or create duplicate delivery events. Both runs were uninterrupted; no permissions or process steps were changed to make them pass.

We also completed a clean-stock receiving test on desktop and mobile: receive seven units, have a different operator inspect them, then put them away. Each test finished with seven units in the destination bin and none left in staging. Moving stock before inspection was correctly blocked. Desktop continued from its saved receipt after a test-tool connection failure; mobile ran through without interruption. The test PO was prepared in advance, so this does not count as testing procurement approval.

This is not a full warehouse signoff yet. Other stock types and return outcomes, receiving exceptions, concurrent work and broader recovery checks still need their dedicated runs. Actual warehouse users and devices also need to complete the floor pilot.

Three improvements are now deployed in **0079161** and retained in **b3a4d68**: opening an attached photo at full size before submitting, keeping long bin names readable in Storage Areas, and linking a physical customer return to its original order and return case. The return links preserve unfinished drafts and do not replace inspection or approve a customer resolution.

The full return/replacement test has now passed on live UAT, on both desktop and mobile. All **28 return checkpoints** completed, after 32 source-shipment checks. We received the return into quarantine, tested the hold restrictions, completed a separate Quality review, moved the accepted item back to stock, delivered the replacement and closed the customer case. Each sample finished at eight available units with nothing left in quarantine. The photo preview also worked before submission without losing the form.

We still found a few screen issues: the resolution dialog can show outdated intake guidance, Quality counts do not always match the selected tab, and some mobile captures need better framing. The first two have local fixes with 249 focused tests passing. Their isolated desktop/mobile browser checks also pass, including scrolling through the replacement address fields. They still need a full live-app check and are not yet deployed. Passing the transaction test is not the same as completing the visual review or real-user pilot.

Please leave records marked **WMS-ECOM** or **WMS-INBOUND** to the development team. The two earlier ecommerce test pairs were cleaned up, with their four photos archived first. New return-test shipments and evidence are still retained, along with the receiving tests and one earlier Received order. None represents a real shipment. Your normal sample scenarios remain separate.

The temporary **WMS signoff** records from this department test have now been cleaned up. We archived the four receipt photos first, then removed the exact synthetic records and verified the scoped cleanup. Your existing testing data was outside the deletion scope.

The updated KB is live in **b3a4d68**, and the standalone handbook has been rebuilt to match. The live return guide explains the optional order/case links and the separate Quality handoff. SMTP remains outside this warehouse testing scope.

Technical evidence and remaining limits: [completed return journey](2026-09-13-WMS-COMPLETE-RETURN-JOURNEY.md) and [return and visibility release](2026-09-13-WMS-RETURN-VISIBILITY-RELEASE.md).
