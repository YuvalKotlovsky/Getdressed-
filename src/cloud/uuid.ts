import { randomUUID } from 'expo-crypto';
/** Client-generated ids: item ids and photo ids are uuids so a retried save is the same row/object. */
export const newUuid = (): string => randomUUID();
