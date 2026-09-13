# Warehouse Testing Update - September 13

We fixed the receipt-photo upload that was stopping Marketing from finishing a department request. The fix is live on UAT.

After Warehouse releases your request, open the request, choose **Acknowledge receipt**, attach your receipt photo, and confirm. Use your own requester account. You do not need to switch to a warehouse account or ask Warehouse to issue the items again.

We tested the full department handover on desktop and mobile with fresh sample records. All 30 recorded checks passed. Picking, packing, independent release and receipt acknowledgment completed, and the stock balance was correct. Confirming receipt did not deduct stock a second time. We also checked that unrelated users and unrelated upload paths remain blocked.

This is not a full warehouse signoff yet. Receiving and putaway, ecommerce delivery, returns and replacements, concurrent work, and recovery checks still need their dedicated runs. The mobile notices and overlapping receipt dialogs are fixed in the local candidate. Confirmation also stays visible when an order moves out of your selected filter. The final candidate passed 24 browser checks across six screen sizes and 153 fulfillment tests; those layout changes still need deployment and live retesting.

The temporary **WMS signoff** records from this department test have now been cleaned up. We archived the four receipt photos first, then removed the exact synthetic records and verified the scoped cleanup. Your existing testing data was outside the deletion scope.

The standalone manual has been updated locally. The matching KB wording is prepared but still needs the next app deployment. SMTP remains outside this warehouse testing scope.
