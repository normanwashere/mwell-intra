"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@intra/auth";
import { roleOrientationState, useLearning } from "@intra/learning";
import { Button, Icon } from "@intra/ui";
import {
  isOnboardingProtectedPath,
  onboardingHref,
} from "@shell/lib/onboardingGate";
import { BoundedLoadingState } from "./BoundedLoadingState";

export function OnboardingRouteGate({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { profile, loading: sessionLoading } = useSession();
  const { snapshot, loading: learningLoading, error, refresh } = useLearning();
  const orientation = roleOrientationState(snapshot);
  const protectedPath = isOnboardingProtectedPath(pathname);
  const employeeRoute = profile?.kind === "employee" && protectedPath;
  const checking = employeeRoute && (sessionLoading || learningLoading);
  const unavailable =
    employeeRoute && !checking && snapshot === null && Boolean(error);
  const blocked =
    employeeRoute &&
    !checking &&
    !unavailable &&
    (snapshot === null || (orientation.required && !orientation.complete));

  useEffect(() => {
    if (!blocked) return;
    router.replace(onboardingHref(pathname));
  }, [blocked, pathname, router]);

  if (!employeeRoute) return children;
  if (!checking && !blocked && !unavailable) return children;

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center bg-app px-6">
        <BoundedLoadingState
          label="Checking your onboarding..."
          recoveryOwner="Platform Support"
          className="py-24"
        />
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-app px-6 text-center">
      <div
        role={blocked || unavailable ? "alert" : "status"}
        className="max-w-md"
      >
        <Icon
          name={unavailable ? "alert" : "lock"}
          className="mx-auto h-7 w-7 text-brand-600"
        />
        <h1 className="mt-4 font-display text-xl font-bold text-ink">
          {unavailable
            ? "Onboarding status unavailable"
            : "Role orientation required"}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {unavailable
            ? error
            : "Complete your first-time role orientation before entering this workspace."}
        </p>
        {unavailable && (
          <Button
            variant="primary"
            size="sm"
            icon="rotate"
            className="mt-5"
            onClick={() => void refresh()}
          >
            Retry status check
          </Button>
        )}
      </div>
    </main>
  );
}
