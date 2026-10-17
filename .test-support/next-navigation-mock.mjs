import React from "react";

export const AppRouterContext = React.createContext(null);

export function useRouter() {
  const router = React.useContext(AppRouterContext);
  if (!router) throw new Error("Next App Router context is missing");
  return router;
}
