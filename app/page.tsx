import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Cola de Espera</h1>
      <p className="text-muted-foreground">
        Gestión de reservas para tu restaurante, sin complicaciones.
      </p>
      <Link
        href="/login"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Ingresar al panel
      </Link>
    </main>
  );
}
