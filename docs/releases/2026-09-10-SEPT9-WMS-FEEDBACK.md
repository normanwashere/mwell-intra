# September 9 WMS Feedback: Fixes And Tester Instructions

Hi team,

We've reviewed your September 9 feedback and released the updates to [live UAT](https://mwell-intra-uat.vercel.app). Thanks for pointing out where you were getting stuck. Several items needed changes in the app, not just additional instructions.

## The Short Answer

**You can retry the updated flows now.** If you see **A new version is available**, click **Reload** first. Your sample products, POs and orders are still available; we did not delete your test data or use up stock during the deployment checks.

We checked sign-in, receiving validation, the receiving layout on desktop and mobile, the return instructions and access to Pick & Pack on UAT. We also ran automated checks before deployment. We have not yet repeated every complete transaction on the live version, so we're keeping those checks open.

The Jacket-S barcode is the main item we still need your help with. Details are below.

## What We Changed And How To Continue

### 1. What Does Exception Reason Mean?

We clarified this in the receiving form. It means there is an issue with the delivery, such as missing, damaged, excess or unidentified items. It is not a request for an exemption.

For example, you can enter **"Received 8 of 10 items; 2 missing."** If the delivery is complete and correct, you do not need to enter an exception reason.

### 2. Receiving Takes Too Much Space, And The Buttons Are Hard To Follow

We made the list of missing requirements smaller and expandable. Click a requirement to go straight to the field you need to complete. We also placed the action buttons together on desktop and stacked them on mobile.

Use **Save progress** if you need to finish later. Use **Confirm governed receipt** when you're ready to record the receipt. Saving progress alone does not add stock.

Please try reopening the same PO and check whether the revised layout is easier to follow.

### 3. Why Is The Jacket-S Barcode Rejected?

**This specific barcode is still open.** We checked UAT and found that `MW-JCKT-333354` is not registered in the product barcode table. The sample Jacket-S products have different codes depending on the test set.

We updated the rejection message to show the product and barcode the app expects. However, we have not changed the product's barcode, because we still need to match your label to the correct PO line.

Please send us the **PO number, item/size and a clear photo of the barcode label** you scanned. We already have the reported value, `MW-JCKT-333354`; let us know if your latest scan produces something different. We'll use those details to determine whether the mapping needs correcting. Please don't scan a different size's barcode just to get past the check.

### 4. I Scanned The Wrong Serial During Relocation

You can now remove an individual serial from the relocation list without starting over.

Please try scanning two units, removing one, and checking that only the intended unit remains selected. You can scan a removed serial again if you need to add it back.

### 5. My Relocation Progress Disappeared

We added draft recovery. You can close and reopen the relocation form to continue your work. After refreshing, choose **Resume draft**. Choose **Discard** only when you want to start again.

Please use the **same account and browser on the same device**. These drafts do not transfer between devices or accounts. The app will flag an outdated draft so you can review it before moving stock.

### 6. Why Can I Not Move Stock That Is On Hold?

Stock on hold should remain blocked until Quality reviews it. We improved the message and kept your relocation draft so the block doesn't force you to redo your work.

If only one selected unit is held, remove that serial and continue with the eligible units. Ask the person handling Quality to review the held unit or lot. **General area** is a storage location, not confirmation that inspection passed.

If the hold looks incorrect, send us the receipt reference and affected serial or lot. We'll investigate the record; we haven't removed holds automatically.

### 7. Why Am I Seeing Another Account's Sync Conflict?

We fixed the account separation for pending work and sync conflicts. You should only see and act on your own pending items. Switching accounts also stops the remaining queued work from running under the wrong account.

Older saved work without an identified owner still needs checking. If you see that warning, send us a screenshot, the account you were using and the approximate time of the operation. We'll help coordinate a check against the receipt or movement history before it is retried or cleared. Please don't resubmit the move just to remove the warning, because it may have already been recorded.

### 8. I Cannot See All Serials In A Bin

Clicking a bin count now filters the serial list to that bin. We also added **Load more** so you can view units beyond the first 30.

Please select a bin, check its serials, and use **Load more** where available. You can combine this with the text search and clear the bin filter when you want to see other bins.

### 9. It Says Evidence Is Attached, But Where Is The Delivery Photo?

We updated Order details to show saved proof images, including evidence in the order history. We also fixed the photo viewer so you can close the image and return to the order.

Please include **Completed** orders in the status filter, open the order details, and try opening its proof photo.

If an image is still unavailable, send us the order reference and a screenshot of the message. We'll check that specific saved file. The viewer fix cannot recover a photo that was never uploaded or saved.

### 10. Where Do The Replacement Customer And Address Come From?

The replacement flow now shows the original order and return reference. You can choose the original delivery details or enter a new destination. A new destination requires a reason, and the form checks for complete delivery information.

Please review the customer's details before submitting, then reopen the replacement order to check that the destination was saved correctly. The original order is not overwritten.

We also fixed an issue where retrying a closed return case could record a duplicate return movement. For older orders with no address, you still need a customer-confirmed destination; we haven't filled missing addresses with assumed information.

### 11. Who Should Acknowledge Receipt? Can They Attach A Photo?

Yes, you can now attach evidence when recording acceptance. We also corrected access so an eligible requester can acknowledge the handover without needing pick, pack or release permissions.

The person who releases the goods cannot acknowledge their own handover. For an internal, event or third-party handover, use the eligible requester or another authorized person to record acceptance. For courier shipments, use **Update delivery** and attach delivery proof instead.

One point we'd like you to confirm with Operations or Legal: **may an authorized person record acceptance on the recipient's behalf, or must the named recipient do it personally?** The app currently allows an authorized person other than the releaser to record it. We have not introduced a recipient-only signature rule.

### 12. Should I Use Allocation Return Or Returns Receiving?

We've added guidance in the app to make this clearer.

- **Returning stock from an event allocation:** open the original issued allocation and use its linked return flow.
- **Recording physical return intake for inspection:** use Returns receiving where the return is not already being recorded through its allocation.
- **Processing a customer refund or replacement:** use the customer return case in Fulfillment. Receiving the physical item does not itself approve a refund or replacement.

Please don't record the same physical return in both Allocation Return and Returns receiving. Use the item's existing serial number. If it is already in your current scan list, you don't need to scan it again or create a new serial.

## What We Still Need From You

You don't need to explain the original layout or missing-button reports again. We have addressed those in the update.

Please help us with these specific items:

- **Jacket-S:** the PO number, item/size and barcode-label photo.
- **A hold or sync warning that still looks wrong:** the record reference and a screenshot, plus the account and approximate time for a sync issue.
- **Acknowledgment:** confirmation from Operations or Legal on whether acceptance can be recorded on the recipient's behalf.

For a replacement with missing historical delivery details, please use the destination confirmed by the customer. You don't need to send a full customer list or any passwords.

## What Happens Next

We've also prepared clearer error messages after the PO 0001 and MW-PWR-0002 reports. That wording update is not live yet. For PO 0001, the receiving issue needs an independent Warehouse Supervisor's decision under Receive and inspect > Controlled receipt decisions; don't receive those units again. MW-PWR-0002 is waiting for inspection, not automatically marked damaged. An authorized person other than the receiver should inspect it under Quality Control > Pending. Other held units need the warehouse supervisor's review. You can remove a held unit from your move selection and continue with eligible units without removing the hold itself.

Please retry the flows you reported using your existing UAT records. For anything you submit, reopen the record afterward to check that the details were saved, rather than relying only on the success message.

If you're still blocked, send us the **PO/order reference, the account used, the last step you completed and a screenshot of the error**. We'll investigate from that exact point so you don't have to describe the whole process again.

We'll continue the remaining live transaction checks on our side. The update is available now, but we're keeping the barcode match and unverified transaction outcomes open rather than marking the entire report resolved.

Development Team

Updated September 10, 2026. Covers the September 9 comments on pages 1-5 of `wms comments (6).pdf`.
