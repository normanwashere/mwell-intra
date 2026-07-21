import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import type { Product } from "@intra/data-kit";
import { EmptyState, Sheet } from "@/components/ui";
import { Icon } from "@/components/Icon";

function BarcodeGraphic({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: "CODE128",
      displayValue: false,
      height: 42,
      margin: 0,
      width: 1.5,
    });
  }, [value]);
  return <svg ref={ref} role="img" aria-label={`Barcode ${value}`} />;
}

export function BarcodeLabelSheet({
  open,
  onOpenChange,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}) {
  const printable = products.filter((product) => {
    const itemClass =
      product.itemClass ??
      (product.category === "device" ? "sellable_sku" : "merchandise");
    return (
      Boolean(product.barcode) &&
      !product.serialized &&
      ["merchandise", "event_material", "fulfillment_supply"].includes(
        itemClass,
      )
    );
  });
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Barcode label sheet"
      description="One scannable master label per quantity-controlled item. Print additional copies as needed at the storage point."
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          onClick={() => window.print()}
          disabled={printable.length === 0}
        >
          <Icon name="download" className="h-4 w-4" /> Print label sheet
        </button>
      }
    >
      {printable.length === 0 ? (
        <EmptyState
          icon="tag"
          title="No printable barcodes"
          message="Add a barcode to a merchandise, event-material, or fulfillment-supply product."
        />
      ) : (
        <div className="barcode-print-surface grid grid-cols-2 gap-3 bg-white p-1 text-slate-950 sm:grid-cols-3">
          {printable.map((product) => (
            <article
              key={product.id}
              className="flex min-h-36 flex-col justify-between border border-slate-300 p-3"
            >
              <div>
                <p className="text-sm font-bold leading-5">{product.name}</p>
                <p className="font-mono text-xs text-slate-600">
                  {product.sku}
                </p>
              </div>
              <div className="mt-3 overflow-hidden">
                <BarcodeGraphic value={product.barcode!} />
                <p className="mt-1 text-center font-mono text-[10px]">
                  {product.barcode}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </Sheet>
  );
}
