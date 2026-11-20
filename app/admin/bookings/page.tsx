"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import { ADMIN_LINKS } from "@/lib/nav";
import { CardSkeleton } from "@/components/Skeleton";
import StatusBadge from "@/components/StatusBadge";
import { CalendarDays, Filter, Phone, Ban, X, AlertTriangle } from "lucide-react";

interface BookingItem {
  id: string;
  token: string;
  status: string;
  quantityQuintal: number;
  actualQuantity: number | null;
  createdAt: string;
  farmerName: string;
  farmerPhone: string;
  centreName: string;
  cropName: string;
  date: string;
  startTime: string;
  paymentStatus: string | null;
  paymentAmount: number | null;
  queuePosition: number | null;
}

interface CentreOption {
  id: string;
  name: string;
  code: string;
}

const STATUS_OPTIONS = [
  "BOOKED",
  "ARRIVED",
  "VERIFIED",
  "WEIGHING",
  "PROCUREMENT_COMPLETED",
  "PAYMENT_PROCESSING",
  "PAYMENT_COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

export default function AdminBookingsPage() {
  const [bookings, setBookings] = useState<BookingItem[] | null>(null);
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [me, setMe] = useState<any>(null);
  const [lang, setLang] = useState("en");

  const [filterDate, setFilterDate] = useState("");
  const [filterCentre, setFilterCentre] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [cancellingBooking, setCancellingBooking] = useState<BookingItem | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [error, setError] = useState("");

  const inFlightRef = useRef(false);
  const latestReqIdRef = useRef(0);
  const filtersRef = useRef({ filterDate, filterCentre, filterStatus });

  useEffect(() => {
    filtersRef.current = { filterDate, filterCentre, filterStatus };
  }, [filterDate, filterCentre, filterStatus]);

  const fetchBookings = useCallback(async (isInitial = false) => {
    if (inFlightRef.current && !isInitial) return;
    inFlightRef.current = true;
    const reqId = ++latestReqIdRef.current;
    const timestamp = new Date().toISOString();

    try {
      const { filterDate: fd, filterCentre: fc, filterStatus: fs } = filtersRef.current;
      const params = new URLSearchParams();
      if (fd) params.set("date", fd);
      if (fc) params.set("centreId", fc);
      if (fs) params.set("status", fs);
      params.set("_t", String(Date.now()));

      const res = await fetch(`/api/admin/bookings?${params.toString()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      });

      if (reqId < latestReqIdRef.current) return;

      if (res.ok) {
        const data = await res.json();
        const incomingBookings = data.bookings || [];

        console.log(
          `[ADMIN_BOOKINGS_TRACE] time=${timestamp} reqId=${reqId} endpoint=/api/admin/bookings returned=${incomingBookings.length} total=${data.total}`
        );

        setBookings((prevBookings: BookingItem[] | null) => {
          if (incomingBookings.length > 0) return incomingBookings;
          if (prevBookings && prevBookings.length > 0 && !fd && !fc && !fs) {
            console.warn(
              `[ADMIN_BOOKINGS_PRESERVE] reqId=${reqId}: Preserving ${prevBookings.length} existing bookings against empty response`
            );
            return prevBookings;
          }
          return incomingBookings;
        });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const meRes = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
      setMe(meRes.user);
      if (meRes.user?.language) setLang(meRes.user.language);

      const centresRes = await fetch("/api/admin/centres", { cache: "no-store" });
      if (centresRes.ok) {
        const data = await centresRes.json();
        setCentres(data.centres || []);
      }
    } catch {}

    await fetchBookings(true);
  }, [fetchBookings]);

  useEffect(() => {
    load();

    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/realtime/events");
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type && payload.type !== "CONNECTED") {
            fetchBookings(false);
          }
        } catch {}
      };
    } catch {}

    const interval = setInterval(() => {
      fetchBookings(false);
    }, 6000);

    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, [load, fetchBookings]);

  useEffect(() => {
    fetchBookings(false);
  }, [filterDate, filterCentre, filterStatus, fetchBookings]);

  async function handleConfirmCancel() {
    if (!cancellingBooking) return;
    setCancelLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL", bookingId: cancellingBooking.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to cancel booking");
        return;
      }
      setCancellingBooking(null);
      await fetchBookings();
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setCancelLoading(false);
    }
  }

  return (
    <DashboardShell
      role="Admin"
      name={me?.name || ""}
      links={ADMIN_LINKS}
      language={lang}
      onLanguageChange={setLang}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-ink">Booking Management</h1>
          <p className="text-sm text-ink-faint mt-0.5">Filter by date, centre, and status, track progress, or cancel invalid bookings</p>
        </div>
      </div>

      {/* FILTER CONTROLS */}
      <div className="panel p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Filter by Date</label>
            <input
              type="date"
              className="input"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Filter by Centre</label>
            <select
              className="input"
              value={filterCentre}
              onChange={(e) => setFilterCentre(e.target.value)}
            >
              <option value="">All Centres</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Filter by Status</label>
            <select
              className="input"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="">All Statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(filterDate || filterCentre || filterStatus) && (
          <div className="mt-3 pt-3 border-t border-line flex justify-end">
            <button
              onClick={() => {
                setFilterDate("");
                setFilterCentre("");
                setFilterStatus("");
              }}
              className="text-xs text-brand-600 hover:text-brand-700 font-semibold"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {!bookings ? (
        <CardSkeleton />
      ) : (
        <div className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-sunken border-b border-line text-ink-soft font-semibold text-xs uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Token & Q-Pos</th>
                  <th className="py-3 px-4">Farmer Details</th>
                  <th className="py-3 px-4">Centre & Date</th>
                  <th className="py-3 px-4">Crop / Qty</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bookings.map((b) => (
                  <tr key={b.id} className="hover:bg-surface/50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold font-mono text-ink text-base">{b.token}</div>
                      <div className="text-xs text-ink-faint">
                        {b.queuePosition ? `Pos #${b.queuePosition}` : "Queue: —"}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-ink">{b.farmerName}</div>
                      <div className="text-xs font-mono text-ink-faint flex items-center gap-1 mt-0.5">
                        <Phone size={11} /> +91 {b.farmerPhone}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-ink truncate max-w-[140px]">{b.centreName}</div>
                      <div className="text-xs text-ink-faint">{b.date} · {b.startTime}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-medium text-ink">{b.cropName}</div>
                      <div className="text-xs text-ink-faint tnum">
                        {b.actualQuantity ? `${b.actualQuantity} qtl (act)` : `${b.quantityQuintal} qtl`}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="py-3.5 px-4">
                      {b.paymentAmount ? (
                        <div>
                          <div className="font-semibold text-emerald-700 tnum text-xs">
                            ₹{b.paymentAmount.toLocaleString("en-IN")}
                          </div>
                          <div className="text-[10px] text-ink-faint uppercase font-bold">{b.paymentStatus}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {!["PAYMENT_COMPLETED", "CANCELLED"].includes(b.status) && (
                        <button
                          onClick={() => {
                            setError("");
                            setCancellingBooking(b);
                          }}
                          className="btn-secondary !py-1 !px-2 text-xs text-rose-600 hover:text-rose-700 inline-flex items-center gap-1"
                          title="Cancel Booking"
                        >
                          <Ban size={12} /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {bookings.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-ink-faint text-sm">
                      No bookings found for the selected criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CANCEL CONFIRMATION MODAL */}
      {cancellingBooking && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="panel max-w-sm w-full p-6 animate-rise-in">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <AlertTriangle size={24} />
              <h3 className="font-display font-bold text-lg text-ink">Cancel Booking</h3>
            </div>
            <p className="text-sm text-ink-soft mb-4">
              Are you sure you want to cancel booking <strong>{cancellingBooking.token}</strong> for{" "}
              <strong>{cancellingBooking.farmerName}</strong>? The farmer will be notified.
            </p>
            {error && <p className="text-sm text-error bg-error/5 border border-error/20 rounded-lg p-2 mb-3">{error}</p>}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setCancellingBooking(null)}
                className="btn-secondary"
                disabled={cancelLoading}
              >
                No, Keep
              </button>
              <button
                onClick={handleConfirmCancel}
                className="btn-primary !bg-rose-600 hover:!bg-rose-700"
                disabled={cancelLoading}
              >
                {cancelLoading ? "Cancelling..." : "Yes, Cancel Booking"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
