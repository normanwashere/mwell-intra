import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@shell/lib/supabase/server";
import { recordAuthorizedSimulationChoice } from "../../../../../../modules/learning/src/simulationChoiceAuthority.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChoiceCommand {
  assignmentRequirementId: string;
  attemptId: string;
  simulationId: string;
  checkpointId: string;
  choiceId: string;
  idempotencyKey: string;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_KEYS = [
  "assignmentRequirementId",
  "attemptId",
  "simulationId",
  "checkpointId",
  "choiceId",
  "idempotencyKey",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseCommand(value: unknown): ChoiceCommand {
  if (!isRecord(value)) throw new Error("A choice command object is required.");
  if (
    Object.keys(value).length !== COMMAND_KEYS.length ||
    Object.keys(value).some(
      (key) => !COMMAND_KEYS.includes(key as (typeof COMMAND_KEYS)[number]),
    )
  ) {
    throw new Error("Choice command fields are invalid.");
  }
  for (const key of COMMAND_KEYS) {
    const field = value[key];
    if (typeof field !== "string" || !field.trim() || field.length > 200) {
      throw new Error(`Choice command ${key} is invalid.`);
    }
  }
  if (!UUID_PATTERN.test(String(value.idempotencyKey))) {
    throw new Error("Choice command idempotencyKey is invalid.");
  }
  return value as unknown as ChoiceCommand;
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return json(
      { error: "Cross-origin choice commands are not allowed." },
      403,
    );
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 4096) {
    return json({ error: "Choice command is too large." }, 413);
  }

  let command: ChoiceCommand;
  try {
    command = parseCommand(await request.json());
  } catch (cause) {
    return json(
      {
        error:
          cause instanceof Error ? cause.message : "Choice command is invalid.",
      },
      400,
    );
  }

  const memoryMode = process.env.NEXT_PUBLIC_DATA_SOURCE === "memory";
  if (memoryMode) {
    try {
      const evaluation = await recordAuthorizedSimulationChoice(
        command,
        async () => undefined,
      );
      return json({ ...evaluation, recorded: false });
    } catch {
      return json({ error: "Choice is not available for this practice." }, 400);
    }
  }

  const client = await createSupabaseServerClient("learning");
  if (!client) return json({ error: "Learning service is unavailable." }, 503);
  const { data, error: authError } = await client.auth.getUser();
  if (authError || !data.user) {
    return json({ error: "Authentication required." }, 401);
  }

  try {
    const evaluation = await recordAuthorizedSimulationChoice(
      command,
      async () => {
        const { error } = await client.rpc("record_simulation_checkpoint", {
          payload: {
            assignment_requirement_id: command.assignmentRequirementId,
            attempt_id: command.attemptId,
            checkpoint_id: command.checkpointId,
            outcome_id: command.choiceId,
            idempotency_key: command.idempotencyKey,
          },
        });
        if (error) throw new Error(error.message);
      },
    );
    return json({ ...evaluation, recorded: evaluation.accepted });
  } catch {
    return json({ error: "Choice progress could not be recorded." }, 403);
  }
}
