"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Reopen dialog for no_show rows in the history table (STAFF-09 / D-18).
// Wraps base-ui AlertDialog with the locked Spanish copy from UI-SPEC §"Reopen flow".
// Controlled open state: the Confirmar button closes the dialog via setOpen(false)
// AFTER the POST resolves (success or error), not before — so loading state is visible.
// Loading state disables Confirmar during POST (T-03-05-06 DoS mitigation).

interface ReopenDialogProps {
  reservationId: string;
  diner_name: string;
  onReopened: () => void;
}

export function ReopenDialog({
  reservationId,
  diner_name,
  onReopened,
}: ReopenDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      const res = await fetch(`/api/queue/${reservationId}/reopen`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (res.ok && body.ok) {
        setOpen(false);
        toast.success("Reserva reabierta. Aparece en la cola activa.");
        onReopened();
      } else {
        toast.error(body?.error?.message ?? "No pudimos reabrir la reserva.");
      }
    } catch {
      toast.error("Error de red. Probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(value) => setOpen(value)}>
      <AlertDialogTrigger
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[44px]"
        aria-label={`Reabrir reserva de ${diner_name}`}
      >
        Reabrir
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Confirmás reabrir?</AlertDialogTitle>
          <AlertDialogDescription>
            Se va a crear una nueva entrada en la cola activa.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={loading}>
            Confirmar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
