import { describe, expect, it, vi } from "vitest";
import { photoRequestSchema, receiveWorkOrderPhoto } from "../src/work_order_photo.js";

describe("work-order photo intake", () => {
  it("moves a dispatched visit to technician follow-up after the resized photo is stored", async () => {
    const upload = vi.fn().mockResolvedValue({ image: "uploaded-image-ref" });
    const resize = vi.fn().mockResolvedValue({ data_base64: "resized-webp" });
    const put = vi.fn().mockResolvedValue({ key: "stored" });
    const input = photoRequestSchema.parse({
      workOrderId: "WO-1842",
      technicianId: "tech-7",
      filename: "compressor.jpg",
      contentType: "image/jpeg",
      imageBase64: "original-photo",
    });

    const result = await receiveWorkOrderPhoto(input, "field-service-photos", { upload, resize, put });

    expect(result).toEqual({
      workOrderId: "WO-1842",
      photoKey: "work-orders/WO-1842/tech-7.webp",
      dispatchStatus: "technician_follow_up",
      nextAction: "Review the resized site photo with the technician",
    });
    expect(resize).toHaveBeenCalledWith(expect.objectContaining({ width: 1600, height: 1200, enlarge: false }));
    expect(put).toHaveBeenCalledWith(
      "field-service-photos",
      "work-orders/WO-1842/tech-7.webp",
      expect.objectContaining({ idempotency_key: "photo-WO-1842-tech-7" }),
    );
  });

  it("rejects a malformed work-order id at the request boundary", () => {
    const parsed = photoRequestSchema.safeParse({
      workOrderId: "../../other-order",
      technicianId: "tech-7",
      filename: "site.jpg",
      contentType: "image/jpeg",
      imageBase64: "photo",
    });
    expect(parsed.success).toBe(false);
  });
});
