import { deflateRawSync } from "node:zlib";

export interface ZipInput {
    name: string;
    data: string | Uint8Array;
    store?: boolean;
    declaredSize?: number;
}

export function makeZip(files: readonly ZipInput[]): Uint8Array {
    const encoder = new TextEncoder();
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
        const name = Buffer.from(encoder.encode(file.name));
        const raw = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
        const body = file.store ? Buffer.from(raw) : deflateRawSync(raw);
        const method = file.store ? 0 : 8;
        const size = file.declaredSize ?? raw.byteLength;

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(method, 8);
        local.writeUInt32LE(body.byteLength, 18);
        local.writeUInt32LE(size, 22);
        local.writeUInt16LE(name.byteLength, 26);
        locals.push(local, name, body);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(method, 10);
        central.writeUInt32LE(body.byteLength, 20);
        central.writeUInt32LE(size, 24);
        central.writeUInt16LE(name.byteLength, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, name);

        offset += local.byteLength + name.byteLength + body.byteLength;
    }

    const directory = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.byteLength, 12);
    end.writeUInt32LE(offset, 16);
    return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
