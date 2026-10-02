import { useParams } from "react-router-dom";

/**
 * Reads a path parameter that the matched route is guaranteed to declare,
 * e.g. `websiteId` on `/websites/:websiteId`.
 *
 * react-router types every param as `string | undefined` because it cannot
 * know which route matched. A page only ever renders under its own route, so a
 * missing param means the route table in `App.tsx` is wrong - that is thrown
 * as a loud programming error instead of being papered over with `!` or `""`.
 * @param paramName - The name of the `:param` in the route pattern
 * @returns The param's value from the current url
 * @throws An Error naming the param when the matched route does not declare it
 */
export function useRequiredRouteParam(paramName: string): string {
  const routeParams = useParams();
  const paramValue = routeParams[paramName];
  if (paramValue === undefined) {
    throw new Error(`The current route does not declare the :${paramName} parameter`);
  }
  return paramValue;
}
