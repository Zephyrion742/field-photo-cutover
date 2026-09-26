import express from "express";
import { ZodError } from "zod";
import { infrai, InfraiError } from "./infrai.js";
import { photoRequestSchema, receiveWorkOrderPhoto } from "./work_order_photo.js";

const bucket = process.env.FIELD_PHOTO_BUCKET ?? "field-service-photos";
const app = express();
app.use(express.json({ limit: "14mb" }));

const bucketReady = infrai.storage.bucket.create({ name: bucket });

app.post("/work-orders/:workOrderId/photos", async (request, response) => {
  try {
    await bucketReady;
    const input = photoRequestSchema.parse({ ...request.body, workOrderId: request.params.workOrderId });
    const result = await receiveWorkOrderPhoto(input, bucket, {
      upload: (body) => infrai.image.upload(body),
      resize: (body) => infrai.image.resize(body),
      put: (targetBucket, key, body) => infrai.storage.object.put(targetBucket, key, body),
    });
    response.status(201).json(result);
  } catch (error) {
    if (error instanceof ZodError) {
      response.status(400).json({ error: "INVALID_REQUEST", issues: error.issues });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.status(status).json({ error: error.code, message: error.message });
      return;
    }
    response.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Field photo service listening on http://localhost:${port}`));
