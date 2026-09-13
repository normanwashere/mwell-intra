# Warehouse Testing Update - September 13

We fixed the receipt-photo upload that was stopping Marketing from finishing a department request. The fix is live on UAT.

After Warehouse releases your request, open the request, choose **Acknowledge receipt**, attach your receipt photo, and confirm. Use your own requester account. You do not need to switch to a warehouse account or ask Warehouse to issue the items again.

We tested the full department handover on desktop and mobile with fresh sample records. All 30 recorded checks passed. Picking, packing, independent release and receipt acknowledgment completed, and the stock balance was correct. Confirming receipt did not deduct stock a second time. We also checked that unrelated users and unrelated upload paths remain blocked.

The latest layout fixes are live on UAT in build **63a52fc**. Packing messages no longer cover the next-step guidance. Long order references have an expandable section, and a wrong-bin error stays visible above the scan controls. Receipt capture still uses one dialog, and confirmation stays visible when an order moves out of your selected filter. We checked the changed screens on live desktop and mobile.

We reran ecommerce delivery from start to finish on the latest build, with fresh desktop and mobile orders. All 32 recorded checks passed: create, allocate, pick, pack, release by a different operator, record a failed delivery, retry and confirm delivery with a private photo. Each order deducted two units once. Delivery confirmation and repeated submissions did not deduct more stock or create duplicate delivery events. Both runs were uninterrupted; no permissions or process steps were changed to make them pass.

We also completed a clean-stock receiving test on desktop and mobile: receive seven units, have a different operator inspect them, then put them away. Each test finished with seven units in the destination bin and none left in staging. Moving stock before inspection was correctly blocked. Desktop continued from its saved receipt after a test-tool connection failure; mobile ran through without interruption. The test PO was prepared in advance, so this does not count as testing procurement approval.

This is not a full warehouse signoff yet. Returns and replacements, other stock types, receiving exceptions, concurrent work and broader recovery checks still need their dedicated runs. Actual warehouse users and devices also need to complete the floor pilot.

Three improvements have passed local checks but are **not live yet**: opening an attached photo at full size before submitting, keeping long bin names readable, and linking a physical customer return to its original order and return case. The return links preserve unfinished drafts and do not replace inspection or approve a customer resolution. The app build passed, along with focused UI, database and documentation checks. We still need to deploy and verify them on UAT before asking you to retest them.

Please leave records marked **WMS-ECOM** or **WMS-INBOUND** to the development team. Both pairs of completed ecommerce test shipments are now cleaned up, with their four photos archived first and separate database checks confirming removal. One earlier test order is still at Received. The receiving test records are being retained while we finish reviewing the evidence and prepare their cleanup. None represents a real shipment. Your normal sample scenarios remain separate.

The temporary **WMS signoff** records from this department test have now been cleaned up. We archived the four receipt photos first, then removed the exact synthetic records and verified the scoped cleanup. Your existing testing data was outside the deletion scope.

The earlier receipt and fulfillment KB wording is live. New photo-preview and return-link guidance is marked as a pending release in the KB and standalone handbook source. SMTP remains outside this warehouse testing scope.
