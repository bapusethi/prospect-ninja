import { AppNav } from "@/components/AppNav";
import { requireUser } from "@/lib/session";
import { countDraftQueue, countReadyToSend } from "@/modules/outreach/service";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [draftCount, sendCount] = await Promise.all([
    countDraftQueue(user.id),
    countReadyToSend(user.id),
  ]);
  return (
    <AppNav
      userLabel={user.email}
      badges={{ "/drafts": draftCount, "/send": sendCount }}
    >
      {children}
    </AppNav>
  );
}
