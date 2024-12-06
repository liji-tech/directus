import type { Knex } from 'knex';

const COL_NAME = 'filename_download';

export async function up(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_files', (table) => {
		table.string(COL_NAME).nullable().defaultTo(null).alter();
	});
}

export async function down(knex: Knex): Promise<void> {
	await knex.schema.alterTable('directus_files', (table) => {
		table.string(COL_NAME).notNullable().defaultTo(null).alter();
	});
}
