import { crc32 } from "node:zlib";

type ZipEntry = { name: string; data: Buffer };

/** A one-page PDF 1.4 that shows `text`. */
export function samplePdf(text: string): Buffer {
  const stream = `BT /F1 18 Tf 24 72 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** A minimal Word document (STORE-only zip) with one paragraph of `text`. */
export function sampleDocx(text: string): Buffer {
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}" Target="word/document.xml"/></Relationships>`
      ),
    },
    {
      name: "word/document.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
      ),
    },
  ];
  return zip(entries);
}

function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const local = localHeader(entry);
    centrals.push(centralHeader(entry, offset));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  return Buffer.concat([
    ...locals,
    central,
    endOfCentralDirectory(entries.length, central.length, offset),
  ]);
}

function localHeader(entry: ZipEntry): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04_03_4b_50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x21, 12);
  header.writeUInt32LE(crc32(entry.data), 14);
  header.writeUInt32LE(entry.data.length, 18);
  header.writeUInt32LE(entry.data.length, 22);
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name, entry.data]);
}

function centralHeader(entry: ZipEntry, localOffset: number): Buffer {
  const name = Buffer.from(entry.name);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02_01_4b_50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x21, 14);
  header.writeUInt32LE(crc32(entry.data), 16);
  header.writeUInt32LE(entry.data.length, 20);
  header.writeUInt32LE(entry.data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, name]);
}

function endOfCentralDirectory(
  count: number,
  size: number,
  offset: number
): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return end;
}
