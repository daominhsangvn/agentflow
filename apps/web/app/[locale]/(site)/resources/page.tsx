import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { createPageMetadata, localize } from "@/lib/site";

type ResourcesPageProps = {
  params: Promise<{
    locale: string;
  }>;
};

export const generateMetadata = async () =>
  createPageMetadata(
    "Resources",
    "Guides and examples for setting up AgentFlow."
  );

const ResourcesPage = async ({ params }: ResourcesPageProps) => {
  const { locale } = await params;

  const items = [
    {
      href: localize(locale, "/docs/getting-started/quickstart"),
      title: "Quickstart",
      description:
        "One Jira ticket, an orchestrated workflow and your first case.",
    },
    {
      href: localize(locale, "/docs/guides/setup/leavedesk-example"),
      title: "LeaveDesk example",
      description:
        "Every file of a real setup: connections, Agents, workflow and rules.",
    },
    {
      href: localize(locale, "/docs/guides/recipes/orchestrator-rules"),
      title: "Writing orchestrator rules",
      description:
        "How to write the plain-language rules the Orchestrator Agent follows.",
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-12 md:px-10">
      <div className="space-y-3">
        <p className="font-medium text-muted-foreground text-sm uppercase tracking-[0.2em]">
          Resources
        </p>
        <h1 className="font-semibold text-4xl tracking-tight">
          Guides and examples to get started.
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Start with the quickstart, then follow a real setup end to end.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {items.map((item) => (
          <a href={item.href} key={item.title}>
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardHeader>
                <CardTitle className="text-lg">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                {item.description}
              </CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
};

export default ResourcesPage;
