# Warehouse Testing Update - September 13

We fixed the receipt-photo upload that was stopping Marketing from finishing a department request. The fix is live on UAT.

After Warehouse releases your request, open the request, choose **Acknowledge receipt**, attach your receipt photo, and confirm. Use your own requester account. You do not need to switch to a warehouse account or ask Warehouse to issue the items again.

We tested the full department handover on desktop and mobile with fresh sample records. All 30 recorded checks passed. Picking, packing, independent release and receipt acknowledgment completed, and the stock balance was correct. Confirming receipt did not deduct stock a second time. We also checked that unrelated users and unrelated upload paths remain blocked.

The latest layout fixes are live on UAT in build **63a52fc**. Packing messages no longer cover the next-step guidance. Long order references have an expandable section, and a wrong-bin error stays visible above the scan controls. Receipt capture still uses one dialog, and confirmation stays visible when an order moves out of your selected filter. We checked the changed screens on live desktop and mobile.

We reran ecommerce delivery from start to finish on the latest build, with fresh desktop and mobile orders. All 32 recorded checks passed: create, allocate, pick, pack, release by a different operator, record a failed delivery, retry and confirm delivery with a private photo. Each order deducted two units once. Delivery confirmation and repeated submissions did not deduct more stock or create duplicate delivery events. Both runs were uninterrupted; no permissions or process steps were changed to make them pass.

This is not a full warehouse signoff yet. Receiving and putaway, returns and replacements, other stock types, concurrent work and broader recovery checks still need their dedicated runs. Actual warehouse users and devices also need to complete the floor pilot.

Please leave records marked **WMS-ECOM** to the development team. We have cleaned up the older pair of completed test shipments and archived their two delivery photos. A separate database check confirmed no records or photos remain for that batch. One earlier test order is still at Received; the newest pair of completed test shipments and their photos still need cleanup. None represents a real shipment. Your normal sample scenarios remain separate.

The temporary **WMS signoff** records from this department test have now been cleaned up. We archived the four receipt photos first, then removed the exact synthetic records and verified the scoped cleanup. Your existing testing data was outside the deletion scope.

The KB wording is live and the standalone manual has been updated. SMTP remains outside this warehouse testing scope.
