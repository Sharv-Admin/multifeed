import { Suspense } from "react";
import { TeamInvitationContent } from "@/components/team/TeamInvitationContent";

export default async function TeamInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return (
    <Suspense fallback={<p role="status">Loading invitation...</p>}>
      <TeamInvitationContent code={code ?? ""} />
    </Suspense>
  );
}
