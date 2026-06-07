import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  executeDemoInspectExecutorRequest,
  type DemoInspectExecutorRequest,
  validateDemoInspectExecutorRequest,
} from "@/lib/workbench/demo-inspect-executor";

export const runtime = "nodejs";

const readRequest = async (request: NextRequest): Promise<DemoInspectExecutorRequest> => {
  try {
    return (await request.json()) as DemoInspectExecutorRequest;
  } catch {
    return {};
  }
};

const constantTimeEqual = (a: string, b: string) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
};

export async function POST(request: NextRequest) {
  const token = process.env.WORKBENCH_EXECUTOR_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "WORKBENCH_EXECUTOR_TOKEN is not configured" },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || !constantTimeEqual(authorization.slice(7), token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await readRequest(request);
  const parsed = validateDemoInspectExecutorRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    return NextResponse.json(await executeDemoInspectExecutorRequest(parsed.request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Executor request failed";
    console.error("Demo inspect executor error", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
