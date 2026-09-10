# September 9 WMS Feedback: Fixes And Tester Instructions

This responds to the September 9 comments on pages 1-5 of `wms comments (6).pdf`. Updated September 10, 2026.

## The Short Answer

**The code changes are now live on UAT.** Revision `044ee26` was promoted on September 10 at 14:32 UTC (22:32 Singapore/Philippines), together with both database updates. Operations Associate sign-in, returns guidance, receiving validation and desktop/mobile receiving layout were checked on the live site. This is a deployment smoke check, not completion of every transaction scenario.

The rejected Jacket-S barcode still needs the reported label matched to its PO: the live product table was checked, and `MW-JCKT-333354` is not registered. We improved the error message but did not guess or replace the product mapping. Stock holds and missing historical customer details need record-specific follow-up; they cannot be fixed by bypassing checks or guessing information.

Existing tester data has not been deleted or rewritten.

## What We Changed And How To Continue

The instructions below describe the update now available at https://mwell-intra-uat.vercel.app. If an existing tab shows **A new version is available**, use its **Reload** button before retesting.

### 1. What Does Exception Reason Mean?

It means something was wrong with the delivery, not that you are asking for an exemption. We added clearer wording and examples in receiving.

For example, enter "Received 8 of 10 items; 2 missing" for a shortage, or describe the damage you found. If everything arrived correctly, you do not need to make up an exception reason. The check remains for deliveries with actual problems.

**Resolution: clearer instructions in the form; no removal of receiving checks.**

### 2. Receiving Takes Too Much Space, And The Buttons Are Hard To Follow

We made the missing-information list compact and expandable. Selecting an item takes you to the field that needs attention. Save progress and Confirm now sit together on desktop and stack on mobile.

Use **Save progress** when you are not finished. Use **Confirm** when the receipt is complete and ready to record. Saving a draft does not add stock to inventory.

**Resolution: layout and navigation changed in code; now deployed to UAT.**

### 3. Why Is The Jacket-S Barcode Rejected?

We changed the message to show which product and mapped barcode the app expects. It still rejects a code for the wrong size or product.

**The specific code `MW-JCKT-333354` is not resolved yet.** It is absent from the live UAT product barcode table. The sample Jacket-S records use set-specific codes, such as `MWUAT-SEP07-JACKET-S` and `MWUAT-SEP08-TESTER1-JACKET-S`. We still need the reported PO and physical label to establish which mapping should apply. A better error message is not a correction to that mapping.

For this item, please provide the PO number, exact line/size, scanned value and a photo of the label if those are not already available in the report. We can then determine whether the product mapping needs correction or the label belongs to a different item. Do not use another size's barcode just to continue.

### 4. I Scanned The Wrong Serial During Relocation

We added a removal control beside each selected serial. You can remove just the wrong one without restarting the entire move, and scan it again if needed.

**Resolution: individual scan correction added; now deployed to UAT.**

### 5. My Relocation Progress Disappeared

The app now keeps a draft for that product and your account in the same browser. Reopen the move to continue, or choose **Resume draft** after refreshing. Use **Discard** when you intentionally want to start over. An outdated draft is flagged for review.

This is browser-local recovery, not syncing between devices or accounts.

**Resolution: draft recovery added and locally tested, including refresh and resume.**

### 6. Why Can I Not Move Stock That Is On Hold?

The hold should still stop the move. We improved the checks and message so the app explains the blocker and keeps your relocation draft instead of leaving you to start again.

The person responsible for Quality needs to review that exact unit or lot and record the appropriate outcome. Being in General area does not mean the stock passed inspection. You can remove the held serial from your selection and continue with eligible units.

**Resolution: better handling of the block, not automatic release of held stock.** If the hold appears wrong, send the receipt reference and serial or lot so the correct record can be reviewed.

### 7. Why Am I Seeing Another Account's Sync Conflict?

We corrected how pending work is separated by account. The current user should only see and act on their own pending items. Switching accounts also stops the remaining queued work from continuing under the wrong account.

Older saved items with no recorded owner need a separate check. The administrator must compare them with the actual receipt or movement history before anyone retries or clears them. Otherwise, a move that already succeeded could be submitted twice. We have not deleted those items or assigned them to whichever account happens to be signed in.

**Resolution: account separation fixed in code. Any older unowned work still needs reconciliation.**

### 8. I Cannot See All Serials In A Bin

Selecting the bin count now filters the serial list to that bin. We also added **Load more**, so the list no longer stops at the first 30 units. You can use the bin and text filters together.

**Resolution: bin filtering and access to the remaining serials added; now deployed to UAT.**

### 9. It Says Evidence Is Attached, But Where Is The Delivery Photo?

We changed Order details to display saved proof images, including evidence saved in the order history. We also fixed the photo viewer so you can close the preview and return to the order on desktop and mobile.

Include completed orders in your filter, open the order, then open its proof photo. If the file is missing or cannot be accessed, the app should say so. This fix cannot recreate a photo that was never saved.

**Resolution: viewing and closing saved evidence fixed locally. Actual uploaded files still need verification on UAT.**

### 10. Where Do The Replacement Customer And Address Come From?

The replacement flow now shows the original order and return reference. You choose whether to use the original delivery details or enter a new destination. A new destination requires a reason, and incomplete delivery details are blocked before submission.

The replacement saves its own confirmed destination without changing the original order. We also fixed a retry issue that could reopen a closed case and record a second return movement.

**Resolution: replacement details and retry handling fixed in code; database update and UAT rollout complete.** Older orders with missing addresses still need the customer's confirmed destination. We have not filled them with guessed details.

### 11. Who Should Acknowledge Receipt? Can They Attach A Photo?

Release and acknowledgment are separate actions. The person releasing the goods must not acknowledge their own handover. We added acceptance-evidence upload and corrected the action access so an eligible requester can acknowledge without receiving pick, pack or release permissions.

For an internal, event or third-party handover, the eligible requester or an authorized person other than the releaser can record acceptance and attach evidence. For a courier shipment, use **Update delivery** with proof instead; handover acknowledgment must not bypass delivery proof.

**Resolution: evidence upload and access handling changed; database update and UAT rollout complete.** One rule needs to be explicit: the current system allows an authorized person to record acceptance on the recipient's behalf. If Legal or Operations requires only the named recipient to sign personally, that is a further policy and identity-check change, not something already implemented.

### 12. Should I Use Allocation Return Or Returns Receiving?

We added guidance where you make this choice:

- **Returning items issued for an event or allocation:** start from that issued allocation and use its linked return flow. Do not enter the same physical return again as a separate receipt.
- **Receiving returned stock for inspection:** Returns receiving records the physical intake into inspection staging; it is not a shortcut around an existing allocation return.
- **Customer refund or replacement:** use the customer return case and the unit's original serial number. If the serial is already in your current scan list, there is no need to scan it again or create a new serial.

**Resolution: clearer in-app routing instructions. These remain distinct processes, not two entries required for the same return.**

## What We Still Need From The Tester

You do not need to re-explain the layout, missing controls or lost-progress reports. We had enough information to implement those changes.

The main unresolved fact is the **Jacket-S label and its matching PO line**. A record reference is also needed if a particular hold looks incorrect. For an old order without a delivery address, the destination must come from the customer or a verified order record.

Separately, Operations or Legal can confirm whether acceptance may be recorded on a recipient's behalf. The existing rule remains in place unless that policy is changed.

Please share only the relevant record details, not passwords or a full customer list.

## What Happens Next

**The deployment is complete. The remaining work is transaction retesting and the record-specific follow-up below.**

1. Completed: both database changes and the matching app are on UAT. Production was not changed.
2. Repeat the reported receiving, relocation, account-switching, inventory, delivery-photo, replacement and acknowledgment scenarios on UAT, on desktop and mobile. Check the saved records after reload, not just the success message.
3. The live barcode lookup is complete. Match the reported label to its PO before deciding whether the mapping needs correction.
4. Testers can now retry the updated flows. Keep any remaining failure tied to its PO/order, exact step and screenshot; the deployment does not close an untested transaction automatically.

For the deployment team, the installed migrations are `20260910133142_replacement_delivery_confirmation.sql` and `20260910140118_fulfillment_handover_acknowledgment_guard.sql`. They do not repair historical orders automatically.

**Bottom line: the update is live and ready for tester use, but the feedback is not fully closed.** Full live transaction retesting, the physical-label match, uploaded delivery evidence and real recipient acceptance remain separate checks. The deployment smoke checks did not consume seeded stock.
