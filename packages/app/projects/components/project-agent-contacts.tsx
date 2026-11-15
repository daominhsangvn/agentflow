"use client";

import {
  PROJECT_AGENT_CONTACTS_MAX,
  type ProjectAgentContact,
  type ProjectAgentContactInput,
  ProjectAgentContactKind,
  type ProjectRunner,
  projectAgentContactInputSchema,
} from "@repo/api/src/types/project-runners";
// Cross-slice: the active members of the organization for the contact picker.
import { useOrganizationUsers } from "@repo/app/users/hooks/use-users";
import { Button } from "@repo/design-system/components/ui/button";
import { Input } from "@repo/design-system/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { MailIcon, XIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSaveProjectAgentContacts } from "../hooks/use-project-runners";

export type ProjectAgentContactsProps = {
  projectId: string;
  runner: ProjectRunner;
  /** Org admins edit the contacts; members see them (the API enforces it). */
  isAdmin: boolean;
};

/**
 * The people emailed (a notification with a link, no content) when a case of
 * this Agent needs a person.
 */
export function ProjectAgentContacts({
  projectId,
  runner,
  isAdmin,
}: Readonly<ProjectAgentContactsProps>) {
  const [isOpen, setIsOpen] = useState(false);
  const save = useSaveProjectAgentContacts(projectId);
  const contacts = runner.contacts;
  const saveContacts = (
    next: ProjectAgentContactInput[],
    options?: { onSuccess?: () => void }
  ) => save.mutate({ computeTargetId: runner.id, contacts: next }, options);

  return (
    <div className="mt-1 space-y-1">
      <p className="text-muted-foreground text-xs">
        {describeContacts(contacts)}
      </p>
      {isAdmin ? (
        <Button
          aria-expanded={isOpen}
          onClick={() => setIsOpen((value) => !value)}
          size="sm"
          type="button"
          variant="ghost"
        >
          <MailIcon className="size-3.5" />
          Contacts
        </Button>
      ) : null}
      {isAdmin && isOpen ? (
        <ContactsEditor
          contacts={contacts}
          isBusy={save.isPending}
          onSave={saveContacts}
        />
      ) : null}
    </div>
  );
}

type ContactsEditorProps = {
  contacts: ProjectAgentContact[];
  isBusy: boolean;
  onSave: (
    contacts: ProjectAgentContactInput[],
    options?: { onSuccess?: () => void }
  ) => void;
};

function ContactsEditor({
  contacts,
  isBusy,
  onSave,
}: Readonly<ContactsEditorProps>) {
  const members = useOrganizationUsers({ enabled: true });
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isFull = contacts.length >= PROJECT_AGENT_CONTACTS_MAX;
  const existing = contacts.map(toInput);
  const addedIds = new Set(contacts.map((contact) => contact.userId));
  const choices = (members.data ?? []).filter(
    (member) => member.active && !addedIds.has(member.id)
  );

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    const parsed = projectAgentContactInputSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Write an email address");
      return;
    }
    setError(null);
    // Keep the typed email until the save succeeds, so a failure loses nothing.
    onSave([...existing, parsed.data], { onSuccess: () => setEmail("") });
  };

  return (
    <div className="space-y-2 rounded-md border p-2">
      {contacts.length > 0 ? (
        <ul aria-label="Contacts" className="flex flex-wrap gap-1">
          {contacts.map((contact, index) => (
            <li
              className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
              key={contact.id}
            >
              {contactLabel(contact)}
              <button
                aria-label={`Remove ${contactLabel(contact)}`}
                className="disabled:opacity-50"
                disabled={isBusy}
                onClick={() =>
                  onSave(existing.filter((_, other) => other !== index))
                }
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        <Select
          disabled={isBusy || isFull}
          onValueChange={(userId) => onSave([...existing, { userId }])}
          value=""
        >
          <SelectTrigger aria-label="Add a member" className="flex-1">
            <SelectValue placeholder="Add a member" />
          </SelectTrigger>
          <SelectContent>
            {choices.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {memberLabel(member)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <form className="flex items-center gap-2" onSubmit={submitEmail}>
        <Input
          aria-label="External email"
          disabled={isBusy || isFull}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@example.com"
          type="text"
          value={email}
        />
        <Button
          disabled={isBusy || isFull || email.trim() === ""}
          size="sm"
          type="submit"
        >
          Add
        </Button>
      </form>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function toInput(contact: ProjectAgentContact): ProjectAgentContactInput {
  if (contact.kind === ProjectAgentContactKind.Member && contact.userId) {
    return { userId: contact.userId };
  }
  return { email: contact.email };
}

function contactLabel(contact: ProjectAgentContact): string {
  return contact.name?.trim() || contact.email;
}

function memberLabel(member: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const name = [member.firstName, member.lastName].filter(Boolean).join(" ");
  return name || member.email;
}

function describeContacts(contacts: ProjectAgentContact[]): string {
  if (contacts.length === 0) {
    return "No contacts: nobody is emailed when a case needs a person.";
  }
  return `Notified when a case needs a person: ${contacts.map(contactLabel).join(", ")}`;
}
