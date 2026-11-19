import { handleCreateBooking, handleListBookings } from "@/lib/candidate/booking";
import { runBookingRoute } from "@/lib/candidate/booking-route-deps";
import { guardSameOrigin } from "@/lib/http/origin-guard";

/** The signed-in candidate's upcoming bookings. */
export async function GET(request: Request) {
  void request.headers.get("cookie"); // per request, never prerendered
  return runBookingRoute((deps) => handleListBookings(deps));
}

/** Book a time to take the interview. */
export async function POST(request: Request) {
  const blocked = guardSameOrigin(request, process.env);
  if (blocked) return blocked;
  return runBookingRoute((deps) => handleCreateBooking(request, deps));
}
