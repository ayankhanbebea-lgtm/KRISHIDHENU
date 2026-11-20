"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import DashboardShell from "@/components/DashboardShell";
import MetricCard, { MetricRow } from "@/components/MetricCard";
import LoadIndicator from "@/components/LoadIndicator";
import { CardSkeleton } from "@/components/Skeleton";
import { Lightbulb, ScrollText } from "lucide-react";
import { getAdminLinks } from "@/lib/nav";
import { useLanguage } from "@/lib/i18n/context";

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export default function AdminDashboard() {
  const { t } = useLanguage();
  const [data, setData] = useState<any>(undefined);
  const [me, setMe] = useState<any>(null);

  const inFlightRef = useRef(false);
  const latestReqIdRef = useRef(0);

  const load = useCallback(async (isInitial = false) => {
    if (inFlightRef.current && !isInitial) return;
    inFlightRef.current = true;
    const reqId = ++latestReqIdRef.current;
    const timestamp = new Date().toISOString();

    try {
      if (isInitial) {
        try {
          const meRes = await fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json());
          setMe(meRes.user);
        } catch {}
      }

      const res = await fetch(`/api/admin/overview?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      }).then((r) => r.json());

      if (reqId < latestReqIdRef.current) return;

      console.log(
        `[ADMIN_OVERVIEW_TRACE] time=${timestamp} reqId=${reqId} totalFarmers=${res?.overview?.totalFarmers} todaysBookings=${res?.overview?.todaysBookings}`
      );

      setData((prevData: any) => {
        if (!prevData) return res;
        const prevOverview = prevData.overview;
        const newOverview = res.overview;

        return {
          ...res,
          overview: {
            ...newOverview,
            todaysBookings: Math.max(newOverview?.todaysBookings || 0, prevOverview?.todaysBookings || 0),
            activeQueues: Math.max(newOverview?.activeQueues || 0, prevOverview?.activeQueues || 0),
            completedProcurements: Math.max(newOverview?.completedProcurements || 0, prevOverview?.completedProcurements || 0),
            totalFarmers: Math.max(newOverview?.totalFarmers || 0, prevOverview?.totalFarmers || 0),
            paymentStats: {
              ...newOverview?.paymentStats,
              pendingCount: Math.max(newOverview?.paymentStats?.pendingCount || 0, prevOverview?.paymentStats?.pendingCount || 0),
              pendingAmount: Math.max(newOverview?.paymentStats?.pendingAmount || 0, prevOverview?.paymentStats?.pendingAmount || 0),
              paidAmount: Math.max(newOverview?.paymentStats?.paidAmount || 0, prevOverview?.paymentStats?.paidAmount || 0),
            },
          },
        };
      });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    load(true);

    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/realtime/events");
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type && payload.type !== "CONNECTED") {
            load(false);
          }
        } catch {}
      };
    } catch {}

    const interval = setInterval(() => {
      load(false);
    }, 10000);

    return () => {
      clearInterval(interval);
      if (es) es.close();
    };
  }, [load]);

  const links = getAdminLinks(t);

  if (!data) {
    return (
      <DashboardShell role="Admin" name="" links={links}>
        <CardSkeleton />
      </DashboardShell>
    );
  }

  const { overview, recentAudit, paymentBreakdown } = data;

  const insights: string[] = [];
  const busiest = [...overview.centreStatus].sort((a: any, b: any) => b.waiting - a.waiting)[0];
  if (busiest && busiest.waiting > 0) {
    insights.push(`${busiest.name} currently has the most farmers waiting (${busiest.waiting}).`);
  }
  const quietest = [...overview.centreStatus].sort((a: any, b: any) => a.waiting - b.waiting)[0];
  if (quietest) {
    insights.push(`${quietest.name} has the lowest wait count (${quietest.waiting}).`);
  }
  if (overview.paymentStats?.pendingCount > 0) {
    insights.push(`₹${Number(overview.paymentStats.pendingAmount || 0).toLocaleString("en-IN")} pending disbursement across ${overview.paymentStats.pendingCount} bookings.`);
  }

  return (
    <DashboardShell role="Admin" name={me?.name || "Admin"} links={links}>
      <div className="space-y-6">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">
            {t("welcome")}, {me?.name || "Admin"}
          </h1>
          <p className="text-sm text-ink-faint mt-0.5">{t("adminDashboard")}</p>
        </div>

        {/* METRICS ROW */}
        <MetricRow>
          <MetricCard label={t("totalFarmers")} value={overview.totalFarmers} tone="default" />
          <MetricCard label={t("totalCentres")} value={overview.totalCentres} tone="default" />
          <MetricCard label={t("todaysBookingsCount")} value={overview.todaysBookings} tone="good" />
          <MetricCard label={t("activeQueues")} value={overview.activeQueues} tone="warn" />
          <MetricCard label={t("completedProcurements")} value={overview.completedProcurements} tone="good" />
          <MetricCard label={t("pendingPayments")} value={overview.pendingPayments} tone="warn" />
        </MetricRow>

        {/* 2-COL: CENTRES STATUS + INSIGHTS */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* CENTRE STATUS */}
          <div className="lg:col-span-2 panel p-5">
            <h2 className="font-bold text-base text-ink mb-4">{t("centreStatus")}</h2>
            <div className="space-y-3">
              {overview.centreStatus.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-sunken">
                  <div>
                    <p className="font-semibold text-sm text-ink">{c.name}</p>
                    <p className="text-xs text-ink-faint">
                      {c.district} · {c.staffCount} staff
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <p className="text-xs text-ink-faint">{t("waiting")}</p>
                      <p className="font-bold text-sm text-ink tnum">{c.waiting}</p>
                    </div>
                    <div>
                      <p className="text-xs text-ink-faint">{t("todayCompleted")}</p>
                      <p className="font-bold text-sm text-brand-600 tnum">{c.completedToday}</p>
                    </div>
                    <LoadIndicator load={c.load} waiting={c.waiting} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* INSIGHTS */}
          <div className="panel p-5 bg-gradient-to-br from-brand-50/50 to-surface">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb size={18} className="text-brand-600" />
              <h2 className="font-bold text-base text-ink">{t("smartInsights")}</h2>
            </div>
            <div className="space-y-2.5">
              {insights.map((ins, i) => (
                <div key={i} className="p-3 rounded-lg bg-white/80 border border-line text-xs text-ink-soft">
                  {ins}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AUDIT LOG PREVIEW */}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ScrollText size={18} className="text-brand-600" />
              <h2 className="font-bold text-base text-ink">{t("recentActivity")}</h2>
            </div>
          </div>
          <div className="divide-y divide-line">
            {recentAudit.map((a: any) => (
              <div key={a.id} className="py-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="font-semibold text-ink">{a.userName || "System"}</span>{" "}
                  <span className="text-ink-faint">performed</span>{" "}
                  <span className="font-mono bg-surface-sunken px-1.5 py-0.5 rounded text-ink">{a.action}</span>{" "}
                  <span className="text-ink-faint">on {a.entity}</span>
                </div>
                <span className="text-ink-faint tnum shrink-0 ml-2">{timeAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
