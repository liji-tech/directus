import { useEnv } from '@directus/env';
import type { File } from '@directus/types';
import exif, { type GPSInfoTags, type ImageTags, type IopTags, type PhotoTags } from 'exif-reader';
import { type IccProfile, parse as parseIcc } from 'icc';
import { pick } from 'lodash-es';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { useLogger } from '../../../logger/index.js';
import { getSharpInstance } from '../lib/get-sharp-instance.js';
import { parseIptc, parseXmp } from './parse-image-metadata.js';
import ffmpeg, { type FfprobeStream } from 'fluent-ffmpeg';
import { rgbaToThumbHash } from 'thumbhash';
import extractPageMeta from 'open-graph-scraper';
import { extract as extractOEmbed } from '@extractus/oembed-extractor';
import { decodeHTML } from 'entities';
import { parseFavicon } from 'parse-favicon';

const env = useEnv();
const logger = useLogger();

export type FileMetadata = Partial<
	Pick<File, 'height' | 'width' | 'duration' | 'description' | 'title' | 'tags' | 'metadata' | 'thumbhash'>
>;

export async function getFileMetadata(
	stream: Readable,
	type: string,
	allowList: string | string[] = env['FILE_METADATA_ALLOW_LIST'] as string[],
): Promise<FileMetadata> {
	if (type.startsWith('image/')) return getImageMetadata(stream, allowList);
	else return getMediaMetadata(stream, allowList);
}

async function getImageMetadata(stream: Readable, allowList: string | string[]): Promise<FileMetadata> {
	const transformer = getSharpInstance();

	return new Promise((resolve) => {
		pipeline(
			stream,
			transformer.metadata(async (err, sharpMetadata) => {
				if (err) {
					logger.error(err);
					return resolve({});
				}

				const metadata: FileMetadata = {};

				if (sharpMetadata.orientation && sharpMetadata.orientation >= 5) {
					metadata.height = sharpMetadata.width ?? null;
					metadata.width = sharpMetadata.height ?? null;
				} else {
					metadata.width = sharpMetadata.width ?? null;
					metadata.height = sharpMetadata.height ?? null;
				}

				// Backward-compatible layout as it used to be with 'exifr'
				const fullMetadata: {
					ifd0?: Partial<ImageTags>;
					ifd1?: Partial<ImageTags>;
					exif?: Partial<PhotoTags>;
					gps?: Partial<GPSInfoTags>;
					interop?: Partial<IopTags>;
					icc?: IccProfile;
					iptc?: Record<string, unknown>;
					xmp?: Record<string, unknown>;
				} = {};

				if (sharpMetadata.exif) {
					try {
						const { Image, ThumbnailTags, Iop, GPSInfo, Photo } = (exif as unknown as typeof exif.default)(
							sharpMetadata.exif,
						);

						if (Image) {
							fullMetadata.ifd0 = Image;
						}

						if (ThumbnailTags) {
							fullMetadata.ifd1 = ThumbnailTags;
						}

						if (Iop) {
							fullMetadata.interop = Iop;
						}

						if (GPSInfo) {
							fullMetadata.gps = GPSInfo;
						}

						if (Photo) {
							fullMetadata.exif = Photo;
						}
					} catch (err) {
						logger.warn(`Couldn't extract Exif metadata from file`);
						logger.warn(err);
					}
				}

				if (sharpMetadata.icc) {
					try {
						fullMetadata.icc = parseIcc(sharpMetadata.icc);
					} catch (err) {
						logger.warn(`Couldn't extract ICC profile data from file`);
						logger.warn(err);
					}
				}

				if (sharpMetadata.iptc) {
					try {
						fullMetadata.iptc = parseIptc(sharpMetadata.iptc);
					} catch (err) {
						logger.warn(`Couldn't extract IPTC Photo Metadata from file`);
						logger.warn(err);
					}
				}

				if (sharpMetadata.xmp) {
					try {
						fullMetadata.xmp = parseXmp(sharpMetadata.xmp);
					} catch (err) {
						logger.warn(`Couldn't extract XMP data from file`);
						logger.warn(err);
					}
				}

				if (fullMetadata?.iptc?.['Caption'] && typeof fullMetadata.iptc['Caption'] === 'string') {
					metadata.description = fullMetadata.iptc?.['Caption'];
				}

				if (fullMetadata?.iptc?.['Headline'] && typeof fullMetadata.iptc['Headline'] === 'string') {
					metadata.title = fullMetadata.iptc['Headline'];
				}

				if (fullMetadata?.iptc?.['Keywords']) {
					metadata.tags = fullMetadata.iptc['Keywords'] as string;
				}

				if (allowList === '*' || allowList?.[0] === '*') {
					metadata.metadata = fullMetadata;
				} else {
					metadata.metadata = pick(fullMetadata, allowList);
				}

				// Fix (incorrectly parsed?) values starting / ending with spaces,
				// limited to one level and string values only
				for (const section of Object.keys(metadata.metadata)) {
					for (const [key, value] of Object.entries(metadata.metadata[section])) {
						if (typeof value === 'string') {
							metadata.metadata[section][key] = value.trim();
						}
					}
				}

				try {
					const { info, data } = await transformer
						.resize(100, 100, {
							fit: 'inside',
							withoutEnlargement: true,
						})
						.raw()
						.toBuffer({ resolveWithObject: true });

					const rawHash = rgbaToThumbHash(info.width, info.height, data);
					const hashedBuffer = Buffer.from(rawHash);
					const thumbhash = hashedBuffer.toString('binary');
					metadata.thumbhash = thumbhash;
				} catch (error) {
					logger.error('Failed to generate thumbhash', error);
				} finally {
					resolve(metadata);
				}
			}),
		);
	});
}

/**
 * Lowercase properties on an object.
 */
function lowercaseProps<T extends Record<string, any>>(obj?: T): T {
	const result: Record<string, any> = {};

	if (obj) {
		for (const [prop, value] of Object.entries(obj)) {
			result[prop.toLowerCase()] = value;
		}
	}

	return result as T;
}

async function getMediaMetadata(stream: Readable, allowList: string | string[]): Promise<FileMetadata> {
	return new Promise((resolve) => {
		ffmpeg.ffprobe(
			// @ts-expect-error 2345
			stream,
			(err, probeData) => {
				if (err) {
					logger.error(err);
					return resolve({});
				}

				const metadata: FileMetadata = {};

				const { duration, tags } = probeData.format;
				if (duration) metadata.duration = Math.round(duration * 1000);

				const formatTags = lowercaseProps(tags);
				if (formatTags['title']) metadata.title = `${formatTags['title']}`;

				if (formatTags['comment']) {
					metadata.description = `${formatTags['comment']}`;
				} else if (formatTags['comments']) {
					metadata.description = `${formatTags['comments']}`;
				}

				let stream: FfprobeStream | null = null;

				for (const item of probeData.streams) {
					if (item.codec_type !== 'video') continue; // Only use the first video stream

					if (typeof item.width === 'number' && typeof item.height === 'number') {
						metadata.width = item.width;
						metadata.height = item.height;
						stream = item;
						break;
					}
				}

				const _metadata = { ...probeData, stream };

				if (allowList === '*' || allowList?.[0] === '*') {
					metadata.metadata = _metadata;
				} else {
					metadata.metadata = pick(_metadata, allowList);
				}

				resolve(metadata);
			},
		);
	});
}

export type EmbedMetadata = Partial<
	Pick<File, 'embed' | 'height' | 'width' | 'duration' | 'description' | 'title' | 'metadata' | 'type'>
>;

export async function getEmbedMetadata(url: string): Promise<EmbedMetadata> {
	const embedMeta: EmbedMetadata = { embed: url };
	const fetchOptions = { headers: { 'user-agent': 'facebookexternalhit' } };

	const [oEmbed, pageMeta] = await Promise.all([
		extractOEmbed(url, {}, fetchOptions).catch((err) => {
			logger.warn(`Couldn't extract oEmbed data from ${url}`);
			logger.warn(err);
			return {};
		}),
		extractPageMeta({
			url,
			fetchOptions,
			customMetaTags: [
				{
					multiple: false,
					property: 'hostname',
					fieldName: 'hostnameMetaTag',
				},
			],
		}).then(async ({ html, result }) => {
			logger.info(`result.favicon before [${result.favicon}]`);

			if (result.favicon === undefined || result.favicon.length === 0) {
				const favicon = await getFavicon({ url, html, fetchOptions });
				if (favicon) result.favicon = favicon;
			}

			logger.info(`result.favicon after [${result.favicon}]`);
			return result;
		}),
	]);

	const metadata = { oEmbed, ...pageMeta };
	if (!Object.keys(metadata).length || !('type' in oEmbed)) return embedMeta;

	embedMeta.type = `embed/${oEmbed.type}`;

	embedMeta.metadata = metadata;

	const { ogTitle, twitterTitle, dcTitle } = metadata;
	const title = oEmbed.title ?? ogTitle ?? twitterTitle ?? dcTitle;
	if (title) embedMeta.title = title;

	const { ogDescription, twitterDescription, dcDescription } = metadata;
	const description = ogDescription ?? twitterDescription ?? dcDescription;
	if (description) embedMeta.description = decodeHTML(description);

	const { ogVideo, twitterPlayer, ogImage } = metadata;
	const { width, height } = ogVideo?.[0] ?? twitterPlayer?.[0] ?? ogImage?.[0] ?? {};

	if (width && height) {
		embedMeta.width = width;
		embedMeta.height = height;
	}

	const { ogVideoDuration, musicDuration } = metadata;
	const durationString = ogVideoDuration ?? musicDuration;

	if (durationString) {
		try {
			const duration = Math.round(Number.parseInt(durationString) * 1000);
			embedMeta.duration = duration;
		} catch (err) {
			logger.warn(`Couldn't parse embed resource duration '${durationString}' to number`);
			logger.warn(err);
		}
	}

	return embedMeta;
}

async function getFavicon({
	url,
	html,
	fetchOptions,
}: {
	url: string;
	html: string | undefined;
	fetchOptions?: RequestInit;
}): Promise<string | null> {
	const textFetcher = (fetchURL: string): Promise<string> | string => {
		if (html) return html;
		return fetch(fetchURL).then((res) => res.text());
	};

	const bufferFetcher = (fetchURL: string): Promise<ArrayBuffer> => {
		return fetch(fetchURL, fetchOptions).then((res) => res.arrayBuffer());
	};

	return new Promise((resolve) => {
		let favicon: string | null = null;

		const subscription = parseFavicon(url, textFetcher, bufferFetcher).subscribe({
			next: (icon) => {
				if (icon.url) {
					favicon = new URL(icon.url, url).toString();
					subscription.unsubscribe();
					resolve(favicon);
				}
			},
			error: (err) => {
				logger.warn(`Couldn't parse favicon`);
				logger.warn(err);
			},
			complete: () => {
				if (!subscription.closed) subscription.unsubscribe();
				resolve(favicon);
			},
		});
	});
}
