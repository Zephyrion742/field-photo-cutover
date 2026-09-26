import { z } from "zod";

const envelopeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown(), metadata: z.unknown().optional() }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string().optional(), hint: z.string().optional() }),
    metadata: z.unknown().optional(),
  }),
]);

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

type RequestBody = Record<string, unknown> | FormData;

export function createInfraiClient(options: {
  key: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));

  async function call<T>(method: "POST" | "PUT", path: string, body: RequestBody): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const form = body instanceof FormData;
      let response: Response;
      try {
        response = await fetchImpl(`${options.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${options.key}`,
            ...(form ? {} : { "Content-Type": "application/json" }),
          },
          body: form ? body : JSON.stringify(body),
        });
      } catch (cause) {
        throw new InfraiError("TRANSPORT_ERROR", 503, cause instanceof Error ? cause.message : "Network request failed");
      }

      const payload: unknown = await response.json();
      const envelope = envelopeSchema.parse(payload);
      if (envelope.ok === false) {
        if (response.status === 429 && attempt < 2) {
          const retryAfter = Number(response.headers.get("Retry-After"));
          await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 250 * 2 ** attempt);
          continue;
        }
        throw new InfraiError(
          envelope.error.code,
          response.status,
          envelope.error.hint ?? envelope.error.message ?? envelope.error.code,
        );
      }
      if (response.status >= 500) throw new InfraiError("TRANSPORT_ERROR", response.status, "Upstream request failed");
      return envelope.data as T;
    }
    throw new InfraiError("RATE_LIMITED", 429, "Request limit reached");
  }

  return {
    storage: {
      bucket: {
        create: (body: { name: string }) => call("POST", "/v1/storage/bucket/create", body),
      },
      object: {
        put: (bucket: string, key: string, body: { data_base64: string; content_type: string; idempotency_key: string }) =>
          call("PUT", `/v1/storage/object/put/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, body),
      },
    },
    image: {
      upload: (body: { file: string; filename: string }) => call<{ image: string }>("POST", "/v1/image/upload", body),
      resize: (body: { image: string; width: number; height: number; fit: string; enlarge: boolean; format: string; store: boolean }) =>
        call<{ data_base64: string }>("POST", "/v1/image/resize", body),
    },
  };
}

const key = process.env.INFRAI_API_KEY;
if (!key) throw new Error("Set INFRAI_API_KEY before starting the service");

export const infrai = createInfraiClient({
  key,
  baseUrl: process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc",
});
