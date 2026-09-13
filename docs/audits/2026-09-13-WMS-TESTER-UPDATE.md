# Warehouse Testing Update - September 13

We fixed the receipt-photo upload that was stopping Marketing from finishing a department request. The fix is live on UAT.

After Warehouse releases your request, open the request, choose **Acknowledge receipt**, attach your receipt photo, and confirm. Use your own requester account. You do not need to switch to a warehouse account or ask Warehouse to issue the items again.

We tested the full department handover on desktop and mobile with fresh sample records. All 30 recorded checks passed. Picking, packing, independent release and receipt acknowledgment completed, and the stock balance was correct. Confirming receipt did not deduct stock a second time. We also checked that unrelated users and unrelated upload paths remain blocked.

The layout fixes are now live on UAT in build **75e733b**. Picking confirmations no longer cover the form, receipt capture uses one dialog, and confirmation stays visible when an order moves out of your selected filter. The release passed 24 local browser checks across six screen sizes, 153 fulfillment tests and six live desktop/mobile screen checks.

We also completed ecommerce delivery on live UAT at desktop and mobile sizes: create order, allocate, pick, pack, release by a different operator, record a failed delivery, retry and confirm delivery with a private photo. Each order deducted two units once, with no extra deduction when delivery was confirmed. Repeated submissions did not create duplicate delivery events. The desktop test resumed from its saved release step after we corrected an audit-label assertion in the test; mobile ran from start to finish without interruption. No permissions or process steps were changed to make the tests pass.

This is not a full warehouse signoff yet. Receiving and putaway, returns and replacements, other stock types, concurrent work and broader recovery checks still need their dedicated runs. We also fixed two mobile layout issues locally: the packing message covering the next-step guidance, and long order references crowding the pick form. Those changes passed 158 fulfillment tests and 30 browser checks, but are not yet live.

Please leave records marked **WMS-ECOM** to the development team. One earlier test order is still at Received, and the two completed test shipments and their photos are awaiting controlled cleanup. None represents a real shipment. Your normal sample scenarios remain separate.

The temporary **WMS signoff** records from this department test have now been cleaned up. We archived the four receipt photos first, then removed the exact synthetic records and verified the scoped cleanup. Your existing testing data was outside the deletion scope.

The KB wording is live and the standalone manual has been updated. SMTP remains outside this warehouse testing scope.
