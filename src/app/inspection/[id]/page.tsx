import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InspectionFlow } from "@/components/inspection/inspection-flow";

export default async function InspectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <InspectionFlow inspectionId={id} user={user} />;
}
