import { redirect } from "next/navigation";

/**
 * Submitting is a sheet over the job list now, not a page of its own — every
 * number the form needs (slots in use, hourly usage, balance, what is already
 * running) lives on the list behind it, and navigating away from that context
 * made the person hold those figures in their head.
 *
 * The route is kept as a redirect rather than deleted: it is a real URL people
 * have bookmarked, and older code paths still link to it. `?new=1` tells the
 * list to open the sheet on arrival, so the destination is unchanged from the
 * user's point of view.
 */
export default function VideoSubmitRoute() {
  redirect("/app/video/jobs?new=1");
}
