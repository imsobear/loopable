import { createServerFn } from "@tanstack/react-start";
import { isHosted } from "#/lib/hosted.ts";
import { viewerInScope, type Viewer } from "../accounts.ts";

export type ViewerState = { hosted: boolean; viewer: Viewer | null };

/** Whether this is the hosted service, and who is signed in to it. */
export const getViewer = createServerFn({ method: "GET" }).handler(
  async (): Promise<ViewerState> => ({ hosted: isHosted(), viewer: await viewerInScope() }),
);
