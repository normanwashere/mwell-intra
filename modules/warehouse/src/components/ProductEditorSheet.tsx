import { useEffect, useState } from "react";
import { useWarehouse } from "@/app/store";
import {
  requiredSerializationPolicy,
  type ItemClass,
  type Product,
} from "@/domain/types";
import { Field, Sheet, useToast } from "./ui";

/**
 * Bottom-sheet editor for a product master's editable fields (name, unit cost,
 * reorder point, barcode, promotional flag). Gated by the caller via the
 * `manage_products` capability. `unitCost` feeds valuation/landed cost; the
 * reorder point drives the procurement worklist & low-stock alerts.
 */
export function ProductEditorSheet({
  product,
  open,
  onOpenChange,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { updateProduct } = useWarehouse();
  const toast = useToast();
  const [name, setName] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reorderPoint, setReorderPoint] = useState("");
  const [barcode, setBarcode] = useState("");
  const [itemClass, setItemClass] = useState<ItemClass>("merchandise");
  const [uom, setUom] = useState("piece");
  const [promotional, setPromotional] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && product) {
      setName(product.name);
      setUnitCost(String(product.unitCost));
      setReorderPoint(String(product.reorderPoint));
      setBarcode(product.barcode ?? "");
      setItemClass(
        product.itemClass ??
          (product.category === "device" ? "sellable_sku" : "merchandise"),
      );
      setUom(product.uom ?? "piece");
      setPromotional(Boolean(product.promotional));
      setError(null);
    }
  }, [open, product]);

  if (!product) return null;

  const save = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const cost = Number(unitCost);
    const reorder = Number(reorderPoint);
    if (Number.isNaN(cost) || cost < 0) {
      setError("Unit cost must be zero or more.");
      return;
    }
    if (Number.isNaN(reorder) || reorder < 0) {
      setError("Reorder point must be zero or more.");
      return;
    }
    const ok = await updateProduct({
      productId: product.id,
      patch: {
        name: name.trim(),
        unitCost: cost,
        reorderPoint: reorder,
        barcode: barcode.trim(),
        itemClass,
        uom,
        promotional,
      },
    });
    if (!ok) return;
    toast.success(`Updated ${name.trim()}`);
    onOpenChange(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit product"
      description={`${product.name} · ${product.sku}`}
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => void save()}
        >
          Save changes
        </button>
      }
    >
      <div className="space-y-3">
        <Field label="Name" htmlFor="pe-name" error={error ?? undefined}>
          <input
            id="pe-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Unit cost (₱)"
            htmlFor="pe-cost"
            hint="Landed cost per unit"
          >
            <input
              id="pe-cost"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="input"
              value={unitCost}
              onChange={(e) => setUnitCost(e.target.value)}
            />
          </Field>
          <Field
            label="Reorder point"
            htmlFor="pe-reorder"
            hint="Replenish at/below this"
          >
            <input
              id="pe-reorder"
              type="number"
              inputMode="numeric"
              min={0}
              className="input"
              value={reorderPoint}
              onChange={(e) => setReorderPoint(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Barcode" htmlFor="pe-barcode">
          <input
            id="pe-barcode"
            className="input"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="EAN / UPC"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item class" htmlFor="pe-item-class">
            <select
              id="pe-item-class"
              className="input"
              value={itemClass}
              onChange={(event) =>
                setItemClass(event.target.value as ItemClass)
              }
            >
              <option value="sellable_sku">Sellable SKU</option>
              <option value="merchandise">Merchandise / giveaway</option>
              <option value="event_material">Event material</option>
              <option value="fulfillment_supply">Fulfillment supply</option>
              <option value="warehouse_tool">Warehouse tool</option>
              <option value="re_kitted_item">Re-kitted / open-box item</option>
            </select>
          </Field>
          <Field label="Unit of measure" htmlFor="pe-uom">
            <select
              id="pe-uom"
              className="input"
              value={uom}
              onChange={(event) => setUom(event.target.value)}
            >
              <option value="piece">Piece</option>
              <option value="set">Set</option>
              <option value="box">Box</option>
              <option value="pouch">Pouch</option>
              <option value="roll">Roll</option>
              <option value="sheet">Sheet</option>
            </select>
          </Field>
        </div>
        <p className="rounded-lg bg-inset px-3 py-2 text-sm text-muted">
          {requiredSerializationPolicy(itemClass) === "required"
            ? "One serial is required for every unit."
            : requiredSerializationPolicy(itemClass) === "asset_tag"
              ? "Every reusable tool requires its own asset tag."
              : "This item is monitored by quantity and barcode."}
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="h-4 w-4 rounded"
            checked={promotional}
            onChange={(e) => setPromotional(e.target.checked)}
          />
          <span className="text-sm text-muted">
            Promotional / give-away item
          </span>
        </label>
      </div>
    </Sheet>
  );
}
