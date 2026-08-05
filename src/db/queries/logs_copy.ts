import { Readable } from "stream";
import { conn } from "../index.js";
import type {LogCopyItem} from "../../types/logs.js";

export async function copyLogsToDB(batch: LogCopyItem[]) {
    if(batch.length === 0 ){
        return;
    }
    const tsvData = batch.map(item => 
        `${item.timestamp}\t${item.level}\t${item.service}\t${item.message.replace(/[\r\n\t]/g, " ")}\t${item.attributes}`)
        .join("\n") + "\n";
    
    const stream = await conn.unsafe(`COPY logs (timestamp, level, service, message, attributes)
                       FROM STDIN
                       WITH (FORMAT text, DELIMITER E'\\t')`).writable();

    await new Promise((resolve, reject) => {
        const readable = Readable.from([tsvData]);
        readable.pipe(stream);
        stream.on("finish", resolve);
        stream.on("error", reject);
    });

}