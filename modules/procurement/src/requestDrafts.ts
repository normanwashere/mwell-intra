export interface RequestDraftRecord<TPayload = Record<string, unknown>> {
  id: string;
  clientKey: string;
  version: number;
  payload: TPayload;
  updatedAt: string;
}

export interface RequestDraftClient {
  schema(name: "procurement"): {
    rpc(
      name: string,
      args: { payload: Record<string, unknown> },
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };
}

type DraftRow = {
  id?: unknown;
  client_key?: unknown;
  draft_version?: unknown;
  draft_payload?: unknown;
  updated_at?: unknown;
};

function mapDraft<TPayload>(value: unknown): RequestDraftRecord<TPayload> | null {
  if (!value || typeof value !== "object") return null;
  const row = value as DraftRow;
  if (typeof row.id !== "string" || typeof row.client_key !== "string") {
    return null;
  }
  return {
    id: row.id,
    clientKey: row.client_key,
    version: Number(row.draft_version ?? 0),
    payload: (row.draft_payload ?? {}) as TPayload,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

async function callDraftRpc(
  client: RequestDraftClient,
  name: string,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client
    .schema("procurement")
    .rpc(name, { payload });
  if (error) throw new Error(error.message);
  return data;
}

export async function loadLatestRequestDraft<TPayload>(
  client: RequestDraftClient,
): Promise<RequestDraftRecord<TPayload> | null> {
  return mapDraft<TPayload>(
    await callDraftRpc(client, "get_latest_request_draft", {}),
  );
}

export async function saveRequestDraft<TPayload>(
  client: RequestDraftClient,
  input: {
    clientKey: string;
    expectedVersion?: number;
    payload: TPayload;
  },
): Promise<RequestDraftRecord<TPayload>> {
  const row = mapDraft<TPayload>(
    await callDraftRpc(client, "save_request_draft", {
      client_key: input.clientKey,
      expected_version: input.expectedVersion,
      draft: input.payload,
    }),
  );
  if (!row) throw new Error("The draft server returned an invalid response.");
  return row;
}

export async function discardRequestDraft(
  client: RequestDraftClient,
  id: string,
): Promise<void> {
  await callDraftRpc(client, "discard_request_draft", { id });
}

export function requestCreationRpc(draftId?: string):
  | "create_request"
  | "finalize_request_draft" {
  return draftId ? "finalize_request_draft" : "create_request";
}
