import { useCallback, useState } from "react";
import { useJsonResource } from "./useJsonResource";

/** What `useRecordListWithAdditions` hands back. */
export interface RecordListWithAdditions<TRecord> {
  /** Records added on this visit to the page, then the fetched records; newest first. */
  records: TRecord[];
  /** True until the list for the current url has arrived (false while idle). */
  isLoading: boolean;
  /** Why the list could not be fetched, or null. */
  errorMessage: string | null;
  /** Adds a record the page just created (a POST's response) to the front of `records`. */
  addRecord: (addedRecord: TRecord) => void;
  /** Fetches the list again (records were created elsewhere, e.g. by a background job), keeping the current records shown meanwhile. */
  reload: () => void;
}

/**
 * Fetches a list of records (newest first) and lets the page add the record a
 * POST just created without refetching the whole list - the pattern
 * `useScreenshotRuns` introduced, shared by the action script hooks.
 *
 * Two guards keep the merge honest:
 * - added records are kept only while `recordBelongsToThisList` says they
 *   belong to the list currently shown, because a slow POST can resolve after
 *   the page has moved on to another owner;
 * - a fetched record whose id was also added is dropped, so a record can never
 *   be listed twice.
 *
 * `records` is never null: it is empty while loading, while idle, or after a
 * failed fetch, apart from any records added in the meantime.
 *
 * `reload` is `useJsonResource`'s: it fetches the list again without blanking
 * it, for records that were created on the server without a POST from this
 * page (an auto-refine job's versions and runs). Added records stay in front
 * until the refetched list carries them too, at which point the fetched copy
 * is the one dropped.
 * @param resourceUrl - Relative API url of the list; null to stay idle (nothing to fetch yet)
 * @param recordBelongsToThisList - True when an added record belongs to the list currently shown
 * @returns The merged records, the list request's state, `addRecord`, and `reload`
 */
export function useRecordListWithAdditions<TRecord extends { id: string }>(
  resourceUrl: string | null,
  recordBelongsToThisList: (record: TRecord) => boolean,
): RecordListWithAdditions<TRecord> {
  const listResource = useJsonResource(resourceUrl);
  const [addedRecords, setAddedRecords] = useState<TRecord[]>([]);

  const addRecord = useCallback((addedRecord: TRecord): void => {
    setAddedRecords((previousAddedRecords) => [addedRecord, ...previousAddedRecords]);
  }, []);

  // The API is the contract for this shape; see useJsonResource for why the
  // generic hook returns unknown.
  const fetchedRecords = (listResource.data ?? []) as TRecord[];
  const addedRecordsForThisList = addedRecords.filter(recordBelongsToThisList);
  const addedRecordIds = new Set(addedRecordsForThisList.map((addedRecord) => addedRecord.id));
  const fetchedRecordsNotAlsoAdded = fetchedRecords.filter(
    (fetchedRecord) => !addedRecordIds.has(fetchedRecord.id),
  );

  return {
    records: [...addedRecordsForThisList, ...fetchedRecordsNotAlsoAdded],
    isLoading: listResource.isLoading,
    errorMessage: listResource.errorMessage,
    addRecord,
    reload: listResource.reload,
  };
}
