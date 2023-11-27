import type { SqlOlap } from "core/ports/SqlOlap";
import type { AsyncDuckDB } from "@duckdb/duckdb-wasm";
import duckdbBrowserMvpWorkerJsUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js";
import duckdbMvpWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm";
import duckdbEhWasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm";
import duckdbBrowserEhWorkerJsUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js";
import { Deferred } from "evt/tools/Deferred";
import { assert } from "tsafe/assert";
import memoize from "memoizee";

export const createDuckDbSqlOlap = (): SqlOlap => {
    let dDb: Deferred<AsyncDuckDB> | undefined = undefined;

    const sqlOlap: SqlOlap = {
        "getDb": async () => {
            if (dDb !== undefined) {
                return dDb.pr;
            }

            dDb = new Deferred();

            const duckdb = await import("@duckdb/duckdb-wasm");
            const bundle = await duckdb.selectBundle({
                "mvp": {
                    "mainModule": duckdbMvpWasmUrl,
                    "mainWorker": duckdbBrowserMvpWorkerJsUrl
                },
                "eh": {
                    "mainModule": duckdbEhWasmUrl,
                    "mainWorker": duckdbBrowserEhWorkerJsUrl
                }
            });

            assert(bundle.mainWorker !== null);

            const db = new duckdb.AsyncDuckDB(
                new duckdb.ConsoleLogger(),
                new Worker(bundle.mainWorker)
            );
            await db.instantiate(bundle.mainModule);

            dDb.resolve(db);

            return db;
        },
        "getRows": async ({ sourceUrl, limit, page }) => {
            const db = await sqlOlap.getDb();

            const conn = await db.connect();

            const stmt = await conn.prepare(
                `SELECT * FROM "${sourceUrl}" LIMIT ${limit} OFFSET ${limit * (page - 1)}`
            );

            const res = await stmt.query();

            const rows = JSON.parse(JSON.stringify(res.toArray()));

            await conn.close();

            return rows;
        },
        "getRowCount": memoize(
            async sourceUrl => {
                const db = await sqlOlap.getDb();

                const conn = await db.connect();

                const stmt = await conn.prepare(
                    `SELECT count(*)::INTEGER as v FROM "${sourceUrl}"`
                );

                const res = await stmt.query();

                return JSON.parse(JSON.stringify(res.toArray()))[0]["v"];
            },
            { "promise": true, "max": 1 }
        )
    };

    return sqlOlap;
};
