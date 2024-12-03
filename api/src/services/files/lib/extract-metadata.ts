import type { File } from '@directus/types';
import { SUPPORTED_FILE_METADATA_FORMATS } from '../../../constants.js';
import { getStorage } from '../../../storage/index.js';
import { getMetadata, type Metadata } from '../utils/get-metadata.js';

export async function extractMetadata(
	storageLocation: string,
	data: Partial<File> & Pick<File, 'type' | 'filename_disk'>,
): Promise<Metadata> {
	const storage = await getStorage();
	const fileMeta: Metadata = {};

	if (data.type && SUPPORTED_FILE_METADATA_FORMATS.includes(data.type)) {
		const stream = await storage.location(storageLocation).read(data.filename_disk);

		const { height, width, duration, description, title, tags, metadata, thumbhash } = await getMetadata(
			stream,
			data.type,
		);

		// Note that if this is a replace file upload, the below properties are fetched and included in the data above
		// in the `existingFile` variable... so this will ONLY set the values if they're not already set

		if (!data.height && height) {
			fileMeta.height = height;
		}

		if (!data.width && width) {
			fileMeta.width = width;
		}

		if (!data.duration && duration) {
			fileMeta.duration = duration;
		}

		if (!data.metadata && metadata) {
			fileMeta.metadata = metadata;
		}

		if (!data.description && description) {
			fileMeta.description = description;
		}

		if (!data.title && title) {
			fileMeta.title = title;
		}

		if (!data.tags && tags) {
			fileMeta.tags = tags;
		}

		if (!data.thumbhash && thumbhash) {
			fileMeta.thumbhash = thumbhash;
		}
	}

	return fileMeta;
}
