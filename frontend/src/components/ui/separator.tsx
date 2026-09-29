import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "cn"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 select-none pointer-events-none",
        orientation === "horizontal"
          ? "h-0 w-full border-t border-border"
          : "w-0 self-center border-l border-border",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
