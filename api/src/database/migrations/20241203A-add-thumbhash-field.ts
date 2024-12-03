import type { Knex } from 'knex';

const THUMBNAIL_COL = 'thumbhash';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_files', (table) => {
		table.binary(THUMBNAIL_COL).nullable();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_files', (table) => {
		table.dropColumn(THUMBNAIL_COL);
	});
}
