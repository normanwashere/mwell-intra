"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useCan, useSession } from "@intra/auth";
import { Field, Icon } from "@intra/ui";
import { approveStockRecipe, isEvidenceUrl, loadRecipeWorkspace, RecipeApprovalRejected, recipeServiceMessage, validateRecipeApproval,
  type RecipeApproval, type RecipeClient, type RecipePackaging, type RecipeWorkspace } from "./stockConversionRecipeRpc";

const empty: RecipeWorkspace = { kits: [], events: [], recipes: [] };

export function StockConversionRecipes() {
  const { profile, mode, supabaseClient } = useSession();
  const canApprove = useCan("product", "decide_go_live");
  if (!profile || !canApprove) return null;
  if (mode !== "supabase" || !supabaseClient) return <section id="stock-conversion-recipes" className="space-y-3">
    <h2 className="font-display text-lg font-bold">Stock conversion recipes</h2>
    <p className="text-sm text-muted">Recipe approval requires the governed live service. Demo stock is unchanged.</p>
  </section>;
  return <RecipeApprovalWorkspace key={profile.id} actorId={profile.id} client={supabaseClient} />;
}

function RecipeApprovalWorkspace({ actorId, client }: { actorId: string; client: RecipeClient }) {
  const [workspace, setWorkspace] = useState(empty);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<RecipeApproval | null>(null);
  const [kitId, setKitId] = useState("");
  const [eventId, setEventId] = useState("");
  const [direction, setDirection] = useState<"conversion" | "recovery">("conversion");
  const [dispositions, setDispositions] = useState<Record<string, "recover" | "discard">>({});
  const [reference, setReference] = useState("");
  const [evidence, setEvidence] = useState("");
  const generation = useRef(0);
  const sending = useRef(false);
  const storageKey = `product-stock-conversion:${actorId}`;
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const data = await loadRecipeWorkspace(client);
      if (current === generation.current) { setWorkspace(data); setLoaded(true); setError(""); }
    } catch (cause) {
      if (current === generation.current) { setWorkspace(empty); setLoaded(false); setError(recipeServiceMessage(cause)); }
    } finally { if (current === generation.current) setLoading(false); }
  }, [client]);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) { const command: RecipeApproval = JSON.parse(saved); validateRecipeApproval(command); setPending(command); }
    } catch { setError("The saved approval could not be restored. Review the approval history before submitting again."); }
    void refresh();
    return () => { generation.current++; };
  }, [refresh, storageKey]);

  async function send(command: RecipeApproval) {
    if (sending.current) return;
    try { validateRecipeApproval(command); sessionStorage.setItem(storageKey, JSON.stringify(command)); }
    catch (cause) { setError(cause instanceof RecipeApprovalRejected ? cause.message : "A durable retry key could not be saved. No approval was submitted."); return; }
    sending.current = true;
    setPending(command); setBusy(true); setError(""); setNotice("");
    try {
      await approveStockRecipe(client, command);
      sessionStorage.removeItem(storageKey); setPending(null);
      setReference(""); setEvidence("");
      setNotice("Recipe approved. Warehouse can now select it for a conversion batch.");
      await refresh();
    } catch (cause) {
      if (cause instanceof RecipeApprovalRejected) { sessionStorage.removeItem(storageKey); setPending(null); }
      setError(recipeServiceMessage(cause));
    } finally { sending.current = false; setBusy(false); }
  }

  const kit = workspace.kits.find((row) => row.id === kitId);
  const selectedEvent = workspace.events.find((row) => row.id === eventId);
  const valid = kit && selectedEvent && (direction === "recovery" ? kit.recovery_ready : selectedEvent.status !== "closed")
    && reference.trim() && isEvidenceUrl(evidence) && (direction === "conversion" || kit.packaging.every((p) => dispositions[p.product_id]));
  const disabled = loading || !loaded || busy || !!pending;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!kit || !valid || disabled) return;
    const packaging: RecipePackaging[] = kit.packaging.map((p) => ({ product_id: p.product_id, quantity: p.quantity,
      disposition: direction === "conversion" ? "consume" : dispositions[p.product_id]! }));
    void send({ action: "approve_recipe", idempotency_key: `product-recipe-${crypto.randomUUID()}`, kit_definition_id: kit.id,
      event_id: eventId, direction, source_product_id: direction === "conversion" ? kit.base_product_id : kit.product_id,
      output_product_id: direction === "conversion" ? kit.product_id : kit.base_product_id,
      approval_reference: reference.trim(), evidence_urls: [evidence.trim()], packaging });
  }

  return <section id="stock-conversion-recipes" aria-labelledby="stock-conversion-recipes-title" className="min-w-0 space-y-4 border-t border-line pt-5 [overflow-wrap:anywhere]">
    <header className="flex items-center justify-between gap-3">
      <h2 id="stock-conversion-recipes-title" className="font-display text-lg font-bold">Stock conversion recipes</h2>
      <button className="btn-ghost min-h-11 shrink-0" type="button" aria-label="Refresh recipe approvals" title="Refresh recipe approvals" disabled={loading || busy} onClick={() => void refresh()}><Icon name="rotate" className="h-4 w-4" /></button>
    </header>
    {loading && <p role="status" className="text-sm">Loading approved kits and recipes...</p>}
    {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
    {pending && <div className="space-y-2 border-l-2 border-amber-500 pl-3 text-sm">
      <p>Approval confirmation pending: {pending.approval_reference}</p>
      <button className="btn-secondary min-h-11" type="button" disabled={busy} onClick={() => void send(pending)}>Retry saved approval</button>
    </div>}
    {loaded && !workspace.kits.length && <p className="text-sm text-muted">No eligible Product-approved kit definitions with acknowledged readiness.</p>}
    <form onSubmit={submit}>
      <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="Approved kit definition" htmlFor="product-conversion-kit"><select className="input w-full min-w-0" id="product-conversion-kit" required value={kitId} onChange={(e) => { setKitId(e.target.value); setDispositions({}); }}>
          <option value="">Select kit</option>{workspace.kits.map((row) => <option key={row.id} value={row.id}>{row.name} v{row.version}</option>)}
        </select></Field>
        <Field label="Recipe direction" htmlFor="product-conversion-direction"><select className="input w-full min-w-0" id="product-conversion-direction" value={direction} onChange={(e) => { setDirection(e.target.value as "conversion" | "recovery"); setDispositions({}); }}>
          <option value="conversion">Base stock to event variant</option><option value="recovery" disabled={kit && !kit.recovery_ready}>Returned variant to base stock</option>
        </select></Field>
        <Field label="Event" htmlFor="product-conversion-event"><select className="input w-full min-w-0" id="product-conversion-event" required value={eventId} onChange={(e) => setEventId(e.target.value)}>
          <option value="">Select event</option>{workspace.events.map((row) => <option key={row.id} value={row.id} disabled={direction === "conversion" && row.status === "closed"}>{row.name}{row.status === "closed" ? " (closed)" : ""}</option>)}
        </select></Field>
        {kit && <p className="self-center text-sm">{direction === "conversion" ? kit.base_product_name : kit.product_name} to {direction === "conversion" ? kit.product_name : kit.base_product_name}. Device serial retained.</p>}
        {kit?.packaging.map((part) => <div key={part.product_id} className="min-w-0 text-sm">
          {direction === "conversion" ? <p>{part.name}: consume {part.quantity} per device</p>
            : <Field label={`${part.name} disposition`} htmlFor={`product-packaging-${part.product_id}`}><select id={`product-packaging-${part.product_id}`} className="input w-full min-w-0" required value={dispositions[part.product_id] ?? ""} onChange={(e) => setDispositions((current) => ({ ...current, [part.product_id]: e.target.value as "recover" | "discard" }))}>
              <option value="">Select disposition ({part.quantity} per device)</option><option value="recover">Recover to stock</option><option value="discard">Discard</option>
            </select></Field>}
        </div>)}
        <Field label="Product approval reference" htmlFor="product-conversion-reference"><input id="product-conversion-reference" className="input w-full min-w-0" required value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Product approval evidence URL" htmlFor="product-conversion-evidence"><input id="product-conversion-evidence" type="url" className="input w-full min-w-0" required value={evidence} onChange={(e) => setEvidence(e.target.value)} /></Field>
        <div className="sm:col-span-2"><button className="btn-primary min-h-11" type="submit" disabled={disabled || !valid} aria-busy={busy}><Icon name="check" className="h-4 w-4" />{busy ? "Approving recipe..." : "Approve recipe"}</button></div>
      </fieldset>
    </form>
    <div className="space-y-3 border-t border-line pt-4">
      <h3 className="text-base font-semibold">Recent recipe approvals</h3>
      {loaded && !workspace.recipes.length && <p className="text-sm text-muted">No recipes approved.</p>}
      {workspace.recipes.map((row) => <details key={row.id} className="min-w-0 border-b border-line pb-3 text-sm">
        <summary className="min-h-11 cursor-pointer py-2">{row.event_name}: {row.source_product_name} to {row.output_product_name} ({row.direction}, v{row.kit_version})</summary>
        <div className="space-y-2 pt-2">
          <p>{row.approval_reference}</p><p>Approved by {row.approved_by} at {new Date(row.approved_at).toLocaleString()}</p>
          <p>Kit: {row.kit_name}. Recipe: {row.id}</p>
          <ul>{row.packaging.map((p) => <li key={p.product_id}>{p.product_id}: {p.quantity} {p.disposition} per device</li>)}</ul>
          {row.evidence_urls.filter(isEvidenceUrl).map((url, index) => <a key={url} className="mr-4 inline-flex min-h-11 items-center underline" href={url} target="_blank" rel="noopener noreferrer">Approval evidence {index + 1}</a>)}
        </div>
      </details>)}
    </div>
  </section>;
}
