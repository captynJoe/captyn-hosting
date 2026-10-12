import { NextRequest, NextResponse } from "next/server";
import { HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasValidInternalKey } from "@/lib/internalKey";
import { generateDueInvoices, startOfUtcDay, syncService } from "@/lib/hostingBilling";
import { DAY_MS } from "@/lib/ledger";
import { sendBalanceNotice } from "@/lib/notices";

const OVERDUE_REMINDER_EVERY_DAYS = 3;
const HOUR_MS = 60 * 60 * 1000;
const PAUSED_REMINDER_EVERY_DAYS = 7;

type RunStats = {
  servicesChecked: number;
  invoicesCreated: number;
  billsSent: number;
  overdueNoticesSent: number;
  sitesPaused: number;
  sitesRestored: number;
};

/**
 * Daily: bill what's due, move statuses with the ledger, warn overdue
 * accounts every few days (the first warning sets the pause date), and
 * pause sites whose pause date has passed. Back-filled months don't each send an email; the
 * account gets one notice for its whole balance.
 */
export async function POST(request: NextRequest) {
  if (!hasValidInternalKey(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const stats: RunStats = {
    servicesChecked: 0,
    invoicesCreated: 0,
    billsSent: 0,
    overdueNoticesSent: 0,
    sitesPaused: 0,
    sitesRestored: 0,
  };

  try {
    const now = new Date();
    const today = startOfUtcDay(now);

    const services = await prisma.hostingService.findMany({
      where: { status: { not: HostingServiceStatus.cancelled } },
    });
    stats.servicesChecked = services.length;

    for (const service of services) {
      try {
        const created = await generateDueInvoices(service, now);
        stats.invoicesCreated += created.length;

        const synced = await syncService(service.id, now, { canPause: true });
        if (!synced) continue;
        const { service: current, ledger, previousStatus } = synced;

        if (previousStatus === HostingServiceStatus.suspended && current.status !== HostingServiceStatus.suspended) {
          stats.sitesRestored += 1;
        }

        if (current.manualPause) {
          // Paused by an admin: no automatic paused/overdue emails.
        } else if (current.status === HostingServiceStatus.suspended) {
          if (previousStatus !== HostingServiceStatus.suspended) stats.sitesPaused += 1;
          const sinceReminderMs = current.reminderSentAt ? now.getTime() - current.reminderSentAt.getTime() : Infinity;
          const notify =
            previousStatus !== HostingServiceStatus.suspended || sinceReminderMs >= PAUSED_REMINDER_EVERY_DAYS * DAY_MS;
          if (notify && (await sendBalanceNotice(current, ledger, now))) stats.overdueNoticesSent += 1;
        } else if (current.status === HostingServiceStatus.overdue) {
          // The pause date is set with the first overdue notice, so the
          // customer always hears about it graceDays before the site pauses.
          const noticed = current.suspendAfter
            ? current
            : {
                ...current,
                // On the hour, so the run graceDays later (same cron time) is
                // never a few milliseconds early and the pause doesn't slip a day.
                suspendAfter: new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + Math.max(1, current.graceDays) * DAY_MS),
              };
          const sinceReminderMs = current.reminderSentAt ? now.getTime() - current.reminderSentAt.getTime() : Infinity;
          const notify = !current.suspendAfter || sinceReminderMs >= OVERDUE_REMINDER_EVERY_DAYS * DAY_MS;
          if (notify && (await sendBalanceNotice(noticed, ledger, now))) {
            stats.overdueNoticesSent += 1;
            if (!current.suspendAfter) {
              await prisma.hostingService.update({
                where: { id: current.id },
                data: { suspendAfter: noticed.suspendAfter },
              });
            }
          }
        } else if (created.some((invoice) => invoice.dueDate.getTime() >= today.getTime())) {
          // A new bill that isn't already past due when it is created.
          if (await sendBalanceNotice(current, ledger, now)) stats.billsSent += 1;
        }
      } catch (error) {
        console.error("Hosting billing failed for service:", { serviceId: service.id, domain: service.domain, error });
      }
    }

    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error("Failed to run hosting billing cycle:", error);
    return NextResponse.json({ error: "Failed to run hosting billing cycle", stats }, { status: 500 });
  }
}
