import { handlers } from "../../../lib/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return handlers.health();
}
