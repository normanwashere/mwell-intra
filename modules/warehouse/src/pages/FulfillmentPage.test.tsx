import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildSeed } from "@intra/data-kit";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

describe("FulfillmentPage", () => {
  it("presents the four cross-department queues and their handoffs", async () => {
    renderWithProviders(<FulfillmentPage />, { role: "operations" });

    expect(
      await screen.findByRole("heading", { name: "Fulfillment" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Orders and events" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Department requests" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Return cases" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Kits and re-kits" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sales, Operations, or Marketing"),
    ).toBeInTheDocument();
    expect(screen.getByText("Warehouse operator")).toBeInTheDocument();
  });

  it("lets a warehouse operator begin fulfillment without exposing setup controls", async () => {
    const repo = makeRepo();
    await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-2201",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "sales@mwell.com.ph",
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });

    expect(
      await screen.findByRole("heading", { name: "Pick & Pack" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Department requests" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Return cases" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Waiting allocation")).toBeInTheDocument();
    expect(screen.getAllByText("Picking").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Packing").length).toBeGreaterThan(0);
    const order = await screen.findByRole("listitem", { name: /SHOP-2201/i });
    expect(within(order).getByText("Received")).toBeInTheDocument();
    await user.click(
      within(order).getByRole("button", { name: "Allocate stock" }),
    );

    await waitFor(() => {
      expect(within(order).getByText("Allocated")).toBeInTheDocument();
    });
    expect(
      within(order).getByRole("button", { name: "Start picking" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New fulfillment demand" }),
    ).not.toBeInTheDocument();
  });

  it("gives an idle warehouse operator a clear pick-and-pack queue state", async () => {
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
    });

    expect(
      await screen.findByRole("heading", { name: "Pick & Pack" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No orders ready to pick")).toBeInTheDocument();
    expect(
      screen.getByText(/orders will appear here for scanning and packing/i),
    ).toBeInTheDocument();
  });

  it("uses an accountable handover and waits for a second operator to release", async () => {
    const repo = makeRepo();
    const created = await repo.createFulfillmentOrder({
      source: "department_request",
      externalReference: "REQ-MKT-2201",
      requestingDepartment: "marketing",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "doctor-token", quantity: 1 }],
      actor: "marketing@mwell",
    });
    for (const action of ["allocate", "start_picking"] as const) {
      await repo.advanceFulfillmentOrder({
        orderId: created.id,
        action,
        actor: "warehouse_operator@mwell",
      });
    }
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "confirm_pick",
      actor: "warehouse_operator@mwell",
      pickedLines: [{ productId: "doctor-token", quantity: 1 }],
    });

    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });
    const order = await screen.findByRole("listitem", {
      name: /REQ-MKT-2201/i,
    });
    await user.click(
      within(order).getByRole("button", {
        name: "Prepare accountable handover",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Pack order.*REQ-MKT-2201/i,
    });
    expect(within(dialog).queryByLabelText("Courier")).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText("Recipient name"),
      "Maya Santos",
    );
    await user.type(
      within(dialog).getByLabelText("Recipient department"),
      "Marketing",
    );
    await user.type(
      within(dialog).getByLabelText("Handover reference"),
      "HO-2201",
    );
    await user.type(
      within(dialog).getByLabelText("Handover evidence URL"),
      "https://evidence.example/ho-2201.jpg",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm packing" }),
    );

    expect(
      await within(order).findByText(
        "Awaiting release by a second warehouse operator.",
      ),
    ).toBeInTheDocument();
    expect(
      within(order).queryByRole("button", { name: "Release handover" }),
    ).not.toBeInTheDocument();
  });

  it("lets Operations record third-party event sales demand", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "operations", repo });

    await user.click(
      await screen.findByRole("button", { name: "New order / demand" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Create order or fulfillment demand",
    });
    expect(
      within(dialog).getByRole("option", { name: "Ecommerce customer order" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: "Small Shipping Box" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("option", { name: "Warehouse Cutter" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      within(dialog).getByLabelText("Demand source"),
      "third_party",
    );
    await user.type(
      within(dialog).getByLabelText("Order reference"),
      "EVENT-SALE-2201",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Event"),
      "evt-makati",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Third-party inventory location"),
      "loc-event-makati",
    );
    await user.type(within(dialog).getByLabelText("Gross sales (PHP)"), "8640");
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "smart-watch",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create demand" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).fulfillmentOrders).toEqual([
        expect.objectContaining({
          source: "third_party",
          eventId: "evt-makati",
          grossSalesAmount: 8640,
        }),
      ]);
    });
    expect(await screen.findAllByText("PHP 8,640.00")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Allocate stock" }),
    ).not.toBeInTheDocument();
  }, 10_000);

  it("validates and imports a grouped ecommerce order list", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "operations", repo });

    await user.click(
      await screen.findByRole("button", { name: "Import existing tracker" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Import ecommerce order list",
    });
    const csv = [
      "order_reference,order_date,channel,customer_reference,customer_name,customer_contact,delivery_address,city,province,postal_code,payment_status,payment_method,product_sku,quantity,bundle_set_codes",
      "SHOP-CSV-01,2026-08-17,Shopee,CUST-01,Ana Reyes,09170000001,12 Main St,Pasig,Metro Manila,1600,paid,Maya,SMART-WATCH,1,OTG-001",
      "SHOP-CSV-01,2026-08-17,Shopee,CUST-01,Ana Reyes,09170000001,12 Main St,Pasig,Metro Manila,1600,paid,Maya,ECG-RING-8,1,OTG-001",
      "SHOP-CSV-02,2026-08-17,eShop,CUST-02,Ben Cruz,09170000002,45 High St,Taguig,Metro Manila,1630,cod,COD,SMART-WATCH,2,",
    ].join("\n");
    await user.upload(
      within(dialog).getByLabelText("Upload ecommerce order list"),
      new File([csv], "orders.csv", { type: "text/csv" }),
    );

    expect(await within(dialog).findAllByText("SHOP-CSV-01")).toHaveLength(2);
    await user.click(
      within(dialog).getByRole("button", { name: "Import 2 order(s)" }),
    );

    await waitFor(async () => {
      const orders = (await repo.getData()).fulfillmentOrders;
      expect(orders).toHaveLength(2);
      expect(
        orders.find((order) => order.externalReference === "SHOP-CSV-01")
          ?.lines,
      ).toHaveLength(2);
      expect(
        orders.find((order) => order.externalReference === "SHOP-CSV-01"),
      ).toMatchObject({
        ecommerceChannel: "Shopee",
        customerName: "Ana Reyes",
        paymentStatus: "paid",
      });
    });
  });

  it("captures a complete multi-line ecommerce order without a tracker", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "operations", repo });

    await user.click(
      await screen.findByRole("button", { name: "New order / demand" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Create order or fulfillment demand",
    });
    await user.type(
      within(dialog).getByLabelText("Order reference"),
      "WEB-2201",
    );
    await user.type(within(dialog).getByLabelText("Sales channel"), "Shopify");
    await user.type(
      within(dialog).getByLabelText("Campaign / event name"),
      "Wellness Week",
    );
    await user.type(
      within(dialog).getByLabelText("Customer name"),
      "Ana Reyes",
    );
    await user.type(
      within(dialog).getByLabelText("Contact number"),
      "09171234567",
    );
    await user.type(
      within(dialog).getByLabelText("Street address"),
      "12 Main Street",
    );
    await user.type(within(dialog).getByLabelText("City"), "Pasig");
    await user.type(within(dialog).getByLabelText("Province"), "Metro Manila");
    await user.type(within(dialog).getByLabelText("Postal code"), "1600");
    await user.type(
      within(dialog).getByLabelText("Area of delivery"),
      "Metro Manila",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "smart-watch",
    );
    await user.type(within(dialog).getByLabelText("Unit price"), "2999");
    await user.type(within(dialog).getByLabelText("Line discount"), "100");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[1]!,
      "ecg-ring-8",
    );
    await user.type(
      within(dialog).getAllByLabelText("Unit price")[1]!,
      "13999",
    );
    await user.type(
      within(dialog).getByLabelText("Payment reference"),
      "PAY-2201",
    );
    await user.type(
      within(dialog).getByLabelText("Payment date"),
      "2026-08-17",
    );
    await user.type(within(dialog).getByLabelText("RRN"), "RRN-2201");
    await user.type(within(dialog).getByLabelText("Provider method"), "Wallet");
    await user.type(within(dialog).getByLabelText("Shipping fee"), "80");
    await user.type(within(dialog).getByLabelText("Other fees"), "20");
    await user.type(within(dialog).getByLabelText("Courier"), "LBC");
    await user.type(
      within(dialog).getByLabelText("Tracking / waybill number"),
      "WB-2201",
    );
    await user.type(
      within(dialog).getByLabelText("Delivery tracking link"),
      "https://track.example/WB-2201",
    );
    await user.type(
      within(dialog).getByLabelText("Order instructions"),
      "Leave at reception",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create order" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).fulfillmentOrders[0]).toMatchObject({
        externalReference: "WEB-2201",
        ecommerceChannel: "Shopify",
        customerName: "Ana Reyes",
        deliveryArea: "Metro Manila",
        paymentReference: "PAY-2201",
        paymentDate: "2026-08-17",
        paymentRrn: "RRN-2201",
        paymentProviderMethod: "Wallet",
        campaignName: "Wellness Week",
        shippingFee: 80,
        otherFees: 20,
        courier: "LBC",
        waybillNumber: "WB-2201",
        deliveryLink: "https://track.example/WB-2201",
        orderNotes: "Leave at reception",
        lines: [
          expect.objectContaining({ productId: "smart-watch", quantity: 1 }),
          expect.objectContaining({ productId: "ecg-ring-8", quantity: 1 }),
        ],
      });
    });
  }, 15_000);

  it("requires a bin scan and records the directed pick location", async () => {
    const seed = buildSeed();
    const unit = seed.units.find(
      (candidate) => candidate.serialNumber === "SMART-WATCH-SN0001",
    )!;
    unit.binId = "bin-pasig-a1";
    const repo = makeRepo(seed);
    await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-DIRECTED-01",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "sales@mwell.com.ph",
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });
    const order = await screen.findByRole("listitem", {
      name: /SHOP-DIRECTED-01/i,
    });
    await user.click(
      within(order).getByRole("button", { name: "Allocate stock" }),
    );
    await user.click(
      await within(order).findByRole("button", { name: "Start picking" }),
    );
    await user.click(
      await within(order).findByRole("button", {
        name: "Confirm scanned pick",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Confirm pick.*SHOP-DIRECTED-01/i,
    });
    expect(within(dialog).getByText(/Aisle A.*Rack 01/i)).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText(/Scanned bin code.*Smart Watch/i),
      "PASIG-A-01",
    );
    await user.type(
      within(dialog).getByLabelText(/Scanned serial numbers.*Smart Watch/i),
      "SMART-WATCH-SN0001",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm pick" }),
    );

    await waitFor(async () => {
      expect(
        (await repo.getData()).fulfillmentOrders[0]?.lines[0],
      ).toMatchObject({
        pickBinId: "bin-pasig-a1",
      });
    });
  });

  it("records every packaging material consumed by one shipment", async () => {
    const repo = makeRepo();
    const created = await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-PACK-02",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "sales@mwell.com.ph",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "allocate",
      actor: "allocator@mwell.com.ph",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "start_picking",
      actor: "picker@mwell.com.ph",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "confirm_pick",
      actor: "picker@mwell.com.ph",
      pickedLines: [
        {
          productId: "smart-watch",
          quantity: 1,
          serialNumbers: ["SMART-WATCH-SN0001"],
        },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });
    const order = await screen.findByRole("listitem", {
      name: /SHOP-PACK-02/i,
    });
    await user.click(
      within(order).getByRole("button", { name: "Pack and add waybill" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Pack order.*SHOP-PACK-02/i,
    });
    await user.type(within(dialog).getByLabelText("Courier"), "LBC");
    await user.type(within(dialog).getByLabelText("Waybill number"), "WB-02");
    await user.type(
      within(dialog).getByLabelText("Delivery tracking link"),
      "https://track.example/WB-02",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Packaging supply 1"),
      "pack-small-box",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add another supply" }),
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Packaging supply 2"),
      "pack-label",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm packing" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).fulfillmentOrders[0]?.packaging).toEqual([
        { productId: "pack-small-box", quantity: 1 },
        { productId: "pack-label", quantity: 1 },
      ]);
    });
  });

  it("shows a fulfillment-safe ecommerce order record and shipment timeline", async () => {
    const repo = makeRepo();
    await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-DETAIL-01",
      ecommerceChannel: "Shopee",
      orderDate: "2026-08-17",
      customerName: "Ana Reyes",
      customerContact: "09171234567",
      customerEmail: "ana.reyes@example.com",
      deliveryAddress: {
        addressLine: "12 Main Street",
        city: "Pasig",
        province: "Metro Manila",
        postalCode: "1600",
      },
      paymentStatus: "paid",
      paymentMethod: "Maya",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1, variant: "Blue" }],
      actor: "sales@mwell.com.ph",
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });
    const order = await screen.findByRole("listitem", {
      name: /SHOP-DETAIL-01/i,
    });
    expect(within(order).getByText(/Shopee/i)).toBeInTheDocument();
    await user.click(
      within(order).getByRole("button", { name: "View order details" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Order details.*SHOP-DETAIL-01/i,
    });
    expect(within(dialog).getByText("Ana Reyes")).toBeInTheDocument();
    expect(within(dialog).getByText(/0917.*567/)).toBeInTheDocument();
    expect(within(dialog).getByText(/a\*+@example.com/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/12 Main Street.*Pasig/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Blue/)).toBeInTheDocument();
    expect(within(dialog).getByText("Awaiting Dispatch")).toBeInTheDocument();
  });

  it("lets Marketing submit a governed department stock request", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "marketing", repo });

    await user.click(
      await screen.findByRole("tab", { name: "Department requests" }),
    );
    await user.click(screen.getByRole("button", { name: "New stock request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Request warehouse stock",
    });
    await user.clear(within(dialog).getByLabelText("Business purpose"));
    await user.type(
      within(dialog).getByLabelText("Business purpose"),
      "Community wellness campaign",
    );
    expect(within(dialog).getByLabelText("Cost center").tagName).toBe("SELECT");
    await user.selectOptions(
      within(dialog).getByLabelText("Cost center"),
      "CC-4100",
    );
    await user.type(
      within(dialog).getByLabelText("Required date"),
      "2026-08-15",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );
    const quantity = within(dialog).getByLabelText("Quantity");
    await user.clear(quantity);
    await user.type(quantity, "8");
    await user.click(
      within(dialog).getByRole("button", { name: "Submit request" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).departmentStockRequests).toEqual([
        expect.objectContaining({
          requestingDepartment: "marketing",
          costCenter: "CC-4100",
          purpose: "Community wellness campaign",
          status: "pending_approval",
        }),
      ]);
    });
    expect(
      await screen.findByText("Community wellness campaign"),
    ).toBeInTheDocument();
  });

  it("submits multiple products in one department stock request", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "marketing", repo });

    await user.click(
      await screen.findByRole("tab", { name: "Department requests" }),
    );
    await user.click(screen.getByRole("button", { name: "New stock request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Request warehouse stock",
    });
    await user.type(
      within(dialog).getByLabelText("Business purpose"),
      "Roadshow kit",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Cost center"),
      "CC-4100",
    );
    await user.type(
      within(dialog).getByLabelText("Required date"),
      "2026-08-20",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Add another item" }),
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Product 2"),
      "shirt-l",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Submit request" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).departmentStockRequests[0]?.lines).toEqual([
        { productId: "doctor-token", quantity: 1 },
        { productId: "shirt-l", quantity: 1 },
      ]);
    });
  });

  it("requires and persists an image when confirming shipment delivery", async () => {
    const repo = makeRepo();
    const created = await repo.createFulfillmentOrder({
      source: "ecommerce",
      externalReference: "SHOP-POD-2201",
      sourceLocationId: "loc-wh",
      lines: [{ productId: "smart-watch", quantity: 1 }],
      actor: "order.ingestion@mwell.com.ph",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "allocate",
      actor: "allocator@mwell.com.ph",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "start_picking",
      actor: "picker@mwell.com.ph",
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "confirm_pick",
      actor: "picker@mwell.com.ph",
      pickedLines: [
        {
          productId: "smart-watch",
          quantity: 1,
          serialNumbers: ["SMART-WATCH-SN0001"],
        },
      ],
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "confirm_pack",
      actor: "packer@mwell.com.ph",
      courier: "LBC",
      waybillNumber: "WB-POD-2201",
      deliveryLink: "https://track.example/WB-POD-2201",
      packaging: [],
    });
    await repo.advanceFulfillmentOrder({
      orderId: created.id,
      action: "release",
      actor: "releaser@mwell.com.ph",
    });

    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_operator",
      repo,
    });
    const order = await screen.findByRole("listitem", {
      name: /SHOP-POD-2201/i,
    });
    await user.click(
      within(order).getByRole("button", { name: "Update delivery" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /Delivery.*SHOP-POD-2201/i,
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Delivery outcome"),
      "confirm_delivery",
    );
    const submit = within(dialog).getByRole("button", {
      name: "Save delivery update",
    });
    expect(submit).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Proof-of-delivery reference"),
      "POD-2201",
    );
    await user.upload(
      within(dialog).getByLabelText("Upload proof-of-delivery image"),
      new File(["proof"], "pod.jpg", { type: "image/jpeg" }),
    );
    await within(dialog).findByRole(
      "list",
      { name: "Captured evidence" },
      {
        timeout: 5_000,
      },
    );
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(async () => {
      const delivered = (await repo.getData()).fulfillmentOrders.find(
        (candidate) => candidate.id === created.id,
      );
      expect(delivered).toMatchObject({
        status: "completed",
        shipmentStatus: "delivered",
        proofOfDeliveryReference: "POD-2201",
      });
      expect(delivered?.proofOfDeliveryEvidenceUrl).toMatch(
        /^data:image\/jpeg/,
      );
    });
  });

  it("forces merchandise requests to expense treatment", async () => {
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "marketing" });

    await user.click(
      await screen.findByRole("tab", { name: "Department requests" }),
    );
    await user.click(screen.getByRole("button", { name: "New stock request" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Request warehouse stock",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );

    expect(within(dialog).getByLabelText("Expense treatment")).toHaveValue(
      "expense",
    );
    expect(within(dialog).getByLabelText("Expense treatment")).toBeDisabled();
    expect(
      within(dialog).queryByRole("option", { name: /fulfillment supply/i }),
    ).not.toBeInTheDocument();
  });

  it("creates a customer-service return case and preserves the warehouse handoff", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "operations", repo });

    await user.click(await screen.findByRole("tab", { name: "Return cases" }));
    await user.click(screen.getByRole("button", { name: "New return case" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Record customer return",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "smart-watch",
    );
    await user.type(
      within(dialog).getByLabelText("Serial number"),
      "SMART-WATCH-VIP001",
    );
    await user.type(
      within(dialog).getByLabelText("Defect description"),
      "Display does not turn on",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create return case" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).customerReturnCases).toEqual([
        expect.objectContaining({ resolution: "pending", status: "submitted" }),
      ]);
    });
    expect(
      await screen.findByText("Display does not turn on"),
    ).toBeInTheDocument();
    expect(screen.getByText("Customer service")).toBeInTheDocument();
  });

  it("gives Finance a refund-only return action", async () => {
    const repo = makeRepo();
    await repo.createCustomerReturnCase({
      productId: "smart-watch",
      serialNumber: "SMART-WATCH-VIP001",
      defectDescription: "Customer approved refund",
      actor: "customer.service@mwell",
    });
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, { role: "finance", repo });

    await user.click(await screen.findByRole("tab", { name: "Return cases" }));
    await user.click(screen.getByRole("button", { name: "Record refund" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Record finance refund",
    });
    expect(within(dialog).getByLabelText("Resolution")).toHaveValue("refund");
    expect(within(dialog).getByLabelText("Resolution")).toBeDisabled();
    expect(
      within(dialog).getByLabelText("Finance refund reference"),
    ).toBeRequired();
  });

  it("lets a warehouse supervisor register a Product-owned kit definition", async () => {
    const repo = makeRepo();
    const user = userEvent.setup();
    renderWithProviders(<FulfillmentPage />, {
      role: "warehouse_supervisor",
      repo,
    });

    await user.click(
      await screen.findByRole("tab", { name: "Kits and re-kits" }),
    );
    expect(screen.getByText("Product department")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "New kit definition" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Define a bundle or kit",
    });
    await user.selectOptions(
      within(dialog).getByLabelText("Kit product"),
      "otg-bag",
    );
    await user.type(
      within(dialog).getByLabelText("Definition name"),
      "OTG Standard Set",
    );
    await user.type(
      within(dialog).getByLabelText("Product approval reference"),
      "PROD-GO-LIVE-2201",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Component product"),
      "smart-watch",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save kit definition" }),
    );

    await waitFor(async () => {
      expect((await repo.getData()).kitDefinitions).toEqual([
        expect.objectContaining({
          name: "OTG Standard Set",
          ownerDepartment: "product",
          productApprovalReference: "PROD-GO-LIVE-2201",
        }),
      ]);
    });
    expect(await screen.findByText("OTG Standard Set")).toBeInTheDocument();
  });
});
