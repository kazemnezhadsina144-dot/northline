import { handlers } from "../../../lib/handlers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handlers.price(request);
}
