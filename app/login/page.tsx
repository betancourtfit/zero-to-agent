"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn("resend", { email, redirect: false });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <p className="text-center text-muted-foreground">
          Si tu email está autorizado, te enviamos un link en breve.
        </p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold">Acceder al panel</h1>
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <Input
          type="email"
          placeholder="tu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <Button type="submit">Enviar link</Button>
      </form>
    </main>
  );
}
