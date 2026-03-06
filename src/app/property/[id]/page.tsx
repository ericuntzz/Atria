import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PropertyDetail } from "@/components/property/property-detail";

export default async function PropertyPage({
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

  return <PropertyDetail propertyId={id} user={user} />;
}
