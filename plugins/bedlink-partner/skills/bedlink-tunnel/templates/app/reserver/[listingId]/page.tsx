import "@/styles/tunnel.css";
import { BookingTunnel } from "@/components/tunnel/BookingTunnel";
import { addDays, addMonths, lastOfMonth } from "@/components/tunnel/format";
import { todayIn } from "@/lib/bedlink/dates";
import { getListing } from "@/lib/tunnel/config";
import { tunnelStore } from "@/lib/tunnel/store";
import { bookingStatus, loadCalendar, loadExtras, loadSlots, quoteNights, quoteSlot, release, startPayment } from "../actions";

// Example booking page: /reserver/<listingId>. Rename the route to your slugs,
// put your gallery and texts in `header`, keep the tunnel underneath.
// Server component: it reads your listing and the BedLink copy, then hands the
// server actions to the tunnel (they run on the server, the key never leaves it).

export const dynamic = "force-dynamic"; // availability changes all the time

export default async function ReserverPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = await params;
  const [content, property] = await Promise.all([getListing(listingId), tunnelStore.propertyForListing(listingId)]);
  if (!content || !property) {
    return <p style={{ padding: 24 }}>Ce logement n’est pas encore réservable en ligne.</p>;
  }

  const today = todayIn(property.timezone);
  const lastShown = lastOfMonth(addMonths(today.slice(0, 8) + "01", 1));
  const [days, day, extras] = await Promise.all([
    loadCalendar(property.propertyId, today, addDays(lastShown, 1)),
    loadSlots(property.propertyId, today, lastShown),
    // The host's extras, priced by BedLink and paid online with the stay.
    loadExtras(property.propertyId),
  ]);

  return (
    <BookingTunnel
      listing={{
        listingId,
        propertyId: property.propertyId,
        name: content.name,
        subtitle: content.subtitle,
        hostFirstName: content.hostFirstName,
        photoUrl: content.photoUrl,
        maxGuests: property.maxGuests ?? 2,
        currency: property.currency,
        checkInFrom: property.checkInFrom,
        checkOutUntil: property.checkOutUntil,
        cancellationSummary: property.cancellationPolicy?.summary?.fr ?? null,
        termsUrl: content.termsUrl,
      }}
      today={today}
      initialDays={days.ok ? days.data : []}
      formules={day.ok ? day.data.formules : []}
      initialSlots={day.ok ? day.data.slots : []}
      extras={extras}
      actions={{ loadCalendar, quoteNights, loadSlots, quoteSlot, startPayment, bookingStatus, release }}
      header={
        <header className="bt-sec">
          <p className="bt-kicker">{content.subtitle}</p>
          <h1 className="bt-h1">{content.name}</h1>
        </header>
      }
    />
  );
}
