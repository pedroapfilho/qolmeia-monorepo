import type { ReactNode } from "react";

// Optional slots are usually passed as `cond && <X />`, so `false`, `""` and `0`
// must render nothing rather than an empty wrapper. A nullish check alone would
// let those through.
// oxlint-disable-next-line unicorn/prefer-native-coercion-functions -- a named predicate is the point: inline `Boolean(node)` in a JSX condition trips no-extra-boolean-cast
const isRenderable = (node: ReactNode): boolean => Boolean(node);

export { isRenderable };
export { cn } from "cnfast";
