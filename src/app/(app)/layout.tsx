import { AppNav } from "@/components/AppNav";
import { requireUser } from "@/lib/session";
import { countDraftQueue } from "@/modules/outreach/service";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const draftCount = await countDraftQueue(user.id);
  return (
    <AppNav
      userLabel={user.email}
      badges={{ "/drafts": draftCount }}
    >
      {children}
    </AppNav>
  );
}
