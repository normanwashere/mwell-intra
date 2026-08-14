"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@intra/auth";
import { OnboardingCenter } from "@intra/learning";
import { MwellIntraLogo } from "@shell/components/MwellIntraLogo";

export default function VendorOnboardingPage() {
  const router = useRouter();
  const { profile, signOut } = useSession();

  return (
    <div className="min-h-screen bg-app">
      <header className="safe-top sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/vendor"
            aria-label="Vendor portal home"
            className="inline-flex min-h-11 items-center"
          >
            <MwellIntraLogo logoClassName="h-7" labelClassName="text-sm" />
          </Link>
          <span className="hidden border-l border-line pl-3 text-sm font-semibold text-ink md:block">
            Vendor onboarding
          </span>
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden max-w-48 truncate text-sm text-muted sm:block">
              {profile?.name ?? profile?.email ?? "Vendor"}
            </span>
            <Link href="/vendor" className="btn-ghost btn-sm">
              Vendor portal
            </Link>
            <button
              type="button"
              className="btn-outline btn-sm"
              onClick={() =>
                void signOut().then(() => {
                  router.replace("/login");
                })
              }
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <OnboardingCenter audience="vendor" />
      </main>
    </div>
  );
}
