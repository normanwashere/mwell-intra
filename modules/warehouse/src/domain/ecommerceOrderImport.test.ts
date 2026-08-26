import { describe, expect, it } from "vitest";
import { buildSeed } from "@intra/data-kit";
import {
  groupEcommerceImportRows,
  parseEcommerceOrderCsv,
} from "./ecommerceOrderImport";

describe("ecommerce order import", () => {
  const products = buildSeed().products;

  it("maps tracker order, customer, payment, delivery, and line data", () => {
    const rows = parseEcommerceOrderCsv(
      [
        "Order No,Date,Channel,customer_reference,Customer,Contact No,Email,Area of Delivery,Address,City,Province,Zip,Payment,Payment Type,Reference #,payment_date,RRN,Maya Method,Maya Status,Event Name,Sales Invoice No,SKU,Remark Variant,Qty,Price,Discount,Shipping Fees,Other Fees,Total Amount,Courier,Delivery Link,Tracking No,Note,Bundle Set Code",
        "SHOP-9001,2026-08-17,Shopee,CUST-90,Ana Reyes,09171234567,ana@example.com,Metro Manila,12 Main St,Pasig,Metro Manila,1600,paid,Maya,PAY-90,2026-08-17,RRN-90,Wallet,Success,Wellness Week,SI-90,SMART-WATCH,Blue,1,2999,100,80,20,16998,LBC,https://track.example/90,WB-90,Leave at reception,OTG-9001",
        "SHOP-9001,2026-08-17,Shopee,CUST-90,Ana Reyes,09171234567,ana@example.com,Metro Manila,12 Main St,Pasig,Metro Manila,1600,paid,Maya,PAY-90,2026-08-17,RRN-90,Wallet,Success,Wellness Week,SI-90,ECG-RING-8,Size 8,1,13999,0,80,20,16998,LBC,https://track.example/90,WB-90,Leave at reception,OTG-9001",
      ].join("\n"),
      products,
      [],
    );

    expect(rows.every((row) => !row.error)).toBe(true);
    expect(groupEcommerceImportRows(rows)).toEqual([
      expect.objectContaining({
        externalReference: "SHOP-9001",
        ecommerceChannel: "Shopee",
        orderDate: "2026-08-17",
        customerName: "Ana Reyes",
        customerContact: "09171234567",
        customerEmail: "ana@example.com",
        deliveryArea: "Metro Manila",
        deliveryAddress: {
          addressLine: "12 Main St",
          city: "Pasig",
          province: "Metro Manila",
          postalCode: "1600",
        },
        paymentStatus: "paid",
        paymentMethod: "Maya",
        paymentReference: "PAY-90",
        paymentDate: "2026-08-17",
        paymentRrn: "RRN-90",
        paymentProviderMethod: "Wallet",
        paymentProviderStatus: "Success",
        campaignName: "Wellness Week",
        salesInvoiceNumber: "SI-90",
        shippingFee: 80,
        otherFees: 20,
        reportedTotalAmount: 16998,
        courier: "LBC",
        deliveryLink: "https://track.example/90",
        waybillNumber: "WB-90",
        orderNotes: "Leave at reception",
        lines: [
          expect.objectContaining({
            productId: "smart-watch",
            quantity: 1,
            variant: "Blue",
            unitPrice: 2999,
            discountAmount: 100,
            bundleSetCodes: ["OTG-9001"],
          }),
          expect.objectContaining({
            productId: "ecg-ring-8",
            quantity: 1,
            variant: "Size 8",
          }),
        ],
      }),
    ]);
  });

  it("blocks unpaid, incomplete, duplicate, and inconsistent tracker rows", () => {
    const rows = parseEcommerceOrderCsv(
      [
        "order_reference,channel,customer_name,customer_contact,delivery_address,city,province,postal_code,payment_status,product_sku,quantity",
        "SHOP-DUP,Shopee,Ana,0917,12 Main,Pasig,NCR,1600,pending,SMART-WATCH,1",
        "SHOP-MISSING,Shopee,Ana,0917,,Pasig,NCR,1600,paid,UNKNOWN,0",
        "SHOP-MIX,Shopee,Ana,0917,12 Main,Pasig,NCR,1600,paid,SMART-WATCH,1",
        "SHOP-MIX,Lazada,Ana,0917,12 Main,Pasig,NCR,1600,paid,ECG-RING-8,1",
      ].join("\n"),
      products,
      ["shop-dup"],
    );

    expect(rows[0]?.error).toMatch(/already exists.*payment status/i);
    expect(rows[1]?.error).toMatch(
      /delivery address.*SKU was not found.*quantity/i,
    );
    expect(rows[2]?.error).toMatch(/inconsistent channel/i);
    expect(rows[3]?.error).toMatch(/inconsistent channel/i);
  });

  it("blocks inconsistent order headers and invalid commercial values", () => {
    const rows = parseEcommerceOrderCsv(
      [
        "order_reference,order_date,channel,customer_name,customer_contact,customer_email,delivery_address,city,province,postal_code,payment_status,product_sku,quantity,unit_price,discount_amount,shipping_fee,other_fees,reported_total_amount,delivery_link",
        "SHOP-MIXED,not-a-date,Shopee,Ana,0917,not-an-email,12 Main,Pasig,NCR,1600,paid,SMART-WATCH,1,-1,4000,-50,-1,-20,invalid",
        "SHOP-MIXED,2026-08-17,Shopee,Bea,0918,bea@example.com,99 Main,Pasig,NCR,1600,paid,ECG-RING-8,1,13999,0,80,0,13999,https://track.example/2",
      ].join("\n"),
      products,
      [],
    );

    expect(rows[0]?.error).toMatch(
      /inconsistent order details.*order date.*email.*unit price.*discount.*shipping fee.*other fees.*total amount.*delivery link/i,
    );
    expect(rows[1]?.error).toMatch(/inconsistent order details/i);
  });

  it("rejects insecure ecommerce tracking links", () => {
    const [row] = parseEcommerceOrderCsv(
      [
        "order_reference,channel,customer_name,customer_contact,delivery_address,city,province,postal_code,payment_status,product_sku,quantity,delivery_link",
        "SHOP-HTTP,Shopee,Ana,0917,12 Main,Pasig,NCR,1600,paid,SMART-WATCH,1,http://deliverylink.com/WB-001",
      ].join("\n"),
      products,
      [],
    );

    expect(row?.error).toMatch(/secure https/i);
  });
});
