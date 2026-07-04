// Warehouse module layout — full-screen mount. The suite AppShell is skipped for
// `/warehouse/*` via ChromeGate; this layout only provides a minimal viewport
// shell so the module's own AppShell fills the screen.

import type { ReactNode } from 'react';

export default function WarehouseLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-app">{children}</div>;
}
