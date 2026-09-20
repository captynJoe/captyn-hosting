import { NextRequest, NextResponse } from "next/server";
import { HostingServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const VALID_STATUSES = new Set(Object.values(HostingServiceStatus));

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const service = await prisma.hostingService.findUnique({
      where: { id },
      include: {
        invoices: { orderBy: { periodStartsAt: "desc" } },
      },
    });
    if (!service) {
      return NextResponse.json({ error: "Hosting service not found" }, { status: 404 });
    }

    return NextResponse.json({ service });
  } catch (error) {
    console.error("Failed to load hosting service:", error);
    return NextResponse.json({ error: "Failed to load hosting service" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (typeof body?.planName === "string" && body.planName.trim()) {
      data.planName = body.planName.trim();
    }
    if (body?.monthlyPriceKes !== undefined) {
      const price = Number(body.monthlyPriceKes);
      if (!Number.isFinite(price) || price <= 0) {
        return NextResponse.json({ error: "monthlyPriceKes must be a positive number" }, { status: 400 });
      }
      data.monthlyPriceKes = price;
    }
    if (body?.billingDayOfMonth !== undefined) {
      data.billingDayOfMonth = Math.min(28, Math.max(1, Math.round(Number(body.billingDayOfMonth) || 1)));
    }
    if (body?.graceDays !== undefined) {
      data.graceDays = Math.max(0, Math.round(Number(body.graceDays) || 0));
    }
    if (body?.invoiceLeadDays !== undefined) {
      data.invoiceLeadDays = Math.max(0, Math.round(Number(body.invoiceLeadDays) || 0));
    }
    if (typeof body?.notes === "string") {
      data.notes = body.notes.trim() || null;
    }
    if (typeof body?.status === "string") {
      if (!VALID_STATUSES.has(body.status as HostingServiceStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      data.status = body.status;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const service = await prisma.hostingService.update({ where: { id }, data });
    return NextResponse.json({ success: true, service });
  } catch (error) {
    console.error("Failed to update hosting service:", error);
    return NextResponse.json({ error: "Failed to update hosting service" }, { status: 500 });
  }
}
