"use client";

// Cross-slice: the shared inline error state with retry.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/ui/card";
import { Skeleton } from "@repo/design-system/components/ui/skeleton";
import type { ReactNode } from "react";

export type HomeStatQuery<T> = {
  data?: T;
  isLoading: boolean;
  error: Error | null;
  refetch: () => unknown;
};

export type HomeStatCardProps<T> = {
  title: string;
  query: HomeStatQuery<T>;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  children: (data: T) => ReactNode;
  footer?: ReactNode;
};

/**
 * A Home widget shell. Each widget owns its query, so it owns its loading,
 * error and empty state; one failing widget never hides another.
 */
export function HomeStatCard<T>({
  title,
  query,
  isEmpty,
  emptyText,
  children,
  footer,
}: Readonly<HomeStatCardProps<T>>) {
  return (
    <Card data-testid={`home-widget-${slugify(title)}`}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <HomeStatBody
          emptyText={emptyText}
          isEmpty={isEmpty}
          query={query}
          title={title}
        >
          {children}
        </HomeStatBody>
        {footer}
      </CardContent>
    </Card>
  );
}

function HomeStatBody<T>({
  title,
  query,
  isEmpty,
  emptyText,
  children,
}: Readonly<Omit<HomeStatCardProps<T>, "footer">>) {
  if (query.error) {
    return (
      <QueryErrorMessage
        error={query.error}
        onRetry={() => {
          query.refetch();
        }}
        title={`Couldn't load ${title.toLowerCase()}`}
      />
    );
  }
  if (query.isLoading || query.data === undefined) {
    return (
      <div aria-label={`Loading ${title}`} className="space-y-2" role="status">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (isEmpty?.(query.data)) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }
  return <>{children(query.data)}</>;
}

export type StatValueProps = {
  label: string;
  value: number | null;
  format?: (value: number) => string;
};

/** A labelled number. Unknown (null) and non-finite values render `-`, never 0. */
export function StatValue({ label, value, format }: Readonly<StatValueProps>) {
  return (
    <div className="flex flex-col">
      <span className="font-semibold text-xl tabular-nums">
        {formatStat(value, format)}
      </span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function formatStat(
  value: number | null,
  format: ((value: number) => string) | undefined
): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  return format ? format(value) : value.toLocaleString("en-US");
}

function slugify(title: string): string {
  return title.toLowerCase().replaceAll(/\s+/g, "-");
}
