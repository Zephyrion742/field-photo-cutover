import { z } from "zod";

export const photoRequestSchema = z.object({
  workOrderId: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/),
  technicianId: z.string().min(1).max(80),
  filename: z.string().min(1).max(180),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  imageBase64: z.string().min(1).max(14_000_000),
});

export type PhotoRequest = z.infer<typeof photoRequestSchema>;
export type DispatchStatus = "dispatched" | "technician_follow_up";

export type PhotoDependencies = {
  upload(input: { file: string; filename: string }): Promise<{ image: string }>;
  resize(input: {
    image: string;
    width: number;
    height: number;
    fit: string;
    enlarge: boolean;
    format: string;
    store: boolean;
  }): Promise<{ data_base64: string }>;
  put(bucket: string, key: string, input: { data_base64: string; content_type: string; idempotency_key: string }): Promise<unknown>;
};

export async function receiveWorkOrderPhoto(
  request: PhotoRequest,
  bucket: string,
  deps: PhotoDependencies,
): Promise<{ workOrderId: string; photoKey: string; dispatchStatus: DispatchStatus; nextAction: string }> {
  const uploaded = await deps.upload({ file: request.imageBase64, filename: request.filename });
  const resized = await deps.resize({
    image: uploaded.image,
    width: 1600,
    height: 1200,
    fit: "inside",
    enlarge: false,
    format: "webp",
    store: false,
  });
  const photoKey = `work-orders/${request.workOrderId}/${request.technicianId}.webp`;
  await deps.put(bucket, photoKey, {
    data_base64: resized.data_base64,
    content_type: "image/webp",
    idempotency_key: `photo-${request.workOrderId}-${request.technicianId}`,
  });

  return {
    workOrderId: request.workOrderId,
    photoKey,
    dispatchStatus: "technician_follow_up",
    nextAction: "Review the resized site photo with the technician",
  };
}
