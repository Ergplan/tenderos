// A minimal Word (.docx) writer: paragraphs and fixed-width tables in Calibri, A4. Used for the
// pre-bid queries (app/api/bid/queries), the SECI bid pack (app/api/seci/forms) and the SECI
// letters (app/api/seci/letters).
import JSZip from "jszip";

export const str = (v, n = 4000) => String(v ?? "").slice(0, n);
export const esc = (s) => str(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

export function run(text, { bold = false, italic = false, size = null, color = null, strike = false, font = null, highlight = null } = {}) {
  // rPr children in the schema's order
  const props = [font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>` : "", bold ? "<w:b/>" : "", italic ? "<w:i/>" : "", strike ? "<w:strike/>" : "",
    color ? `<w:color w:val="${color}"/>` : "", size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : "", highlight ? `<w:highlight w:val="${highlight}"/>` : ""].join("");
  // a line break inside the text is a <w:br/>
  const parts = str(text, 20000).split("\n").map((t) => `<w:t xml:space="preserve">${esc(t)}</w:t>`).join("<w:br/>");
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${parts}</w:r>`;
}

/** A paragraph of several runs (each [text, run options]); align "center" | "both" | null. */
export function runsPara(runs, { before = 0, after = 100, align = null } = {}) {
  return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/>${align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>${runs.map(([t, o]) => run(t, o)).join("")}</w:p>`;
}

export const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

export function para(text, opts = {}) {
  const spacing = `<w:spacing w:before="${opts.before ?? 0}" w:after="${opts.after ?? 80}"/>`;
  return `<w:p><w:pPr>${spacing}${opts.center ? '<w:jc w:val="center"/>' : ""}</w:pPr>${run(text, opts)}</w:p>`;
}

/** A cell: each line of the text is its own paragraph; or, given as { runs }, one paragraph of runs. */
export function cell(text, width, { bold = false, boldFirst = false, fill = null, size = 18 } = {}) {
  if (text && typeof text === "object" && Array.isArray(text.runs)) {
    const p = `<w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>${text.runs.map(([t, o]) => run(t, { size, bold, ...o })).join("")}</w:p>`;
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${p}</w:tc>`;
  }
  const lines = str(text).split("\n");
  const ps = lines.map((line, i) => `<w:p><w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>${run(line, { bold: bold || (boldFirst && i === 0), size })}</w:p>`).join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ""}</w:tcPr>${ps}</w:tc>`;
}

/** A table: cols [[label, width]], rows of cell texts; options per column ({ boldFirst }). */
export function table(cols, rows, { colOpts = [], header = true } = {}) {
  const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="808080"/>`;
  const head = header ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${cols.map(([label, w]) => cell(label, w, { bold: true, fill: "D9D9D9" })).join("")}</w:tr>` : "";
  const body = rows.map((values) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${values.map((v, i) => cell(v, cols[i][1], colOpts[i] || {})).join("")}</w:tr>`).join("");
  // tblPr children in the schema's order (Word rejects them out of order)
  return `<w:tbl><w:tblPr><w:tblW w:w="${cols.reduce((a, [, w]) => a + w, 0)}" w:type="dxa"/>`
    + `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders>`
    + `<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid>${cols.map(([, w]) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${head}${body}</w:tbl>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-IN"/></w:rPr></w:rPrDefault>`
  + `<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
  + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
  + `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`
  + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`
  + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
  + `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

function coreXml(title, author) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
    + `<dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

/** The .docx bytes for a body of paragraphs and tables (A4, portrait or landscape). */
export async function docxBuffer({ title, author, body, landscape = false }) {
  const page = landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}`
    + `<w:sectPr>${page}<w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr>`
    + `</w:body></w:document>`;
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", ROOT_RELS);
  zip.file("docProps/core.xml", coreXml(title, author));
  zip.file("word/document.xml", document);
  zip.file("word/styles.xml", STYLES);
  zip.file("word/_rels/document.xml.rels", DOC_RELS);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export function docxResponse(buffer, fileName) {
  return new Response(buffer, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${fileName}"`,
    },
  });
}
