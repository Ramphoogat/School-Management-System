import * as React from "react"

import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"

/**
 * On phones each row becomes a card and every cell is labelled with its column heading (see the
 * table rules at the bottom of index.css). The labels are read from the header row and kept up to date
 * as rows change, so pages do not need to do anything.
 */
function useStackLabels(ref: React.RefObject<HTMLTableElement | null>) {
  React.useEffect(() => {
    const table = ref.current
    if (!table) return
    let frame = 0
    const apply = () => {
      const heads = [...table.querySelectorAll("thead th")].map((th) => (th.querySelector(".sr-only") ? "" : th.textContent?.trim() ?? "")) // a hidden-only heading (an actions column) gets no card label
      table.querySelectorAll("tbody tr").forEach((tr) => {
        let i = 0
        for (const td of Array.from(tr.children) as HTMLTableCellElement[]) {
          td.setAttribute("data-label", td.colSpan > 1 ? "" : heads[i] ?? "")
          i += td.colSpan || 1
        }
      })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(apply) }
    apply()
    const mo = new MutationObserver(schedule)
    mo.observe(table, { childList: true, subtree: true, characterData: true })
    return () => { mo.disconnect(); cancelAnimationFrame(frame) }
  }, [ref])
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const ref = React.useRef<HTMLTableElement>(null)
  useStackLabels(ref)
  return (
    <div
      data-slot="table-container"
      tabIndex={0} // a table that scrolls sideways must be scrollable with the keyboard (WCAG 2.1.1)
      className="relative w-full overflow-x-auto rounded-xl border bg-card focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table
        ref={ref}
        data-stack
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted/40 [&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/50 border-t font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, children, ...props }: React.ComponentProps<"th">) {
  const { t } = useT()
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    >
      {children ?? <span className="sr-only">{t("Actions")}</span>}
    </th>
  )
}

function TableCell({ className, children, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-4 py-3 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&_[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    >
      {/* Invisible to the layout on desktop; on phones it keeps a cell's pieces together beside the label. */}
      <div data-slot="cell-content" className="contents max-sm:block max-sm:min-w-0 max-sm:text-right">{children}</div>
    </td>
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
