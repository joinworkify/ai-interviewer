import { cn } from "@/lib/utils";

/** Loading placeholders that mirror the admin screens, so the layout does not jump. */

function Bone({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

function Busy({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}

function PageHeading() {
  return (
    <div className="flex flex-col gap-2">
      <Bone className="h-7 w-56" />
      <Bone className="h-4 w-80 max-w-full" />
    </div>
  );
}

/** Body rows of a table; `columns` matches the real table's column count. */
export function TableRowsSkeleton({ rows = 6, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="border-b last:border-0">
          {Array.from({ length: columns }, (_, col) => (
            <td key={col} className="px-4 py-4">
              <Bone className={cn("h-4", col === 0 ? "w-40" : "w-24")} />
              {col === 0 && <Bone className="mt-2 h-3 w-32" />}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function TableCard({ headers, rows }: { headers: string[]; rows: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <TableRowsSkeleton rows={rows} columns={headers.length} />
        </tbody>
      </table>
    </div>
  );
}

/** /admin: heading, four status tiles, filter bar and the interviews table. */
export function InterviewsSkeleton() {
  return (
    <Busy label="Loading interviews">
      <PageHeading />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl border bg-white p-4">
            <Bone className="h-4 w-20" />
            <Bone className="mt-3 h-7 w-10" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Bone className="h-10 flex-1" />
        <Bone className="h-10 w-36" />
        <Bone className="h-10 w-20" />
      </div>
      <TableCard
        headers={["Candidate", "Role", "Interview", "Resume", "AI score", "Status", "Started", ""]}
        rows={8}
      />
    </Busy>
  );
}

/** /admin/roles: heading, search and filter bar, roles table. */
export function RolesSkeleton() {
  return (
    <Busy label="Loading roles">
      <div className="flex items-start justify-between gap-3">
        <PageHeading />
        <Bone className="h-10 w-28" />
      </div>
      <div className="flex gap-2">
        <Bone className="h-10 flex-1" />
        <Bone className="h-10 w-36" />
        <Bone className="h-10 w-24" />
      </div>
      <TableCard headers={["Role", "Pay rate", "Job type", "Status", "Actions"]} rows={6} />
    </Busy>
  );
}
