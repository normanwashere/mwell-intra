import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, useNavigate } from "react-router-dom";
import { buildSeed } from "@intra/data-kit";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

function NavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      <output data-testid="route">
        {location.pathname}
        {location.search}
      </output>
      <FulfillmentPage />
    </>
  );
}

function fixture() {
  const data = buildSeed();
  data.fulfillmentOrders = [
    {
      id: "order-url",
      externalReference: "URL-ORDER",
      source: "ecommerce",
      ecommerceChannel: "Shopee",
      sourceLocationId: "loc-wh",
      status: "received",
      createdBy: "requester",
      createdAt: "2026-09-11T00:00:00Z",
      updatedAt: "2026-09-11T00:00:00Z",
      packaging: [],
      shipmentEvents: [],
      deliveryMethod: "shipment",
      lines: [
        {
          productId: "smart-watch",
          quantity: 1,
          pickedQuantity: 0,
          pickedSerialNumbers: [],
        },
      ],
    },
  ];
  data.departmentStockRequests = [
    {
      id: "request-url",
      requestedBy: "requester",
      requestedAt: "2026-09-11T00:00:00Z",
      requestingDepartment: "marketing",
      purpose: "Campaign stock",
      costCenter: "CC-4100",
      requiredDate: "2026-09-12",
      expenseTreatment: "expense",
      status: "approved",
      fulfillmentOrderId: "order-url",
      lines: [{ productId: "smart-watch", quantity: 1 }],
    },
  ];
  return makeRepo(data);
}

describe("audited fulfillment navigation", () => {
  it("preserves rapid filter updates before navigation has rendered", async () => {
    renderWithProviders(<NavigationHarness />, { repo: fixture(), route: '/fulfillment?tab=orders' });
    await screen.findByLabelText('Status');
    act(() => {
      fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
      fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'URL' } });
      fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'Shopee' } });
    });
    expect(screen.getByLabelText('Status')).toHaveValue('all');
    expect(screen.getByLabelText('Search orders')).toHaveValue('URL');
    expect(screen.getByLabelText('Channel')).toHaveValue('Shopee');
  });
  it.each([true, false])(
    "gates operator Requests by effective capability (%s)",
    async (granted) => {
      renderWithProviders(<NavigationHarness />, {
        role: "warehouse_operator",
        source: "supabase",
        repo: fixture(),
        capabilities: granted
          ? ["issue_items", "request_stock"]
          : ["issue_items"],
        route: "/fulfillment?tab=requests",
      });
      await screen.findByRole("heading", { name: "Pick & Pack" });
      if (granted) {
        expect(
          screen.getByRole("tab", { name: "Department requests" }),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          screen.getByRole("button", { name: /New stock request/ }),
        ).toBeVisible();
        expect(screen.getByTestId("route")).toHaveTextContent("tab=requests");
      } else {
        expect(
          screen.queryByRole("tab", { name: "Department requests" }),
        ).not.toBeInTheDocument();
        await waitFor(() =>
          expect(screen.getByTestId("route")).toHaveTextContent("tab=orders"),
        );
      }
    },
  );

  it("restores order, filters and queue with reload and history without a write", async () => {
    const repo = fixture();
    const before = await repo.getData();
    const user = userEvent.setup();
    const view = renderWithProviders(<NavigationHarness />, {
      repo,
      route: "/fulfillment?tab=orders&filter=floor_work",
    });
    await screen.findByLabelText("Search orders");
    await user.selectOptions(screen.getByLabelText("Status"), "all");
    await user.type(screen.getByLabelText("Search orders"), "URL");
    await user.selectOptions(screen.getByLabelText("Channel"), "Shopee");
    const queueUrl = screen.getByTestId("route").textContent!;
    await user.click(
      screen.getByRole("button", { name: "View order details" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent("URL-ORDER");
    const detailUrl = screen.getByTestId("route").textContent!;
    expect(detailUrl).toContain("order=order-url");
    expect(detailUrl).toContain("status=all");
    expect(detailUrl).toContain("q=URL");
    expect(detailUrl).toContain("channel=Shopee");
    // Browser history can change while a modal contains keyboard focus.
    fireEvent.click(screen.getByText("Back", { selector: "button" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("route").textContent).toBe(queueUrl);
    expect(screen.getByLabelText("Status")).toHaveValue("all");
    fireEvent.click(screen.getByText("Forward", { selector: "button" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("URL-ORDER");
    view.unmount();
    renderWithProviders(<NavigationHarness />, { repo, route: detailUrl });
    expect(await screen.findByRole("dialog")).toHaveTextContent("URL-ORDER");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("Search orders")).toHaveValue("URL");
    expect(screen.getByLabelText("Channel")).toHaveValue("Shopee");
    expect(screen.getByTestId("route")).not.toHaveTextContent("order=");
    expect(await repo.getData()).toEqual(before);
  });

  it("opens a request deep link and its scoped linked order, then Back restores the request", async () => {
    const repo = fixture();
    renderWithProviders(<NavigationHarness />, {
      repo,
      route:
        "/fulfillment?tab=requests&request=request-url&requestStatus=approved",
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Review request",
    });
    expect(dialog).toHaveTextContent("Campaign stock");
    fireEvent.click(
      within(dialog).getByRole("link", { name: "Open fulfillment order" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent("URL-ORDER");
    expect(screen.getByTestId("route")).toHaveTextContent("tab=orders");
    fireEvent.click(screen.getByText("Back", { selector: "button" }));
    expect(
      await screen.findByRole("dialog", { name: "Review request" }),
    ).toHaveTextContent("Campaign stock");
  });

  it("persists request selection and status from queue interactions across a fresh mount", async () => {
    const repo = fixture();
    const user = userEvent.setup();
    const view = renderWithProviders(<NavigationHarness />, {
      repo,
      role: "marketing",
      route: "/fulfillment?tab=requests",
    });
    const counters = await screen.findByRole("group", {
      name: "Request counters",
    });
    await user.click(
      within(counters).getByRole("button", { name: "Approved: 1" }),
    );
    await user.click(screen.getByRole("button", { name: "View request" }));
    const url = screen.getByTestId("route").textContent!;
    expect(url).toContain("request=request-url");
    expect(url).toContain("requestStatus=approved");
    view.unmount();
    renderWithProviders(<NavigationHarness />, {
      repo,
      role: "marketing",
      route: url,
    });
    expect(
      await screen.findByRole("dialog", { name: "Review request" }),
    ).toHaveTextContent("Campaign stock");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Approved: 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("does not link to orders absent from the authorized data snapshot", async () => {
    const data = await fixture().getData();
    data.fulfillmentOrders = [];
    renderWithProviders(<FulfillmentPage />, {
      repo: makeRepo(data),
      role: "marketing",
      route: "/fulfillment?tab=requests&request=request-url",
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Review request",
    });
    expect(
      within(dialog).queryByRole("link", { name: "Open fulfillment order" }),
    ).not.toBeInTheDocument();
  });

  it("validates filters and restores defaults instead of hiding every order", async () => {
    renderWithProviders(<FulfillmentPage />, {
      repo: fixture(),
      route: "/fulfillment?tab=orders&status=bogus&channel=foreign",
    });
    expect(await screen.findByLabelText("Status")).toHaveValue("active");
    expect(screen.getByLabelText("Channel")).toHaveValue("all");
    expect(
      screen.getByRole("listitem", { name: "Order URL-ORDER" }),
    ).toBeVisible();
  });

  it.each([
    "order=missing",
    "order=https%3A%2F%2Fevil.example",
    "tab=requests&request=missing",
  ])("recovers non-leaking unavailable selector %s", async (selector) => {
    renderWithProviders(<NavigationHarness />, {
      repo: fixture(),
      route: `/fulfillment?${selector}`,
    });
    const dialog = await screen.findByRole("dialog", { name: /unavailable/i });
    expect(dialog).toHaveTextContent(
      "not available in your current warehouse view",
    );
    expect(dialog).not.toHaveTextContent("evil.example");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps bulk tools collapsed and all status counters available", async () => {
    renderWithProviders(<FulfillmentPage />, {
      repo: fixture(),
      role: "operations",
    });
    const tools = await screen.findByText("Queue tools", {
      selector: "summary",
    });
    expect(tools.closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("group", { name: "Order counters" })).toHaveClass(
      "hidden",
      "sm:grid",
    );
    fireEvent.click(tools);
    expect(
      screen.getByRole("button", { name: /Import existing tracker/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Export current view/ }),
    ).toBeVisible();
  });
});
