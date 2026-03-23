import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/server/db";
import {
  baselineImages,
  baselineVersions,
  events,
  guestStays,
  inspectionEvents,
  inspectionResults,
  inspections,
  items,
  mediaUploads,
  properties,
  propertyConditions,
  rooms,
} from "@/server/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function deletePropertyGraph(
  tx: Tx,
  propertyIds: string[],
): Promise<void> {
  if (propertyIds.length === 0) return;

  let stage = "load room ids";

  try {
    const roomRows = await tx
      .select({ id: rooms.id })
      .from(rooms)
      .where(inArray(rooms.propertyId, propertyIds));
    const roomIds = roomRows.map((row) => row.id);

    stage = "load inspection ids";
    const inspectionRows = await tx
      .select({ id: inspections.id })
      .from(inspections)
      .where(inArray(inspections.propertyId, propertyIds));
    const inspectionIds = inspectionRows.map((row) => row.id);

    stage = "load baseline version ids";
    const baselineVersionRows = await tx
      .select({ id: baselineVersions.id })
      .from(baselineVersions)
      .where(inArray(baselineVersions.propertyId, propertyIds));
    const baselineVersionIds = baselineVersionRows.map((row) => row.id);

    stage = "load baseline image ids";
    const baselineImageRows =
      roomIds.length > 0 || baselineVersionIds.length > 0
        ? await tx
            .select({ id: baselineImages.id })
            .from(baselineImages)
            .where(
              or(
                roomIds.length > 0
                  ? inArray(baselineImages.roomId, roomIds)
                  : undefined,
                baselineVersionIds.length > 0
                  ? inArray(baselineImages.baselineVersionId, baselineVersionIds)
                  : undefined,
              )!,
            )
        : [];
    const baselineImageIds = baselineImageRows.map((row) => row.id);

    stage = "delete timeline events";
    await tx.delete(events).where(
      or(
        inArray(events.propertyId, propertyIds),
        inArray(events.aggregateId, propertyIds),
        inspectionIds.length > 0 ? inArray(events.aggregateId, inspectionIds) : undefined,
        roomIds.length > 0 ? inArray(events.aggregateId, roomIds) : undefined,
      )!,
    );

    if (inspectionIds.length > 0) {
      stage = "delete inspection events";
      await tx
        .delete(inspectionEvents)
        .where(inArray(inspectionEvents.inspectionId, inspectionIds));
    }

    if (inspectionIds.length > 0 || roomIds.length > 0 || baselineImageIds.length > 0) {
      stage = "delete inspection results";
      await tx.delete(inspectionResults).where(
        or(
          inspectionIds.length > 0
            ? inArray(inspectionResults.inspectionId, inspectionIds)
            : undefined,
          roomIds.length > 0 ? inArray(inspectionResults.roomId, roomIds) : undefined,
          baselineImageIds.length > 0
            ? inArray(inspectionResults.baselineImageId, baselineImageIds)
            : undefined,
        )!,
      );
    }

    stage = "delete property conditions";
    await tx
      .delete(propertyConditions)
      .where(inArray(propertyConditions.propertyId, propertyIds));

    stage = "delete guest stays";
    await tx.delete(guestStays).where(inArray(guestStays.propertyId, propertyIds));

    stage = "delete media uploads";
    await tx.delete(mediaUploads).where(inArray(mediaUploads.propertyId, propertyIds));

    stage = "delete inspections";
    await tx.delete(inspections).where(inArray(inspections.propertyId, propertyIds));

    if (roomIds.length > 0) {
      stage = "delete room items";
      await tx.delete(items).where(inArray(items.roomId, roomIds));
    }

    if (baselineImageIds.length > 0) {
      stage = "delete baseline images";
      await tx.delete(baselineImages).where(inArray(baselineImages.id, baselineImageIds));
    }

    stage = "delete baseline versions";
    await tx
      .delete(baselineVersions)
      .where(inArray(baselineVersions.propertyId, propertyIds));

    stage = "delete rooms";
    await tx.delete(rooms).where(inArray(rooms.propertyId, propertyIds));

    stage = "delete properties";
    await tx.delete(properties).where(inArray(properties.id, propertyIds));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown delete failure";
    throw new Error(`[delete property graph] Failed to ${stage}: ${message}`);
  }
}

export async function deleteOwnedPropertyGraph(
  userId: string,
  propertyIds: string[],
): Promise<string[]> {
  if (propertyIds.length === 0) return [];

  const ownedRows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(inArray(properties.id, propertyIds), eq(properties.userId, userId)));

  const ownedIds = ownedRows.map((row) => row.id);
  if (ownedIds.length === 0) return [];

  await db.transaction(async (tx) => {
    await deletePropertyGraph(tx, ownedIds);
  });

  return ownedIds;
}
