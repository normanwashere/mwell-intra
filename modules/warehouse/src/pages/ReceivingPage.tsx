import { useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Link, useLocation } from "react-router-dom";
import {
  CertifiedAction,
  CoachOverlay,
  LockedCapabilityRecovery,
  TrainingBanner,
  TrainingModeProvider,
  useOptionalLearning,
  useTraining,
  type LearningContextValue,
  type TrainingContextValue,
} from "@intra/learning";
import { useWarehouse } from "@/app/store";
import { actorName, formatWhen } from "@/domain/format";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeader,
  ProductSelect,
  QuantityStepper,
  SectionTitle,
  useToast,
} from "@/components/ui";
import { Icon } from "@/components/Icon";
import { BarcodeScanner } from "@/components/camera/BarcodeScanner";
import { EvidenceCapture } from "@/components/camera/EvidenceCapture";
import { EvidenceGallery } from "@/components/EvidenceGallery";
import {
  RECEIVING_SIMULATION_ID,
  receivingTrainingAdapter,
  receivingTrainingScenario,
  type ReceivingTrainingState,
} from "@/training/receivingAdapter";

interface Line {
  productId: string;
  quantity: number;
  serials: string[];
  unitCost: string;
  lotCode: string;
  batchNumber: string;
  deviceTestStatus: "not_tested" | "passed" | "failed" | "not_required";
  expiryDate: string;
}

type ReceivingTraining = TrainingContextValue<ReceivingTrainingState>;

function ReceivingTrainingRuntime({
  learning,
}: {
  learning: LearningContextValue;
}) {
  const training = useTraining<ReceivingTrainingState>();
  const close = () => {
    training.exit();
    learning.closeTraining();
  };
  const resumeLater = () => {
    if (training.currentStep.id === "submit") {
      void training
        .dispatch({ type: "interrupt" })
        .then(training.resumeLater)
        .catch(() => undefined);
      return;
    }
    training.resumeLater();
  };
  const continueCommand =
    training.currentStep.id === "traceability-units"
      ? "confirm-traceability"
      : training.currentStep.id === "paused"
        ? "resume"
        : null;

  return (
    <>
      <TrainingBanner onExit={close} />
      <ReceivingPageSurface training={training} />
      {training.active && (
        <CoachOverlay
          step={training.currentStep}
          canGoBack={training.canGoBack}
          onBack={training.back}
          onResumeLater={resumeLater}
          onExit={close}
          onContinue={
            continueCommand
              ? () => {
                  void training
                    .dispatch({ type: continueCommand })
                    .catch(() => undefined);
                }
              : undefined
          }
          continueLabel={
            continueCommand === "resume"
              ? "Resume receipt"
              : "Confirm traceability"
          }
          continueDisabled={training.busy}
          error={training.checkpointError}
        />
      )}
    </>
  );
}

interface PendingReceiptCommand {
  key: string;
  signature: string;
}

const PENDING_RECEIPT_COMMAND_KEY =
  "intra.warehouse.pending-receipt-command.v1";

function readPendingReceiptCommand(): PendingReceiptCommand | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_RECEIPT_COMMAND_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingReceiptCommand>;
    return typeof parsed.key === "string" &&
      typeof parsed.signature === "string"
      ? { key: parsed.key, signature: parsed.signature }
      : null;
  } catch {
    return null;
  }
}

function persistPendingReceiptCommand(command: PendingReceiptCommand | null) {
  if (typeof window === "undefined") return;
  try {
    if (command) {
      window.sessionStorage.setItem(
        PENDING_RECEIPT_COMMAND_KEY,
        JSON.stringify(command),
      );
    } else {
      window.sessionStorage.removeItem(PENDING_RECEIPT_COMMAND_KEY);
    }
  } catch {
    // Storage can be disabled. The in-memory key still protects same-mount retries.
  }
}

export function ReceivingPage() {
  const learning = useOptionalLearning();
  const location = useLocation();
  const resumeRequested = useRef<string | null>(null);
  const activeTraining = learning?.activeTraining;
  const requestedTraining =
    new URLSearchParams(location.search).get("training") ===
    RECEIVING_SIMULATION_ID;
  const requirement = learning?.snapshot?.curricula
    .flatMap((curriculum) => curriculum.requirements)
    .find((item) => item.simulationId === RECEIVING_SIMULATION_ID);
  const progress = learning?.snapshot?.progress.find(
    (item) => item.requirementId === requirement?.id,
  );
  const recoverable =
    requestedTraining &&
    requirement &&
    progress?.state === "in_progress" &&
    progress.activeAttempt;

  useEffect(() => {
    if (
      !learning ||
      activeTraining ||
      !recoverable ||
      resumeRequested.current === requirement.id
    ) {
      return;
    }
    resumeRequested.current = requirement.id;
    void learning.resume(requirement.id);
  }, [activeTraining, learning, recoverable, requirement]);

  if (!learning || !requestedTraining) {
    return <ReceivingPageSurface />;
  }
  if (
    !activeTraining ||
    activeTraining.simulationId !== RECEIVING_SIMULATION_ID
  ) {
    if (learning.loading || recoverable) {
      return (
        <div className="grid min-h-[50vh] place-items-center" role="status">
          <p className="text-sm font-semibold text-muted">
            Restoring receiving practice…
          </p>
        </div>
      );
    }
    return (
      <LockedCapabilityRecovery
        module="warehouse"
        capability="receive_stock"
        reason="training"
        requirementIds={requirement ? [requirement.id] : []}
      />
    );
  }
  return (
    <TrainingModeProvider
      key={activeTraining.attemptId}
      adapter={receivingTrainingAdapter}
      scenario={receivingTrainingScenario}
      assignmentRequirementId={activeTraining.assignmentRequirementId}
      attemptId={activeTraining.attemptId}
      onCheckpoint={learning.recordCheckpoint}
      persistSession
    >
      <ReceivingTrainingRuntime learning={learning} />
    </TrainingModeProvider>
  );
}

export function ReceivingPageSurface({
  training,
}: {
  training?: ReceivingTraining;
}) {
  const { data, receiveStock, canOpenRoute } = useWarehouse();
  const toast = useToast();
  const warehouses = useMemo(
    () => data?.locations.filter((l) => l.type === "warehouse") ?? [],
    [data],
  );
  const [locationId, setLocationId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [actualDeliveryDate, setActualDeliveryDate] = useState(
    () =>
      training?.state?.deliveryDate || new Date().toISOString().slice(0, 10),
  );
  const [deliveryReference, setDeliveryReference] = useState("");
  const [courierOrDriver, setCourierOrDriver] = useState("");
  const [binId, setBinId] = useState(
    () => training?.state?.destinationId ?? "",
  );
  // 390px is scan-first (WH-11): context selects collapse into a summary chip
  // so "Scan to receive" sits above the fold. Desktop always shows them.
  const [contextOpen, setContextOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(
    () => training?.state?.productId ?? "",
  );
  const [newQty, setNewQty] = useState(1);
  const [lines, setLines] = useState<Line[]>(() =>
    training?.state?.productId
      ? [
          {
            productId: training.state.productId,
            quantity: Math.max(1, training.state.receivedQuantity),
            serials: [...training.state.serials],
            unitCost: "",
            lotCode: "",
            batchNumber: training.state.batchNumber,
            deviceTestStatus: "not_tested",
            expiryDate: "",
          },
        ]
      : [],
  );
  const [evidence, setEvidence] = useState<string[]>(() => [
    ...(training?.state?.evidenceUrls ?? []),
  ]);
  const [exceptionType, setExceptionType] = useState<"non_po" | "overage">(
    "non_po",
  );
  const [exceptionReason, setExceptionReason] = useState("");
  const [lastReceiptStaged, setLastReceiptStaged] = useState(false);
  const receiptCommand = useRef<PendingReceiptCommand | null>(
    readPendingReceiptCommand(),
  );

  if (!data) return null;
  const products = data.products;
  const activeLocation = locationId || warehouses[0]?.id || "";
  const bins = (data.storageAreas ?? []).filter(
    (b) => b.locationId === activeLocation,
  );
  // Guard against a bin selected for a different warehouse after switching.
  const activeBin =
    training && binId === "TRAIN-QA-STAGING"
      ? binId
      : bins.some((b) => b.id === binId)
        ? binId
        : "";
  const productById = (id: string) => products.find((p) => p.id === id);
  const selectedProduct = productById(selectedProductId);
  const totalItems = lines.reduce((s, l) => s + l.quantity, 0);

  const addOrIncrement = (productId: string, qty = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: l.quantity + qty } : l,
        );
      }
      return [
        ...prev,
        {
          productId,
          quantity: qty,
          serials: [],
          unitCost: "",
          lotCode: "",
          batchNumber: "",
          deviceTestStatus: "not_tested",
          expiryDate: "",
        },
      ];
    });
  };

  const setLineField = (
    productId: string,
    field:
      | "unitCost"
      | "lotCode"
      | "batchNumber"
      | "deviceTestStatus"
      | "expiryDate",
    value: string,
  ) => {
    setLines((prev) =>
      prev.map((l) =>
        l.productId === productId ? { ...l, [field]: value } : l,
      ),
    );
  };

  const setLineQuantity = (productId: string, quantity: number) => {
    if (Number.isNaN(quantity) || quantity < 1) return;
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, quantity } : l)),
    );
  };

  const productTrainingCategory = (product: (typeof products)[number]) =>
    product.itemClass === "event_material"
      ? "event-material"
      : product.itemClass === "merchandise" ||
          product.category === "merchandise"
        ? "merch"
        : "sku";

  const selectProduct = (productId: string) => {
    setSelectedProductId(productId);
    if (!training || training.currentStep.id !== "line") return;
    const product = productById(productId);
    if (!product) return;
    void training
      .dispatch({
        type: "add-line",
        payload: {
          category: productTrainingCategory(product),
          productId: product.id,
          serialized: product.serialized,
        },
      })
      .then(() => addOrIncrement(product.id, 1))
      .catch(() => undefined);
  };

  const addSelected = () => {
    if (!selectedProduct) return;
    addOrIncrement(selectedProduct.id, Math.max(1, newQty));
    toast.success(`Added ${newQty} × ${selectedProduct.name}`);
    setNewQty(1);
  };

  const addSerial = (productId: string, serial: string) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        if (existing.serials.includes(serial)) return prev;
        const serials = [...existing.serials, serial];
        return prev.map((l) =>
          l.productId === productId
            ? { ...l, serials, quantity: serials.length }
            : l,
        );
      }
      return [
        ...prev,
        {
          productId,
          quantity: 1,
          serials: [serial],
          unitCost: "",
          lotCode: "",
          batchNumber: "",
          deviceTestStatus: "not_tested",
          expiryDate: "",
        },
      ];
    });
  };

  const handleScan = (code: string) => {
    const matched = products.find((p) => p.barcode === code);
    if (matched && !training) {
      setSelectedProductId(matched.id);
      addOrIncrement(matched.id, 1);
      toast.success(`Added ${matched.name}`);
      return;
    }
    const selected = productById(selectedProductId);
    if (selected?.serialized) {
      if (training) {
        void training
          .dispatch({ type: "scan-serial", payload: code })
          .then(() => {
            addSerial(selected.id, code);
            toast.success(`Serial ${code} recorded for ${selected.name}`);
          })
          .catch(() => undefined);
        return;
      }
      addSerial(selected.id, code);
      toast.success(`Serial ${code} → ${selected.name}`);
      return;
    }
    if (selected && training) {
      void training
        .dispatch({
          type: "set-sheet-barcode",
          payload: { barcode: code, quantity: newQty },
        })
        .then(() => {
          addOrIncrement(selected.id, newQty);
          toast.success(`Monitored sheet ${code} recorded`);
        })
        .catch(() => undefined);
      return;
    }
    toast.error(`Unknown barcode "${code}". Pick a product first.`);
  };

  const removeLine = (productId: string) =>
    setLines((prev) => prev.filter((l) => l.productId !== productId));

  const submit = async () => {
    if (lines.length === 0 || !activeLocation) return;
    if (training) {
      await training
        .dispatch({ type: "submit-receipt" })
        .catch(() => undefined);
      return;
    }
    const receiptInput = {
      locationId: activeLocation,
      supplierId: supplierId || undefined,
      actualDeliveryDate: actualDeliveryDate || undefined,
      deliveryReference: deliveryReference.trim() || undefined,
      courierOrDriver: courierOrDriver.trim() || undefined,
      evidenceUrls: evidence,
      receiptException: {
        type: exceptionType,
        reason: exceptionReason.trim(),
        evidenceUrls: evidence,
      },
      lines: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        serialNumbers: l.serials.length ? l.serials : undefined,
        unitCost:
          l.unitCost.trim() !== "" && !Number.isNaN(Number(l.unitCost))
            ? Number(l.unitCost)
            : undefined,
        lotCode: l.lotCode.trim() || undefined,
        batchNumber: l.batchNumber.trim() || undefined,
        deviceTestStatus: l.deviceTestStatus,
        expiryDate: l.expiryDate || undefined,
        binId: activeBin || undefined,
      })),
    };
    const signature = JSON.stringify(receiptInput);
    if (
      !receiptCommand.current ||
      receiptCommand.current.signature !== signature
    ) {
      receiptCommand.current = {
        key: `receive-${crypto.randomUUID()}`,
        signature,
      };
      persistPendingReceiptCommand(receiptCommand.current);
    }
    const ok = await receiveStock({
      ...receiptInput,
      idempotencyKey: receiptCommand.current.key,
    });
    if (!ok) return;
    receiptCommand.current = null;
    persistPendingReceiptCommand(null);
    toast.success(`Received ${totalItems} item(s) into inspection staging`);
    setLastReceiptStaged(true);
    setLines([]);
    setEvidence([]);
  };

  return (
    <div
      className={clsx(
        "space-y-4 overflow-x-clip",
        lines.length > 0 && "pb-24 md:pb-0",
      )}
    >
      <PageHeader
        title="Receiving"
        icon="truck"
        subtitle="Scan & tag incoming inventory"
        action={
          canOpenRoute("purchase-orders") ? (
            <Link to="/purchase-orders" className="btn-ghost btn-sm">
              <Icon name="cart" className="h-4 w-4" /> Approved POs
            </Link>
          ) : undefined
        }
      />

      {!training && (
        <Card className="space-y-3 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <div>
            <p className="font-semibold text-ink">
              Approved purchase orders are the standard receiving route.
            </p>
            <p className="mt-1 text-sm text-muted">
              Use this form only for a non-PO or overage exception. It stays unavailable until Quality accepts it.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Receipt exception type" htmlFor="receipt-exception-type">
              <select
                id="receipt-exception-type"
                className="input"
                value={exceptionType}
                onChange={(event) =>
                  setExceptionType(event.target.value as "non_po" | "overage")
                }
              >
                <option value="non_po">Non-PO receipt</option>
                <option value="overage">PO overage</option>
              </select>
            </Field>
            <Field label="Exception reason" htmlFor="receipt-exception-reason">
              <input
                id="receipt-exception-reason"
                className="input"
                value={exceptionReason}
                onChange={(event) => setExceptionReason(event.target.value)}
              />
            </Field>
          </div>
        </Card>
      )}

      {training && (
        <Card className="flex flex-col gap-3 border-cyan-300 bg-cyan-50 dark:border-cyan-800 dark:bg-cyan-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-cyan-800 dark:text-cyan-200">
              Practice purchase order
            </p>
            <p className="mt-1 font-semibold text-ink">
              TRAIN-PO-1042 | 2 serialized units
            </p>
            <p className="mt-1 text-sm text-muted">
              Training data only. No supplier order or stock record will change.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary shrink-0"
            data-onboarding-anchor="receiving.purchase-order"
            disabled={
              training.currentStep.id !== "purchase-order" || training.busy
            }
            onClick={() =>
              void training
                .dispatch({
                  type: "select-purchase-order",
                  payload: { id: "TRAIN-PO-1042", expectedQuantity: 2 },
                })
                .catch(() => undefined)
            }
          >
            Use practice order
          </button>
        </Card>
      )}

      <div className="flex flex-col gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Clean receipt</p>
          <p className="text-xs opacity-80">
            Accepted quantity and condition need no supervisor approval.
          </p>
        </div>
        {canOpenRoute("storage") && (
          <Link
            to="/storage"
            className="btn-ghost btn-sm shrink-0 justify-center"
          >
            Continue to put away
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold">Inspection required</p>
          <p className="text-xs opacity-80">
            Damage, shortage, unidentified stock, rejection, or quarantine
            routes to Supervisor control.
          </p>
        </div>
        {canOpenRoute("quality") && (
          <Link
            to="/quality"
            className="btn-ghost btn-sm shrink-0 justify-center"
          >
            Open quality queue
          </Link>
        )}
      </div>
      {lastReceiptStaged && (
        <p
          role="status"
          className="rounded-xl bg-brand-500/10 px-4 py-3 text-sm font-medium text-brand-800 dark:text-brand-200"
        >
          Receipt saved in inspection staging and is ready for quality review.
        </p>
      )}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(22rem,0.8fr)_minmax(0,1.45fr)] xl:items-start">
        {/* Left: capture controls — scan-first (WH-11): the scanner card
            leads; where/who selects collapse into a summary chip on mobile. */}
        <div className="min-w-0 space-y-4">
          <button
            type="button"
            className="flex min-h-11 w-full max-w-full items-start justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-sm lg:hidden"
            aria-expanded={contextOpen}
            onClick={() => setContextOpen((v) => !v)}
          >
            <span className="min-w-0 break-words leading-snug text-muted">
              Receiving into:{" "}
              <span className="font-semibold text-ink">
                {warehouses.find((l) => l.id === activeLocation)?.name ?? "—"}
                {" · "}
                {activeBin
                  ? bins.find((b) => b.id === activeBin)?.code
                  : "General area"}
              </span>
              {supplierId
                ? ` · ${data.suppliers.find((s) => s.id === supplierId)?.name ?? ""}`
                : ""}
            </span>
            <Icon
              name="chevron"
              className={clsx(
                "h-4 w-4 shrink-0 text-faint transition",
                contextOpen ? "-rotate-90" : "rotate-90",
              )}
            />
          </button>

          <Card className="min-w-0 space-y-3 overflow-hidden">
            <Field
              label="Product"
              htmlFor="rcv-product"
              hint="Pick a product and quantity, or scan a barcode. For serialized devices, scan each unit's serial."
            >
              <div
                data-onboarding-anchor={
                  training ? "receiving.add-line" : undefined
                }
              >
                <ProductSelect
                  id="rcv-product"
                  products={products}
                  value={selectedProductId}
                  onChange={selectProduct}
                />
              </div>
            </Field>

            {selectedProduct?.serialized ? (
              <p className="rounded-xl bg-inset px-3 py-2 text-xs text-faint">
                Serialized device — scan each unit's serial below to add it.
              </p>
            ) : (
              <div className="grid min-w-0 gap-2 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
                <div className="min-w-0">
                  <Field label="Quantity" htmlFor="rcv-qty">
                    <QuantityStepper
                      id="rcv-qty"
                      aria-label="Quantity to add"
                      value={newQty}
                      onChange={setNewQty}
                      min={1}
                    />
                  </Field>
                </div>
                <button
                  type="button"
                  className="btn-primary min-w-0 whitespace-nowrap px-3"
                  disabled={!selectedProductId}
                  onClick={addSelected}
                >
                  <Icon name="plus" /> Add to receipt
                </button>
              </div>
            )}

            <div
              data-onboarding-anchor={
                training ? "receiving.serial-input" : undefined
              }
            >
              <BarcodeScanner
                onDetected={handleScan}
                label="Scan to receive"
                manualLabel={
                  training
                    ? "Enter practice serial or sheet barcode"
                    : undefined
                }
                manualActionLabel={training ? "Record" : undefined}
              />
            </div>
          </Card>

          <Card
            className={clsx(
              "grid gap-3 sm:grid-cols-2",
              !training && !contextOpen && "hidden lg:grid",
            )}
          >
            <Field label="Receive into" htmlFor="rcv-location">
              <select
                id="rcv-location"
                className="input"
                value={activeLocation}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {warehouses.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Supplier (optional)" htmlFor="rcv-supplier">
              <select
                id="rcv-supplier"
                className="input"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">—</option>
                {data.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="space-y-2">
              <Field label="Actual delivery date" htmlFor="rcv-delivery-date">
                <input
                  id="rcv-delivery-date"
                  type="date"
                  className="input"
                  value={actualDeliveryDate}
                  onChange={(event) =>
                    setActualDeliveryDate(event.target.value)
                  }
                />
              </Field>
              {training && (
                <button
                  type="button"
                  className="btn-outline w-full"
                  data-onboarding-anchor="receiving.delivery-date"
                  disabled={
                    training.currentStep.id !== "delivery" || training.busy
                  }
                  onClick={() =>
                    void training
                      .dispatch({
                        type: "set-delivery-date",
                        payload: actualDeliveryDate,
                      })
                      .catch(() => undefined)
                  }
                >
                  Confirm delivery date
                </button>
              )}
            </div>
            <Field label="Delivery reference" htmlFor="rcv-delivery-reference">
              <input
                id="rcv-delivery-reference"
                className="input"
                value={deliveryReference}
                onChange={(event) => setDeliveryReference(event.target.value)}
                placeholder="DR / invoice / shipment number"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Courier or driver" htmlFor="rcv-courier-driver">
                <input
                  id="rcv-courier-driver"
                  className="input"
                  value={courierOrDriver}
                  onChange={(event) => setCourierOrDriver(event.target.value)}
                  placeholder="Courier, driver, or vehicle reference"
                />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Put away to"
                htmlFor="rcv-bin"
                hint={
                  bins.length === 0
                    ? "No storage areas set up for this warehouse — stock goes to the general area."
                    : "Scannable bin/shelf where this delivery is stored."
                }
              >
                <select
                  id="rcv-bin"
                  className="input"
                  value={activeBin}
                  onChange={(event) => {
                    setBinId(event.target.value);
                    if (training?.currentStep.id !== "destination") return;
                    void training
                      .dispatch({
                        type: "set-destination",
                        payload: event.target.value,
                      })
                      .catch(() => undefined);
                  }}
                  disabled={!training && bins.length === 0}
                  data-onboarding-anchor={
                    training ? "receiving.destination" : undefined
                  }
                >
                  <option value="">General area (unassigned)</option>
                  {training && (
                    <option value="TRAIN-QA-STAGING">
                      Training QA staging
                    </option>
                  )}
                  {bins.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code}
                      {b.label ? ` · ${b.label}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>
        </div>

        {/* Right: running receipt + evidence */}
        <div className="min-w-0 space-y-4">
          <Card>
            <SectionTitle
              title="Receipt lines"
              action={
                totalItems > 0 ? (
                  <Badge tone="brand">{totalItems} pcs</Badge>
                ) : undefined
              }
            />
            {lines.length === 0 ? (
              <EmptyState icon="truck" title="Nothing scanned yet" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-left" aria-label="Receipt lines">
                <thead className="hidden bg-inset text-xs text-muted lg:table-header-group">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Product / quantity</th>
                    <th className="px-3 py-2 font-semibold">Cost / traceability</th>
                    <th className="px-3 py-2 font-semibold">Quality result</th>
                    <th className="w-12 px-3 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="block divide-y divide-line lg:table-row-group">
                {lines.map((l) => {
                  const p = productById(l.productId)!;
                  return (
                    <tr
                      key={l.productId}
                      className="grid gap-4 p-3 lg:table-row lg:p-0"
                    >
                      <td className="min-w-0 align-top lg:px-3 lg:py-3">
                        <p className="truncate font-medium text-ink">
                          {p.name}
                        </p>
                        <p className="font-mono text-xs text-faint">{p.sku}</p>
                        {p.serialized ? (
                          <p className="mt-0.5 text-xs text-faint">
                            Qty {l.quantity} • serialized
                          </p>
                        ) : (
                          <div className="mt-2">
                            <QuantityStepper
                              aria-label={`Quantity for ${p.name}`}
                              value={l.quantity}
                              onChange={(q) => setLineQuantity(l.productId, q)}
                              min={1}
                            />
                          </div>
                        )}
                        {l.serials.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {l.serials.map((s) => (
                              <Badge key={s} tone="brand">
                                {s}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="grid gap-2 align-top sm:grid-cols-2 lg:px-3 lg:py-3">
                          <Field
                            label="Unit cost (PHP)"
                            htmlFor={`rcv-cost-${l.productId}`}
                          >
                            <input
                              id={`rcv-cost-${l.productId}`}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              className="input"
                              value={l.unitCost}
                              onChange={(e) =>
                                setLineField(
                                  l.productId,
                                  "unitCost",
                                  e.target.value,
                                )
                              }
                              placeholder={String(p.unitCost)}
                            />
                          </Field>
                          <Field
                            label="Lot code"
                            htmlFor={`rcv-lot-${l.productId}`}
                          >
                            <input
                              id={`rcv-lot-${l.productId}`}
                              className="input"
                              value={l.lotCode}
                              onChange={(e) =>
                                setLineField(
                                  l.productId,
                                  "lotCode",
                                  e.target.value,
                                )
                              }
                              placeholder="optional"
                            />
                          </Field>
                          <div className="space-y-2">
                            <Field
                              label="Batch number"
                              htmlFor={`rcv-batch-${l.productId}`}
                            >
                              <input
                                id={`rcv-batch-${l.productId}`}
                                className="input"
                                value={l.batchNumber}
                                onChange={(event) =>
                                  setLineField(
                                    l.productId,
                                    "batchNumber",
                                    event.target.value,
                                  )
                                }
                                placeholder="Supplier batch"
                              />
                            </Field>
                            {training && (
                              <button
                                type="button"
                                className="btn-outline w-full"
                                data-onboarding-anchor="receiving.batch-number"
                                disabled={
                                  training.currentStep.id !==
                                    "traceability-batch" || training.busy
                                }
                                onClick={() =>
                                  void training
                                    .dispatch({
                                      type: "set-batch-number",
                                      payload: l.batchNumber,
                                    })
                                    .catch(() => undefined)
                                }
                              >
                                Confirm batch number
                              </button>
                            )}
                          </div>
                      </td>
                      <td className="grid gap-2 align-top lg:px-3 lg:py-3">
                          <Field
                            label="Device test result"
                            htmlFor={`rcv-test-${l.productId}`}
                          >
                            <select
                              id={`rcv-test-${l.productId}`}
                              className="input"
                              value={l.deviceTestStatus}
                              onChange={(event) =>
                                setLineField(
                                  l.productId,
                                  "deviceTestStatus",
                                  event.target.value,
                                )
                              }
                            >
                              <option value="not_tested">Not tested</option>
                              <option value="passed">Passed</option>
                              <option value="failed">
                                Failed - send to hold
                              </option>
                              <option value="not_required">Not required</option>
                            </select>
                          </Field>
                          {p.expiryTracked && (
                            <div>
                              <Field
                                label={`Expiry date for ${p.name}`}
                                htmlFor={`rcv-expiry-${l.productId}`}
                              >
                                <input
                                  id={`rcv-expiry-${l.productId}`}
                                  type="date"
                                  className="input"
                                  value={l.expiryDate}
                                  onChange={(event) =>
                                    setLineField(
                                      l.productId,
                                      "expiryDate",
                                      event.target.value,
                                    )
                                  }
                                />
                              </Field>
                            </div>
                          )}
                      </td>
                      <td className="align-top lg:px-3 lg:py-3">
                      <button
                        type="button"
                        className="btn-ghost min-h-11 w-full px-3 text-rose-600 lg:w-11"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => removeLine(l.productId)}
                      >
                        <Icon name="x" />
                      </button>
                      </td>
                    </tr>
                  );
                })}
                </tbody>
              </table>
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <SectionTitle
              title="Photo evidence"
              subtitle="Delivery / packing proof"
            />
            <div
              data-onboarding-anchor={
                training ? "receiving.evidence" : undefined
              }
            >
              {training ? (
                <div className="space-y-3">
                  <button
                    type="button"
                    className="btn-ghost w-full"
                    disabled={
                      training.currentStep.id !== "evidence" || training.busy
                    }
                    onClick={() => {
                      const value = "training://delivery-photo-1";
                      void training
                        .dispatch({ type: "attach-evidence", payload: value })
                        .then(() => setEvidence([value]))
                        .catch(() => undefined);
                    }}
                  >
                    <Icon name="camera" /> Attach practice delivery photo
                  </button>
                  <fieldset>
                    <legend className="text-sm font-semibold text-ink">
                      Delivery condition
                    </legend>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {(["clean", "damaged"] as const).map((condition) => (
                        <button
                          key={condition}
                          type="button"
                          className="btn-outline capitalize"
                          disabled={
                            training.currentStep.id !== "evidence" ||
                            evidence.length === 0 ||
                            training.busy
                          }
                          onClick={() =>
                            void training
                              .dispatch({
                                type: "mark-condition",
                                payload: condition,
                              })
                              .catch(() => undefined)
                          }
                        >
                          {condition}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              ) : (
                <EvidenceCapture onChange={setEvidence} />
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Sticky action bar */}
      {lines.length > 0 &&
        (training ? (
          <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-line bg-surface/95 p-2 shadow-e3 backdrop-blur md:bottom-4">
            <button
              type="button"
              className="btn-primary min-h-12 w-full shadow-pop"
              onClick={() => void submit()}
              data-onboarding-anchor={training ? "receiving.submit" : undefined}
              disabled={training?.busy}
            >
              Receive {totalItems} item(s)
            </button>
          </div>
        ) : (
          <CertifiedAction module="warehouse" capability="receive_stock">
            {({ execute, pending }) => (
              <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-20 rounded-2xl border border-line bg-surface/95 p-2 shadow-e3 backdrop-blur md:bottom-4">
                <button
                  type="button"
                  className="btn-primary min-h-12 w-full shadow-pop"
                  onClick={() => void execute(submit)}
                  disabled={pending || !exceptionReason.trim() || evidence.length === 0}
                >
                  Receive {totalItems} item(s)
                </button>
              </div>
            )}
          </CertifiedAction>
        ))}

      {/* Receipt history — parity with the Returns recent list. */}
      <Card>
        <SectionTitle
          title="Recent receipts"
          subtitle="Latest deliveries & their evidence"
        />
        {data.receipts.length === 0 ? (
          <EmptyState icon="truck" title="No receipts recorded yet" />
        ) : (
          <ul className="space-y-2" aria-label="Receipts">
            {data.receipts
              .slice()
              .reverse()
              .slice(0, 8)
              .map((r) => {
                const loc = data.locations.find((l) => l.id === r.locationId);
                const sup = data.suppliers.find((s) => s.id === r.supplierId);
                const total = r.lines.reduce((s, l) => s + l.quantity, 0);
                return (
                  <li key={r.id} className="rounded-xl bg-inset p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <span className="text-sm font-medium text-ink">
                        {total} item(s) into {loc?.name ?? r.locationId}
                      </span>
                      <span className="text-xs text-faint">
                        {formatWhen(r.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-faint">
                      {sup ? sup.name : "No supplier"} · by {actorName(r.actor)}
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-muted">
                      {r.lines.map((l, i) => {
                        const p = data.products.find(
                          (x) => x.id === l.productId,
                        );
                        return (
                          <li
                            key={i}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate">
                              {l.quantity}× {p?.name ?? l.productId}
                            </span>
                            {l.lotCode && (
                              <Badge tone="slate">{l.lotCode}</Badge>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {r.evidenceUrls && r.evidenceUrls.length > 0 && (
                      <div className="mt-2">
                        <EvidenceGallery urls={r.evidenceUrls} size="thumb" />
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
    </div>
  );
}
