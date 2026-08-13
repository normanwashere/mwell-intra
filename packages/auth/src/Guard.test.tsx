import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import type { MemoryProfile } from "./contracts";
import { SessionProvider, useSession } from "./SessionProvider";
import { Guard, useCan } from "./Guard";

beforeEach(() => {
  // The provider persists the memory-mode session per tab; make sure each test
  // starts signed out so the previous test's session doesn't leak in.
  window.sessionStorage.clear();
});

// logistics_supervisor grants `receive_stock` (not `reserve_allocate`);
// business_unit grants governed stock requests (not custody or receiving).
const PROFILES: MemoryProfile[] = [
  {
    id: "sup",
    email: "sup@mwell.test",
    kind: "employee",
    roles: { warehouse: ["logistics_supervisor"] },
  },
  {
    id: "bu",
    email: "bu@mwell.test",
    kind: "employee",
    roles: { warehouse: ["business_unit"] },
  },
];

/** Signs in as `email` on mount and renders the resolved email once ready. */
function SignInOnMount({ email }: { email: string }) {
  const { signInWithPassword, profile } = useSession();
  useEffect(() => {
    void signInWithPassword(email, "demo");
  }, [signInWithPassword, email]);
  return <span data-testid="who">{profile?.email ?? "anon"}</span>;
}

function CanProbe({
  cap,
}: {
  cap: "receive_stock" | "reserve_allocate" | "request_stock";
}) {
  const allowed = useCan("warehouse", cap);
  return <span data-testid="probe">{allowed ? "yes" : "no"}</span>;
}

function LiveSessionProbe() {
  const { profile, roleCapabilities, userCapabilities, refreshCapabilities, loading } = useSession();
  const [refreshResult, setRefreshResult] = useState("idle");
  const canReceive = useCan("warehouse", "receive_stock");
  const canReserve = useCan("warehouse", "reserve_allocate");
  return (
    <div>
      <span data-testid="live-user">{profile?.email ?? "anon"}</span>
      <span data-testid="live-capabilities">
        {userCapabilities?.warehouse?.join(",") ?? "none"}
      </span>
      <span data-testid="role-capabilities">
        {roleCapabilities?.warehouse?.join(",") ?? "none"}
      </span>
      <span data-testid="live-receive">{canReceive ? "yes" : "no"}</span>
      <span data-testid="live-reserve">{canReserve ? "yes" : "no"}</span>
      <span data-testid="live-loading">{loading ? "loading" : "ready"}</span>
      <span data-testid="refresh-result">{refreshResult}</span>
      <button type="button" onClick={() => void refreshCapabilities().then((ok) => setRefreshResult(ok ? "ok" : "failed"))}>
        Refresh capabilities
      </button>
    </div>
  );
}

function dualProjectionClient() {
  const user = {
    id: "live-dual-user",
    email: "dual@mwell.test",
    app_metadata: { roles: { warehouse: ["business_unit"] } },
    user_metadata: {},
  } as unknown as User;
  const session = { user } as Session;
  const rpc = vi.fn().mockResolvedValue({
    data: {
      roleCapabilities: {
        warehouse: ["request_stock", "receive_stock"],
      },
      userCapabilities: { warehouse: ["request_stock"] },
    },
    error: null,
  });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    schema: vi.fn().mockReturnValue({ rpc }),
  } as unknown as SupabaseClient<Record<string, unknown>, string>;
  return { client, rpc };
}

function liveClient() {
  const user = {
    id: "live-user",
    email: "live@mwell.test",
    app_metadata: { roles: { warehouse: ["business_unit"] } },
    user_metadata: {},
  } as unknown as User;
  const session = { user } as Session;
  const rpc = vi.fn().mockResolvedValue({
    data: {
      roleCapabilities: {
        warehouse: ["receive_stock", "reserve_allocate"],
      },
      userCapabilities: { warehouse: ["receive_stock"] },
    },
    error: null,
  });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    schema: vi.fn().mockReturnValue({ rpc }),
  } as unknown as SupabaseClient<Record<string, unknown>, string>;
  return { client, rpc };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function transitionClient() {
  const makeUser = (id: string, capabilityRole: string) =>
    ({
      id,
      email: `${id}@mwell.test`,
      app_metadata: { roles: { warehouse: [capabilityRole] } },
      user_metadata: {},
    }) as unknown as User;
  const userA = makeUser("user-a", "business_unit");
  const sessionA = { user: userA } as Session;
  let authListener:
    ((_event: string, session: Session | null) => void) | undefined;
  const rpc = vi.fn().mockResolvedValue({
    data: {
      roleCapabilities: {
        warehouse: ["receive_stock", "reserve_allocate"],
      },
      userCapabilities: { warehouse: ["receive_stock"] },
    },
    error: null,
  });
  const getUser = vi
    .fn()
    .mockResolvedValue({ data: { user: userA }, error: null });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: sessionA } }),
      getUser,
      onAuthStateChange: vi.fn().mockImplementation((listener) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
    schema: vi.fn().mockReturnValue({ rpc }),
  } as unknown as SupabaseClient<Record<string, unknown>, string>;
  return {
    client,
    getUser,
    makeUser,
    rpc,
    emit: (session: Session | null) => authListener?.("SIGNED_IN", session),
  };
}

describe("<Guard>", () => {
  it("denies (renders accessible fallback) when the session has no roles", async () => {
    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    // Guard renders null while the session is restoring; wait for the fallback.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Access denied");
    expect(alert.textContent).toContain("Back to dashboard");
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Access denied for this page",
      }),
    ).not.toBeNull();
    expect(screen.queryByText("secret content")).toBeNull();
  });

  it("renders children once a role granting the capability is present", async () => {
    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <SignInOnMount email="sup@mwell.test" />
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    await screen.findByText("sup@mwell.test");
    expect(screen.queryByText("secret content")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stays scoped: a role without the capability is denied", async () => {
    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <SignInOnMount email="bu@mwell.test" />
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    await screen.findByText("bu@mwell.test");
    expect(screen.queryByText("secret content")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Access denied");
  });

  it("renders a custom fallback when provided", async () => {
    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <Guard
          module="warehouse"
          cap="receive_stock"
          fallback={<div>please request access</div>}
        >
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    await screen.findByText("please request access");
    expect(screen.queryByText("secret content")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("useCan", () => {
  it("loads raw role and effective capability projections together", async () => {
    const { client, rpc } = dualProjectionClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );

    await screen.findByText("dual@mwell.test");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "my_capability_snapshot",
    ]);
    expect(screen.getByTestId("role-capabilities").textContent).toBe(
      "request_stock,receive_stock",
    );
    expect(screen.getByTestId("live-capabilities").textContent).toBe(
      "request_stock",
    );
    expect(screen.getByTestId("live-receive").textContent).toBe("no");
  });

  it("uses the verified live my_capabilities snapshot in Supabase mode", async () => {
    const { client, rpc } = liveClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );

    await screen.findByText("live@mwell.test");
    expect(rpc).toHaveBeenCalledWith("my_capability_snapshot");
    expect(screen.getByTestId("live-capabilities").textContent).toBe(
      "receive_stock",
    );
    expect(screen.getByTestId("live-receive").textContent).toBe("yes");
    expect(screen.getByTestId("live-reserve").textContent).toBe("no");
  });

  it("refreshes effective capabilities immediately after a governed state change", async () => {
    const { client, rpc } = liveClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );
    await screen.findByText("live@mwell.test");
    expect(screen.getByTestId("live-reserve").textContent).toBe("no");

    rpc.mockResolvedValueOnce({
      data: {
        roleCapabilities: { warehouse: ["receive_stock", "reserve_allocate"] },
        userCapabilities: { warehouse: ["receive_stock", "reserve_allocate"] },
      },
      error: null,
    });
    await act(async () => {
      screen.getByRole("button", { name: "Refresh capabilities" }).click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("live-reserve").textContent).toBe("yes"),
    );
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("refresh-result").textContent).toBe("ok");
  });

  it("reports a governed capability refresh failure while keeping authority empty", async () => {
    const { client, rpc } = liveClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );
    await screen.findByText("live@mwell.test");
    rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") });

    await act(async () => {
      screen.getByRole("button", { name: "Refresh capabilities" }).click();
    });

    await waitFor(() => expect(screen.getByTestId("refresh-result").textContent).toBe("failed"));
    expect(screen.getByTestId("role-capabilities").textContent).toBe("none");
    expect(screen.getByTestId("live-capabilities").textContent).toBe("none");
  });

  it("keeps verified identity but fails closed when live capabilities cannot load", async () => {
    const { client, rpc } = liveClient();
    rpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === "my_capability_snapshot"
          ? { data: null, error: new Error("offline") }
          : {
              data: { warehouse: ["receive_stock", "reserve_allocate"] },
              error: null,
            },
      ),
    );

    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );

    await screen.findByText("live@mwell.test");
    expect(screen.getByTestId("role-capabilities").textContent).toBe("none");
    expect(screen.getByTestId("live-capabilities").textContent).toBe("none");
    expect(screen.getByTestId("live-receive").textContent).toBe("no");
    expect(screen.getByTestId("live-reserve").textContent).toBe("no");
  });

  it.each([
    {
      label: "raw projection",
      snapshot: {
        roleCapabilities: { warehouse: "receive_stock" },
        userCapabilities: { warehouse: ["receive_stock"] },
      },
    },
    {
      label: "effective projection",
      snapshot: {
        roleCapabilities: { warehouse: ["receive_stock"] },
        userCapabilities: { warehouse: ["receive_stock", 42] },
      },
    },
  ])("fails the entire atomic snapshot closed for a malformed $label", async ({ snapshot }) => {
    const { client, rpc } = liveClient();
    rpc.mockResolvedValue({ data: snapshot, error: null });

    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );

    await screen.findByText("live@mwell.test");
    expect(screen.getByTestId("role-capabilities").textContent).toBe("none");
    expect(screen.getByTestId("live-capabilities").textContent).toBe("none");
    expect(screen.getByTestId("live-receive").textContent).toBe("no");
  });

  it("keeps the verified screen stable until a fresh focus snapshot replaces capabilities", async () => {
    const { client, rpc } = liveClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );
    await screen.findByText("live@mwell.test");

    const refresh = deferred<{ data: unknown; error: null }>();
    rpc.mockImplementationOnce(() => refresh.promise);
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("live-loading").textContent).toBe("ready");
      expect(screen.getByTestId("role-capabilities").textContent).toBe(
        "receive_stock,reserve_allocate",
      );
      expect(screen.getByTestId("live-capabilities").textContent).toBe(
        "receive_stock",
      );
    });

    await act(async () => {
      refresh.resolve({
        data: {
          roleCapabilities: { warehouse: ["reserve_allocate"] },
          userCapabilities: { warehouse: ["reserve_allocate"] },
        },
        error: null,
      });
      await refresh.promise;
    });
    await waitFor(() => {
      expect(screen.getByTestId("live-loading").textContent).toBe("ready");
      expect(screen.getByTestId("live-reserve").textContent).toBe("yes");
      expect(screen.getByTestId("live-receive").textContent).toBe("no");
    });
  });

  it("does not let a stale capability refresh overwrite the latest user", async () => {
    const { client, emit, getUser, makeUser, rpc } = transitionClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );
    await screen.findByText("user-a@mwell.test");

    const userB = makeUser("user-b", "warehouse_operator");
    const userC = makeUser("user-c", "warehouse_supervisor");
    const staleRefresh = deferred<{ data: unknown; error: null }>();
    getUser
      .mockResolvedValueOnce({ data: { user: userB }, error: null })
      .mockResolvedValueOnce({ data: { user: userC }, error: null });
    rpc
      .mockImplementationOnce(() => staleRefresh.promise)
      .mockResolvedValueOnce({
        data: {
          roleCapabilities: {
            warehouse: ["reserve_allocate", "receive_stock"],
          },
          userCapabilities: { warehouse: ["reserve_allocate"] },
        },
        error: null,
      });

    emit({ user: userB } as Session);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    emit({ user: userC } as Session);
    await screen.findByText("user-c@mwell.test");
    expect(screen.getByTestId("live-reserve").textContent).toBe("yes");
    expect(screen.getByTestId("role-capabilities").textContent).toBe(
      "reserve_allocate,receive_stock",
    );

    await act(async () => {
      staleRefresh.resolve({
        data: {
          roleCapabilities: { warehouse: ["receive_stock"] },
          userCapabilities: { warehouse: ["receive_stock"] },
        },
        error: null,
      });
      await staleRefresh.promise;
    });
    expect(screen.getByTestId("live-user").textContent).toBe(
      "user-c@mwell.test",
    );
    expect(screen.getByTestId("live-reserve").textContent).toBe("yes");
    expect(screen.getByTestId("role-capabilities").textContent).toBe(
      "reserve_allocate,receive_stock",
    );
  });

  it("does not call Supabase again inside the auth-state callback", async () => {
    const { client, emit, getUser, makeUser } = transitionClient();
    render(
      <SessionProvider config={{ mode: "supabase", client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );
    await screen.findByText("user-a@mwell.test");

    const callsBeforeEvent = getUser.mock.calls.length;
    const userB = makeUser("user-b", "warehouse_operator");
    getUser.mockResolvedValueOnce({ data: { user: userB }, error: null });
    emit({ user: userB } as Session);

    expect(getUser).toHaveBeenCalledTimes(callsBeforeEvent);
    await screen.findByText("user-b@mwell.test");
    expect(getUser).toHaveBeenCalledTimes(callsBeforeEvent + 1);
  });

  it("reflects the scoped capability of the signed-in roles", async () => {
    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <SignInOnMount email="bu@mwell.test" />
        <CanProbe cap="request_stock" />
      </SessionProvider>,
    );
    await screen.findByText("bu@mwell.test");
    expect(screen.getByTestId("probe").textContent).toBe("yes");
  });

  it("returns false for a capability the roles do not grant", async () => {
    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <SignInOnMount email="bu@mwell.test" />
        <CanProbe cap="receive_stock" />
      </SessionProvider>,
    );
    await screen.findByText("bu@mwell.test");
    expect(screen.getByTestId("probe").textContent).toBe("no");
  });

  it("restores memory authority from the current profile contract, not stored roles", async () => {
    window.sessionStorage.setItem(
      "intra.memory-session.v1",
      JSON.stringify({
        profileId: "sup",
        roles: { warehouse: ["business_unit"] },
      }),
    );

    render(
      <SessionProvider config={{ mode: "memory", profiles: PROFILES }}>
        <CanProbe cap="receive_stock" />
      </SessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("yes"));
  });
});
