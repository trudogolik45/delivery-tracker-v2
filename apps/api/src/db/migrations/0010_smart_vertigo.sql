-- Migration 0010: bound cargo.fields (additive, P2 sec — review finding M3)
--
-- cargo.fields is publicly exposed via /share/:hash. Without bounds, an admin
-- can accidentally store SSN/phone/CC numbers there and they leak to share-page
-- visitors. CHECK enforces:
--   * NOT NULL (column constraint already does this; restated for explicit contract)
--   * jsonb is an object (not array/string/number/null)
--   * total serialized size <= 16 KB (~32 keys × ~512 bytes — generous for delivery
--     metadata, blocks accidental dumps and large jsonb-injection payloads)
--
-- Per-key/value bounds enforced at app layer (Zod):
--   record(string().max(64), string().max(2000)), max 32 keys.
--
-- Pre-flight verified on prod (2026-05-09):
--   * cargo: 0 rows with octet_length(fields::text) > 16384
--   * cargo: 0 rows with fields IS NULL OR jsonb_typeof(fields) <> 'object'

ALTER TABLE "cargo" ADD CONSTRAINT "cargo_fields_object_and_bounded" CHECK ("cargo"."fields" IS NOT NULL AND jsonb_typeof("cargo"."fields") = 'object' AND octet_length("cargo"."fields"::text) <= 16384);