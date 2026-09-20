import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useSession } from "@intra/auth";
import { StockConversionRejectedError, validateStockConversion, type StockConversionBatch, type StockConversionCommand, type StockConversionWorkspace } from "@intra/data-kit";
import { useWarehouse } from "@/app/store";
import { Field, Icon } from "@/components/ui";

type DraftCommand = StockConversionCommand extends infer C ? C extends StockConversionCommand ? Omit<C, "idempotency_key"> : never : never;
const emptyWorkspace: StockConversionWorkspace = { recipes: [], batches: [], candidates: [], recovery_available: false };

export function StockConversionPanel() {
  const { profile } = useSession();
  return <StockConversionWork key={profile?.id ?? "anonymous"} />;
}

function StockConversionWork() {
  const { data, loadStockConversionWorkspace, executeStockConversion } = useWarehouse();
  const { mode, profile, userCapabilities } = useSession();
  const live = mode === "supabase";
  const caps = userCapabilities?.warehouse ?? [];
  const canOperate = caps.includes("manage_returns");
  const canProduct = userCapabilities?.product?.includes("decide_go_live") === true;
  const canQuality = caps.includes("inspect_quality");
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<StockConversionCommand | null>(null);
  const [recipeId, setRecipeId] = useState("");
  const [sourceBin, setSourceBin] = useState("");
  const [destinationBin, setDestinationBin] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [evidence, setEvidence] = useState("");
  const active = useRef(0);
  const loadRef = useRef(loadStockConversionWorkspace);
  loadRef.current = loadStockConversionWorkspace;
  const storageKey = `warehouse-stock-conversion:${profile?.id ?? "anonymous"}`;
  const canRead = live && (canOperate || canQuality);
  const refresh = useCallback(async () => {
    if (!canRead) return;
    const current = ++active.current;
    setLoading(true);
    try {
      const next = await loadRef.current();
      if (current === active.current) { setWorkspace(next); setLoaded(true); setError(""); }
    } catch (caught) {
      if (current === active.current) {
        setWorkspace(emptyWorkspace); setLoaded(false);
        const message = caught instanceof Error ? caught.message : "Conversion work could not be loaded.";
        setError(/schema cache|could not find the function|does not exist/i.test(message)
          ? "Stock conversion is unavailable until the governed service migration is released. Stock is unchanged."
          : message);
      }
    } finally { if (current === active.current) setLoading(false); }
  }, [canRead]);
  useEffect(() => {
    if (canRead) {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved) {
          const command: StockConversionCommand = JSON.parse(saved);
          if (!validateStockConversion(command).length) setPending(command);
        }
      } catch { setError("The saved conversion submission could not be restored."); }
      void refresh();
    }
    return () => { active.current++; };
  }, [canRead, refresh, storageKey]);

  async function submit(input: DraftCommand | StockConversionCommand) {
    if (busy) return;
    const command: StockConversionCommand = "idempotency_key" in input ? input : { ...input, idempotency_key: `stock-conversion-${crypto.randomUUID()}` };
    const errors = validateStockConversion(command);
    if (errors.length) { setError(errors.join(" ")); return; }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(command));
    } catch { setError("A durable retry key could not be saved. No conversion was submitted."); return; }
    setPending(command); setBusy(true); setError("");
    try {
      if (await executeStockConversion(command)) {
        sessionStorage.removeItem(storageKey); setPending(null); setSelected([]); setEvidence("");
        await refresh();
      } else setError("Submission was not confirmed. Retry the saved submission to recover its recorded result.");
    } catch (caught) {
      if (caught instanceof StockConversionRejectedError) {
        sessionStorage.removeItem(storageKey); setPending(null);
      }
      setError(caught instanceof Error ? caught.message : "Submission was not confirmed.");
    }
    finally { setBusy(false); }
  }

  if (!live) return <section aria-label="Stock conversion"><h3>Stock conversion</h3><p className="muted">Stock conversion requires the governed live service. Demo stock is unchanged.</p></section>;
  if (!canRead) return null;
  const recipe = workspace.recipes.find((row) => row.id === recipeId);
  const productName = (id: string) => data?.products.find((row) => row.id === id)?.name ?? id;
  const eventName = (id: string) => data?.events.find((row) => row.id === id)?.name ?? id;
  const bins = data?.storageAreas.filter((row) => row.active) ?? [];
  const candidates = workspace.candidates.filter((row) => row.product_id === recipe?.source_product_id && row.bin_id === sourceBin
    && (recipe.direction !== "recovery" || (row.return_id && row.allocation_id && row.original_conversion_id)));
  const disabled = busy || !!pending || loading || !loaded;
  function create(event: FormEvent) {
    event.preventDefault();
    if (!recipe) return;
    const source = bins.find((row) => row.id === sourceBin);
    const destination = bins.find((row) => row.id === destinationBin);
    if (!source || !destination) return;
    void submit({ action: "create", recipe_id: recipe.id, event_id: recipe.event_id,
      source_location_id: source.locationId, source_bin_id: source.id,
      destination_location_id: destination.locationId, destination_bin_id: destination.id, evidence_urls: [evidence],
      units: candidates.filter((row) => selected.includes(row.unit_id)).map((row) => ({ serial_number: row.serial_number, inspection_id: row.inspection_id,
        ...(recipe.direction === "recovery" ? { return_id: row.return_id, allocation_id: row.allocation_id, original_conversion_id: row.original_conversion_id } : {}) })),
    });
  }
  return <section aria-label="Stock conversion" className="stock-conversion-panel" style={{ minWidth: 0, display: "grid", gap: 16 }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <h3>Stock conversion</h3>
      <button type="button" className="btn btn-ghost" aria-label="Refresh conversion work" title="Refresh conversion work" disabled={loading || busy} onClick={() => void refresh()}><Icon name="rotate" /></button>
    </header>
    {loading && <p role="status">Loading conversion work...</p>}
    {error && <p role="alert" style={{ overflowWrap: "anywhere" }}>{error}</p>}
    {pending && <div role="status"><p>Unconfirmed submission: {pending.action.replaceAll("_", " ")}</p><button className="btn" type="button" disabled={busy} onClick={() => void submit(pending)}>Retry saved submission</button></div>}
    {!loading && !error && workspace.recipes.length === 0 && <p className="muted">No approved conversion recipes.</p>}
    {canProduct && <a href="/product#stock-conversion-recipes" className="text-sm underline">Product recipe approvals</a>}
    {canOperate && workspace.recipes.length > 0 && <form onSubmit={create}>
      <fieldset disabled={disabled} style={{ border: 0, padding: 0, minWidth: 0, display: "grid", gap: 12 }}>
        <legend>New conversion batch</legend>
        <Field label="Approved recipe" htmlFor="conversion-recipe"><select id="conversion-recipe" className="input" required value={recipeId} onChange={(e) => { setRecipeId(e.target.value); setSelected([]); }}>
          <option value="">Select recipe</option>{workspace.recipes.map((row) => <option key={row.id} value={row.id} disabled={row.direction === "recovery" && !workspace.recovery_available}>{eventName(row.event_id)}: {productName(row.source_product_id)} to {productName(row.output_product_id)} ({row.direction}, v{row.kit_version})</option>)}
        </select></Field>
        <Field label="Source bin" htmlFor="conversion-source"><select id="conversion-source" className="input" required value={sourceBin} onChange={(e) => { setSourceBin(e.target.value); setSelected([]); }}><option value="">Select source bin</option>{bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.code}</option>)}</select></Field>
        <Field label="Output bin" htmlFor="conversion-output"><select id="conversion-output" className="input" required value={destinationBin} onChange={(e) => setDestinationBin(e.target.value)}><option value="">Select output bin</option>{bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.code}</option>)}</select></Field>
        {recipe && sourceBin && <fieldset style={{ minWidth: 0, maxHeight: 320, overflowY: "auto" }}><legend>Inspected devices ({selected.length} selected)</legend>
          {!candidates.length && <p>No inspected source devices in this bin.</p>}
          {candidates.map((row) => <label key={row.unit_id} style={{ display: "flex", gap: 8, padding: 8, overflowWrap: "anywhere" }}><input type="checkbox" checked={selected.includes(row.unit_id)} disabled={!selected.includes(row.unit_id) && selected.length >= 100} onChange={(e) => setSelected((current) => e.target.checked ? [...current, row.unit_id] : current.filter((id) => id !== row.unit_id))} />{row.serial_number}</label>)}
        </fieldset>}
        {recipe && <ul>{recipe.packaging.map((row) => <li key={row.product_id}>{productName(row.product_id)}: {row.quantity * selected.length} {row.disposition}</li>)}</ul>}
        <Field label="Conversion evidence URL" htmlFor="conversion-evidence"><input id="conversion-evidence" className="input" type="url" required value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
        <button className="btn btn-primary" type="submit" disabled={!selected.length || !recipe}>Create conversion batch</button>
      </fieldset>
    </form>}
    {workspace.batches.map((batch) => <ConversionWorkRow key={batch.id} batch={batch} label={eventName(batch.event_id)} actorId={profile?.id ?? ""} canQuality={canQuality} canOperate={canOperate} disabled={disabled} submit={submit} />)}
  </section>;
}

function ConversionWorkRow({ batch, label, actorId, canQuality, canOperate, disabled, submit }: {
  batch: StockConversionBatch; label: string; actorId: string; canQuality: boolean; canOperate: boolean; disabled: boolean; submit: (command: DraftCommand) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState<string[]>([]);
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const terminal = batch.status === "completed" || batch.status === "cancelled";
  return <details style={{ borderTop: "1px solid var(--border)", paddingTop: 12, minWidth: 0 }}><summary style={{ overflowWrap: "anywhere" }}>{label}: {batch.units.length} devices, {batch.status} ({batch.id.slice(0, 8)})</summary>
    <fieldset disabled={disabled} style={{ border: 0, padding: "12px 0", minWidth: 0, display: "grid", gap: 12 }}>
      {batch.units.map((unit) => <label key={unit.serial_number} style={{ display: "flex", gap: 8, overflowWrap: "anywhere" }}>{canQuality && batch.status === "inspection" && actorId !== batch.created_by && <input type="checkbox" checked={confirmed.includes(unit.serial_number)} onChange={(e) => setConfirmed((items) => e.target.checked ? [...items, unit.serial_number] : items.filter((value) => value !== unit.serial_number))} />}{unit.serial_number}</label>)}
      {!terminal && <Field label="Action evidence URL" htmlFor={`evidence-${batch.id}`}><input id={`evidence-${batch.id}`} className="input" type="url" value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>}
      {canQuality && batch.status === "inspection" && actorId !== batch.created_by && <button className="btn btn-primary" type="button" disabled={!evidence || confirmed.length !== batch.units.length} onClick={() => void submit({ action: "approve", batch_id: batch.id, inspected_serial_numbers: confirmed, evidence_urls: [evidence] })}>Approve inspected open-box devices</button>}
      {canOperate && batch.status === "ready" && actorId !== batch.approved_by && <button className="btn btn-primary" type="button" disabled={!evidence} onClick={() => void submit({ action: "complete", batch_id: batch.id, evidence_urls: [evidence] })}>Complete conversion</button>}
      {canOperate && !terminal && <><Field label="Cancellation reason" htmlFor={`reason-${batch.id}`}><input id={`reason-${batch.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field><button className="btn" type="button" disabled={!evidence || !reason.trim()} onClick={() => void submit({ action: "cancel", batch_id: batch.id, reason, evidence_urls: [evidence] })}>Cancel unconsumed batch</button></>}
    </fieldset>
  </details>;
}
