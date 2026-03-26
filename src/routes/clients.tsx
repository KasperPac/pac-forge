import { useState } from "react";
import { Plus, Building2, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useClients, useCreateClient, useUpdateClient, useDeleteClient } from "@/hooks/use-clients";
import type { Client, ClientCreate } from "@/types";

export default function ClientsPage() {
  const { data: clients, isLoading, error } = useClients();
  const createClient = useCreateClient();
  const updateClient = useUpdateClient();
  const deleteClient = useDeleteClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  function handleSave(data: ClientCreate) {
    if (editing) {
      updateClient.mutate({ id: editing.id, ...data }, {
        onSuccess: () => { setDialogOpen(false); setEditing(null); },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          toast({ title: "Failed to update client", description: msg, variant: "destructive" });
        },
      });
    } else {
      createClient.mutate(data, {
        onSuccess: () => { setDialogOpen(false); },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          toast({ title: "Failed to create client", description: msg, variant: "destructive" });
        },
      });
    }
  }

  function handleDelete(id: string) {
    if (window.confirm("Delete this client? Projects will keep their client name but lose the link.")) {
      deleteClient.mutate(id, {
        onError: (err) => {
          const msg = err instanceof Error ? err.message : JSON.stringify(err);
          toast({ title: "Failed to delete client", description: msg, variant: "destructive" });
        },
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-muted-foreground">PAC-FORGE</div>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Building2 className="h-5 w-5" />
            Clients
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your client list. Projects are grouped by client.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Client
        </Button>
      </div>

      <Separator />

      {isLoading && (
        <div className="py-12 text-center font-mono text-sm text-muted-foreground">
          Loading clients...
        </div>
      )}

      {error && (
        <div className="rounded-md bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          Failed to load clients: {error.message}
        </div>
      )}

      {clients && clients.length === 0 && (
        <div className="py-12 text-center">
          <p className="font-mono text-sm text-muted-foreground">No clients yet.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            Add your first client
          </Button>
        </div>
      )}

      {clients && clients.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((client) => (
            <Card key={client.id} className="group p-4">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold">{client.name}</h3>
                  {client.short_code && (
                    <div className="font-mono text-xs text-muted-foreground">{client.short_code}</div>
                  )}
                  {client.contact_name && (
                    <div className="mt-1 text-xs text-muted-foreground">{client.contact_name}</div>
                  )}
                  {client.contact_email && (
                    <div className="text-xs text-muted-foreground">{client.contact_email}</div>
                  )}
                  {client.notes && (
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{client.notes}</p>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => { setEditing(client); setDialogOpen(true); }}
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => handleDelete(client.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Client" : "New Client"}</DialogTitle>
          </DialogHeader>
          <ClientForm
            initialValues={editing ?? undefined}
            onSubmit={handleSave}
            onCancel={() => { setDialogOpen(false); setEditing(null); }}
            submitting={createClient.isPending || updateClient.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Inline form ----------

interface ClientFormProps {
  initialValues?: Partial<ClientCreate>;
  onSubmit: (data: ClientCreate) => void;
  onCancel: () => void;
  submitting?: boolean;
}

function ClientForm({ initialValues, onSubmit, onCancel, submitting }: ClientFormProps) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [shortCode, setShortCode] = useState(initialValues?.short_code ?? "");
  const [contactName, setContactName] = useState(initialValues?.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(initialValues?.contact_email ?? "");
  const [notes, setNotes] = useState(initialValues?.notes ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      name,
      short_code: shortCode || undefined,
      contact_name: contactName || undefined,
      contact_email: contactEmail || undefined,
      notes: notes || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="font-mono text-xs">Client Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. ACME Industries" className="mt-1" />
        </div>
        <div>
          <Label className="font-mono text-xs">Short Code</Label>
          <Input value={shortCode} onChange={(e) => setShortCode(e.target.value)} placeholder="e.g. ACME" className="mt-1 font-mono" />
        </div>
        <div>
          <Label className="font-mono text-xs">Contact Name</Label>
          <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="John Smith" className="mt-1" />
        </div>
        <div>
          <Label className="font-mono text-xs">Contact Email</Label>
          <Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="john@acme.com" className="mt-1" type="email" />
        </div>
        <div className="col-span-2">
          <Label className="font-mono text-xs">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this client..." className="mt-1" rows={3} />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={submitting || !name}>
          {submitting ? "..." : initialValues?.name ? "Save Changes" : "Create Client"}
        </Button>
      </div>
    </form>
  );
}
