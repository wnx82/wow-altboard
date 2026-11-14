import { DashboardShell } from "@/components/dashboard-shell";
import { requireSession } from "@/lib/auth/session";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  // Ce contrôle ne protège que l'en-tête : chaque page refait le sien (voir requireSession).
  const session = await requireSession();
  return <DashboardShell email={session.email}>{children}</DashboardShell>;
}
