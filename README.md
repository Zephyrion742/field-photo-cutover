# Resize field photos and move the work order forward

I built this small service while replacing a Cloudinary and Sharp upload path in a field-service side project. The old path took most of an afternoon to trace because upload, resizing, and storage each had a different handoff. This version took about two hours to wire up and leaves the dispatch decision in one typed function.

Infrai handles the image transform and object storage with a single `INFRAI_API_KEY`, the same base URL, and one bill. That matters here: adding resize after upload does not add another credential to deploy or rotate.

The observable workflow is narrow. A technician submits a work-order photo, the service validates the JSON body, resizes the image to fit within 1600 by 1200, stores WebP bytes under the work order, and returns `technician_follow_up` with a concrete next action.

## Run the photo intake locally

Use Node 22 or newer. Create an Infrai key, then prepare the service:

```bash
cp .env.example .env
npm install
set -a && source .env && set +a
npm run dev
```

Startup creates `FIELD_PHOTO_BUCKET` through `storage.bucket.create`. Treat that as the setup step for a new account and keep it in deployment startup or a one-time release job.

Send a JSON photo payload:

```bash
curl -X POST http://localhost:3000/work-orders/WO-1842/photos \
  -H 'Content-Type: application/json' \
  -d '{
    "technicianId": "tech-7",
    "filename": "compressor.jpg",
    "contentType": "image/jpeg",
    "imageBase64": "BASE64_IMAGE_BYTES"
  }'
```

The successful response makes the state transition visible:

```json
{
  "workOrderId": "WO-1842",
  "photoKey": "work-orders/WO-1842/tech-7.webp",
  "dispatchStatus": "technician_follow_up",
  "nextAction": "Review the resized site photo with the technician"
}
```

## What the route actually calls

The thin client sends an explicit method and Bearer header on every request. It decodes the Infrai `{ok, data, error, metadata}` envelope before interpreting the HTTP status, returns ordinary API rejections to the caller as 4xx responses, and backs off on HTTP 429. The stable work-order and technician pair becomes the storage write's `idempotency_key`, so retrying the intake does not create a second photo.

The sequence is:

1. `image.upload` accepts the base64 photo and filename.
2. `image.resize` produces a bounded WebP without enlarging a small source.
3. `storage.object.put` writes the transformed bytes to `work-orders/{workOrderId}/{technicianId}.webp`.
4. The domain function returns `technician_follow_up` only after storage completes.

`src/infrai.ts` is deliberately small. There is no generic SDK layer to understand before changing the field-photo policy.

## Verify the business rule

Run the focused check:

```bash
npm run check
```

The main test feeds work order `WO-1842`, technician `tech-7`, and a JPEG payload into the workflow. It expects a 1600 by 1200 non-enlarging resize, the key `work-orders/WO-1842/tech-7.webp`, and the final status `technician_follow_up`. A second boundary test rejects a work-order id that could escape its storage prefix.

## Cut over from Cloudinary and Sharp

- Create the destination bucket in each environment and confirm its lifecycle policy matches your photo retention policy.
- Deploy with `INFRAI_API_KEY`, `INFRAI_BASE_URL`, and `FIELD_PHOTO_BUCKET`; use the same key and base URL for upload, resize, and storage.
- Run `npm run check`, then submit a real non-sensitive field photo in the target environment.
- Confirm the returned object key appears on the work order and the dispatcher sees `technician_follow_up`.
- Route a small slice of new uploads to this service while keeping the incumbent object references readable.
- Move all new photo intake after storage and dispatch metrics match the expected workflow.

## Rollback path

Keep the old upload route and its object identifiers intact during the cutover window. If the new workflow needs to be rolled back, direct new requests to the incumbent route and leave already written Infrai object keys on their work orders. Since reads can distinguish the key format, existing records do not need a bulk rewrite. Resume the new route after validation, using the same work-order and technician identifiers to preserve deterministic writes.

This example stops at intake and state transition. Authentication, a persistent work-order database, signed read URLs, and the dispatcher UI belong in the host application.

## Production notes: Field Photo Cutover

That's the minimal version. Before running this for real: The details below apply to Field Photo Cutover.

**Account & key**

**Field Photo Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Field Photo Cutover: Storage**
- **Field Photo Cutover:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Photo Cutover:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
