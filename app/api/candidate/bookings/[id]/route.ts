import { handleCancelBooking } from "@/lib/candidate/booking";
import { runBookingRoute } from "@/lib/candidate/booking-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** Cancel one of the signed-in candidate's own bookings. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  const { id } = await params;
  return runBookingRoute((deps) => handleCancelBooking(id, deps));
}
