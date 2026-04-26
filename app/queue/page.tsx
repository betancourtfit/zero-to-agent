import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/auth";

export default async function QueuePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <p className="text-lg">
        Hola {session.user.email} — panel próximamente
      </p>
    </main>
  );
}
