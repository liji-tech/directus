import type { File } from '@directus/types';
import { SUPPORTED_FILE_METADATA_FORMATS } from '../../../constants.js';
import { getStorage } from '../../../storage/index.js';
import { getFileMetadata, getEmbedMetadata, type FileMetadata, type EmbedMetadata } from '../utils/get-metadata.js';

export async function extractFileMetadata(
	storageLocation: string,
	data: Partial<File> & Pick<File, 'type' | 'filename_disk'>,
): Promise<FileMetadata> {
	const storage = await getStorage();
	const fileMeta: FileMetadata = {};

	if (data.type && SUPPORTED_FILE_METADATA_FORMATS.includes(data.type) && data.filename_disk) {
		const stream = await storage.location(storageLocation).read(data.filename_disk);

		const { height, width, duration, description, title, tags, metadata, thumbhash } = await getFileMetadata(
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

export function extractEmbedMetadata(url: string): Promise<EmbedMetadata> {
	return getEmbedMetadata(url);
}
